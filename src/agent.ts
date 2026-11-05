// The agent-facing layer: POST /v1/recall. One call in (chain, failed tx), one JSON object out, no prose.
// It reuses the existing recall + ranking path (recallFor) and adds what an agent needs to act on it: an action,
// a concrete recommended retry, and the confidence / demotion state of the (wallet + contract + error) path.
//
// Sui hook (for GrokBot): chain "sui" takes a transaction digest and returns the same object. Live Sui reads are OFF
// unless the deployment sets CLEW_SUI_LIVE=1 (or a caller passes `loadSui`); until then the endpoint answers with
// the error code "sui_disabled" and makes no Sui call. Nothing else changes when it is switched on.
import { getTx } from "./tatum.ts";
import { changeKeys, loadAttempt, recallFor, type FailureLike, type NextAction } from "./clew.ts";
import { ClewError, EMPTY_NAMESPACE, EVM_CHAINS } from "./explain.ts";
import { loadSuiAttempt, type SuiAttempt } from "./sui.ts";
import { walrus, type MemoryStore } from "./memory.ts";

export const AGENT_CHAINS = [...EVM_CHAINS, "sui"] as const;
export type AgentChain = (typeof AGENT_CHAINS)[number];

export interface RecallRequest { chain: string; failedTxHash: string; agentId?: string }

export type AgentAction = "retry" | "abort" | "abstain";

export interface RecallResponse {
  /** retry: replay the recommended change. abort: the remembered path has failed as often as it worked. abstain: nothing remembered. */
  action: AgentAction;
  /** All null unless action is "retry". gasPrice is a decimal string (wei on EVM, MIST on Sui); calldata is null on Sui. */
  recommended: { calldata: string | null; gasLimit: number | null; gasPrice: string | null; nonceStrategy: "next" | null };
  /** successes / (successes + laterFailures + 1) for this wallet + contract + error path; 0 with no memory. */
  confidence: number;
  evidence: { successes: number; laterFailures: number; mostConsistentChange: string; blobIds: string[] };
  /** True once a later failure has lowered the path's confidence. */
  demotionFlag: boolean;
  /** Distinct earlier retries that succeeded after this wallet's same error on this contract. */
  priorRetries: number;
}

export interface AgentDeps {
  store?: MemoryStore;
  /** Recall namespace. EMPTY_NAMESPACE gives the "memory off" answer. */
  namespace?: string;
  /** Sui hook: fetch a Sui attempt by digest. Default: Tatum's Sui GraphQL gateway, only when CLEW_SUI_LIVE=1. */
  loadSui?: (digest: string) => Promise<SuiAttempt>;
  /** Replaces every chain read (EVM and Sui): offline runs, tests, replays of recorded failures. */
  load?: (chain: AgentChain, hash: string) => Promise<LoadedFailure>;
  /** Fetch a transaction's calldata (used to build the recommended calldata). Default: Tatum. */
  loadInput?: (chain: string, hash: string) => Promise<string>;
}

const SUI_DIGEST = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Validate the request body. Throws ClewError("bad_input"). */
export function parseRecallRequest(body: unknown): { chain: AgentChain; hash: string; agentId?: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const chain = typeof b.chain === "string" ? b.chain.trim().toLowerCase() : "";
  if (!(AGENT_CHAINS as readonly string[]).includes(chain)) throw new ClewError("bad_input", `chain must be one of ${AGENT_CHAINS.join(", ")}.`);
  const raw = typeof b.failedTxHash === "string" ? b.failedTxHash.trim() : "";
  if (chain === "sui" ? !SUI_DIGEST.test(raw) : !EVM_HASH.test(raw)) {
    throw new ClewError("bad_input", chain === "sui" ? "failedTxHash must be a Sui transaction digest." : "failedTxHash must be a 0x transaction hash (66 characters).");
  }
  const agentId = b.agentId === undefined ? undefined : typeof b.agentId === "string" ? b.agentId.trim() : null;
  if (agentId === null || (agentId !== undefined && (agentId.length === 0 || agentId.length > 128))) throw new ClewError("bad_input", "agentId, if given, must be a string of 1 to 128 characters.");
  return { chain: chain as AgentChain, hash: chain === "sui" ? raw : raw.toLowerCase(), agentId };
}

/** Load the failure behind a request. Throws ClewError (not_found, not_a_failure, upstream, sui_disabled). */
export type LoadedFailure = FailureLike & { status: "success" | "failure"; gasPrice: bigint | number };

export async function loadFailure(chain: AgentChain, hash: string, deps: AgentDeps = {}): Promise<LoadedFailure> {
  try {
    let f: LoadedFailure;
    if (deps.load) {
      f = await deps.load(chain, hash);
    } else if (chain === "sui") {
      const load = deps.loadSui ?? (process.env.CLEW_SUI_LIVE === "1" ? loadSuiAttempt : null);
      if (!load) throw new ClewError("sui_disabled", "Live Sui reads are not enabled on this deployment.");
      f = await load(hash);
    } else {
      f = await loadAttempt(chain, hash);
    }
    if (f.status !== "failure") throw new ClewError("not_a_failure", "That transaction succeeded, so there is nothing to recall. Send one that failed.");
    return f;
  } catch (e) {
    if (e instanceof ClewError) throw e;
    if (e instanceof Error && /not found/.test(e.message)) throw new ClewError("not_found", "No transaction with that hash was found on that chain.");
    throw new ClewError("upstream", "Couldn't read the chain right now. Try again in a moment.");
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const words = (input: string) => input.slice(10).match(/.{1,64}/g) ?? [];

/**
 * The failed call's calldata with the retry's change applied: every word (and the function selector) that differed
 * between the remembered failure and the remembered success is set to the success's value. Memories store those
 * values clipped, so the full words come from the two transactions themselves. Null when they can't be read.
 */
export async function buildCalldata(chain: string, current: { hash: string; input?: string }, failedTx: string, successTx: string, loadInput: NonNullable<AgentDeps["loadInput"]>): Promise<string | null> {
  try {
    if (!current.input) return null;
    const rememberedFailure = failedTx === current.hash ? current.input : (await loadInput(chain, failedTx)).toLowerCase();
    const success = (await loadInput(chain, successTx)).toLowerCase();
    const [wf, ws] = [words(rememberedFailure), words(success)];
    const out = words(current.input);
    for (let i = 0; i < Math.max(wf.length, ws.length); i++) if (wf[i] !== ws[i]) out[i] = ws[i] as string;
    const selector = rememberedFailure.slice(0, 10) !== success.slice(0, 10) ? success.slice(0, 10) : current.input.slice(0, 10);
    return selector + out.filter((w) => w !== undefined).join("");
  } catch {
    return null;
  }
}

const defaultInput = async (chain: string, hash: string) => String((await getTx(chain, hash))?.input ?? "");

/** The structured answer for a failure that is already loaded. */
export async function recallResponse(f: LoadedFailure, deps: AgentDeps = {}): Promise<RecallResponse> {
  let r;
  try {
    r = await recallFor(f, { store: deps.store ?? walrus, namespace: deps.namespace });
  } catch {
    throw new ClewError("upstream", "Couldn't reach Walrus Memory right now. Try again in a moment.");
  }
  if (!r.matched) {
    return {
      action: "abstain", recommended: { calldata: null, gasLimit: null, gasPrice: null, nonceStrategy: null }, confidence: 0,
      evidence: { successes: 0, laterFailures: 0, mostConsistentChange: "none", blobIds: [] }, demotionFlag: false, priorRetries: 0,
    };
  }
  const { successes, laterFailures, confidence, demotionFlag, blobIds } = r.path;
  const action: AgentAction = successes > laterFailures ? "retry" : "abort";
  const ev = r.nextAction.evidence;
  // One memory: the changes that retry made (its first, as the headline). Several: the ranking's top change (weighted by later failures).
  const mostConsistentChange = ev ? (ev.ranked.some((x) => x.count >= 2) ? ev.ranked[0].label : "none repeated") : changeKeys(r.priorPath.change ? `Change: ${r.priorPath.change}. NEXT_ACTION: ` : "")[0]?.label ?? "none";
  let recommended: RecallResponse["recommended"] = { calldata: null, gasLimit: null, gasPrice: null, nonceStrategy: null };
  if (action === "retry") {
    const a: NextAction = r.nextAction;
    const evm = f.chain !== "sui";
    recommended = {
      calldata: evm && r.priorPath.failedTx && r.priorPath.successTx
        ? await buildCalldata(f.chain, f, r.priorPath.failedTx, r.priorPath.successTx, deps.loadInput ?? defaultInput) : null,
      gasLimit: a.gasLimit?.floor ?? f.gasLimit,
      gasPrice: a.gasPrice?.floor ?? String(f.gasPrice),
      nonceStrategy: "next", // a failed tx is mined and its nonce is spent: send the retry on the wallet's next nonce
    };
  }
  return { action, recommended, confidence: round(confidence), evidence: { successes, laterFailures, mostConsistentChange, blobIds }, demotionFlag, priorRetries: r.priorRetries };
}

/** POST /v1/recall: validate, read the failure from the chain, recall, answer. */
export async function agentRecall(body: unknown, deps: AgentDeps = {}): Promise<RecallResponse> {
  const req = parseRecallRequest(body);
  return recallResponse(await loadFailure(req.chain, req.hash, deps), deps);
}

export { EMPTY_NAMESPACE };
