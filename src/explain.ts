// The product surface behind the website's "Try it" box: paste a failed transaction, get a plain-English reason and
// the remembered path that worked (or an honest "no memory yet"). Also the guarded "teach it" write.
//   Tatum:  one receipt read (plus the trace for the revert reason) per failure, and one per chain probed.
//   Walrus: two recalls, one from an empty namespace (what Clew says with no memory) and one from the real
//           namespace, so both answers are produced by the same run on the same failure.
import { getReceipt } from "./tatum.ts";
import { loadAttempt, recallFor, recordRetry, type Attempt, type NextAction } from "./clew.ts";
import { loadSuiAttempt, recordSuiRetry, type SuiAttempt } from "./sui.ts";
import { walrus, type MemoryStore } from "./memory.ts";
import { explainError, type Reason } from "./reasons.ts";

export { explainError, type Reason };

export const EVM_CHAINS = ["base", "ethereum", "polygon"] as const;
/** Recalling from here finds nothing, which is exactly the "no memory" answer. */
export const EMPTY_NAMESPACE = "clew-counterfactual-empty";
/** A "retry" more than a day after the failure is not a retry; teach refuses it. */
export const MAX_RETRY_GAP_SECONDS = 86_400;
/** The same day on Sui, in checkpoints (about 0.24 s each). */
export const MAX_RETRY_GAP_CHECKPOINTS = 360_000;

export type ClewErrorCode = "bad_input" | "not_found" | "not_a_failure" | "mismatch" | "upstream";

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
  memory: null | { successTx: string; successBlock: number; blobId: string; nextAction: NextAction; suggestion: string };
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
      ? { successTx: withMem.priorPath.successTx ?? "", successBlock: withMem.priorPath.successBlock, blobId: withMem.memoryBlobId, nextAction: withMem.nextAction, suggestion: withMem.suggestion }
      : null,
  };
}

// ---------- teach ----------
export interface Taught { chain: string; failedTx: string; successTx: string; blobId: string; jobId?: string; alreadyStored: boolean; reason: Reason }

/**
 * Write one memory from a pair the visitor supplies. Everything that makes it a real pair is checked on-chain first
 * (the failure failed, the retry succeeded, same wallet, same contract, retry after failure and within a day);
 * a pair that doesn't verify never reaches Walrus.
 */
export async function teach(failedInput: string, successInput: string, opts: CheckOptions = {}): Promise<Taught> {
  const failed = detectTarget(failedInput), success = detectTarget(successInput);
  if (failed.kind !== success.kind) throw new ClewError("mismatch", "The two transactions are on different kinds of chain.");
  if (failed.hash === success.hash) throw new ClewError("mismatch", "Paste two different transactions: the one that failed, then the one that fixed it.");
  const store = opts.store ?? walrus;
  const verified = (e: unknown): ClewError => {
    if (e instanceof ClewError) return e;
    const m = e instanceof Error ? e.message : "";
    if (/not found/.test(m)) return new ClewError("not_found", "One of those transactions wasn't found on chain.");
    if (/not a failure|succeeded, not a failure/.test(m)) return new ClewError("not_a_failure", "The first transaction didn't fail. Paste the failed one first.");
    if (/not a success|must be|retry must/.test(m)) return new ClewError("mismatch", `That pair doesn't verify: ${m}.`);
    return upstream(e);
  };
  try {
    if (failed.kind === "sui") {
      const r = await recordSuiRetry(failed.hash, success.hash, store, (f, s) => {
        if (s.checkpoint - f.checkpoint > MAX_RETRY_GAP_CHECKPOINTS) throw new ClewError("mismatch", "The retry came more than a day after the failure, so it isn't a retry.");
      });
      return { chain: "sui", failedTx: r.failure.hash, successTx: r.success.hash, blobId: r.blob_id, jobId: r.job_id, alreadyStored: Boolean(r.skipped), reason: explainError(r.failure.errorSig, r.failure.errorDetail) };
    }
    const chain = await findEvmChain(failed.hash, opts.chain);
    const r = await recordRetry(chain, failed.hash, success.hash, store, 1, (f, s) => {
      if (s.timestamp - f.timestamp > MAX_RETRY_GAP_SECONDS) throw new ClewError("mismatch", "The retry came more than a day after the failure, so it isn't a retry.");
    });
    return { chain, failedTx: r.failure.hash, successTx: r.success.hash, blobId: r.blob_id, jobId: r.job_id, alreadyStored: Boolean(r.skipped), reason: explainError(r.failure.errorSig, r.failure.errorDetail) };
  } catch (e) {
    throw verified(e);
  }
}
