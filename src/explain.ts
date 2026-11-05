// The product surface behind the website's "Try it" box: paste a failed transaction, get a plain-English reason and
// the remembered path that worked (or an honest "no memory yet"). Read-only: nothing here writes to Walrus.
//   Tatum:  one receipt read (plus the trace for the revert reason) per failure, and one per chain probed.
//   Walrus: two recalls, one from an empty namespace (what Clew says with no memory) and one from the real
//           namespace, so both answers are produced by the same run on the same failure.
import { getReceipt } from "./tatum.ts";
import { loadAttempt, recallFor, type Attempt, type Evidence, type NextAction } from "./clew.ts";
import { loadSuiAttempt, type SuiAttempt } from "./sui.ts";
import { walrus, type MemoryStore } from "./memory.ts";
import { explainError, summarizeChange, type Change, type Reason } from "./reasons.ts";

export { explainError, summarizeChange, type Change, type Reason };

export const EVM_CHAINS = ["base", "ethereum", "polygon"] as const;
/** Recalling from here finds nothing, which is exactly the "no memory" answer. */
export const EMPTY_NAMESPACE = "clew-counterfactual-empty";

export type ClewErrorCode = "bad_input" | "not_found" | "not_a_failure" | "upstream";

/** An error whose message is safe to show a visitor. */
export class ClewError extends Error {
  constructor(public code: ClewErrorCode, message: string) { super(message); }
}

export type Target = { kind: "evm"; hash: string } | { kind: "sui"; hash: string };

export function detectTarget(input: string): Target {
  const s = input.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return { kind: "evm", hash: s.toLowerCase() };
  if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(s)) return { kind: "sui", hash: s };
  throw new ClewError("bad_input", "That doesn't look like a transaction hash. Paste a 0x… hash (Base, Ethereum, Polygon) or a Sui transaction digest.");
}

const upstream = (e: unknown): ClewError =>
  e instanceof ClewError ? e : new ClewError("upstream", `Couldn't read the chain right now (${e instanceof Error ? e.message : "unknown error"}). Try again in a moment.`);

/** Which EVM chain holds this hash: the preferred one, else the first of Base, Ethereum, Polygon with a receipt. */
export async function findEvmChain(hash: string, preferred?: string): Promise<string> {
  const chains = preferred ? [preferred] : [...EVM_CHAINS];
  let failures = 0;
  for (const chain of chains) {
    try {
      if (await getReceipt(chain, hash)) return chain;
    } catch (e) {
      failures++;
      if (failures === chains.length) throw upstream(e);
    }
  }
  throw new ClewError("not_found", `No transaction with that hash on ${chains.join(", ")}. Check the hash, or wait a minute if it was just sent.`);
}

// ---------- the answer ----------
export interface Answer {
  chain: string;
  hash: string;
  failure: { wallet: string; contract: string; errorSig: string; errorDetail: string; block: number; gasUsed: number; gasLimit: number };
  reason: Reason;
  /** What Clew says with an empty namespace. */
  without: string;
  /** What Clew says with the real namespace; null when this wallet and contract have no memory. */
  memory: null | {
    successTx: string; successBlock: number; blobId: string; changed: Change; nextAction: NextAction; suggestion: string;
    /** Distinct earlier retries that succeeded after this wallet's same error on this contract (1 = a single memory). */
    priorRetries: number;
    /** Present only when priorRetries is 2 or more: the changes counted across them, most consistent first. */
    ranking?: Evidence;
  };
}

export interface CheckOptions { chain?: string; store?: MemoryStore }

const blockOf = (f: Attempt | SuiAttempt) => ("block" in f ? f.block : f.checkpoint);

async function loadFailure(target: Target, chain?: string): Promise<{ chain: string; f: Attempt | SuiAttempt }> {
  try {
    if (target.kind === "sui") return { chain: "sui", f: await loadSuiAttempt(target.hash) };
    const c = await findEvmChain(target.hash, chain);
    return { chain: c, f: await loadAttempt(c, target.hash) };
  } catch (e) {
    if (e instanceof Error && /not found/.test(e.message) && !(e instanceof ClewError)) throw new ClewError("not_found", "No transaction with that hash was found.");
    throw upstream(e);
  }
}

export async function checkFailure(input: string, opts: CheckOptions = {}): Promise<Answer> {
  const target = detectTarget(input);
  const { chain, f } = await loadFailure(target, opts.chain);
  if (f.status !== "failure") throw new ClewError("not_a_failure", "That transaction succeeded, so there is nothing to explain. Paste one that failed.");
  const store = opts.store ?? walrus;
  const run = async (namespace?: string) => {
    try { return await recallFor(f, { store, namespace }); } catch (e) { throw upstream(e); }
  };
  const [without, withMem] = [await run(EMPTY_NAMESPACE), await run()];
  return {
    chain, hash: f.hash,
    failure: { wallet: f.wallet, contract: f.contract, errorSig: f.errorSig ?? "", errorDetail: f.errorDetail ?? "", block: blockOf(f), gasUsed: f.gasUsed, gasLimit: f.gasLimit },
    reason: explainError(f.errorSig, f.errorDetail),
    without: without.matched ? "(unexpected: the empty namespace returned a memory)" : without.message,
    memory: withMem.matched
      ? { successTx: withMem.priorPath.successTx ?? "", successBlock: withMem.priorPath.successBlock, blobId: withMem.memoryBlobId, changed: summarizeChange(withMem.priorPath.change), nextAction: withMem.nextAction, suggestion: withMem.suggestion, priorRetries: withMem.priorRetries, ...(withMem.nextAction.evidence && { ranking: withMem.nextAction.evidence }) }
      : null,
  };
}
