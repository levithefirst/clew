// Sui adapter: the same loop (failure -> successful retry -> memory -> recall) on Sui Mainnet through Tatum's Sui
// JSON-RPC gateway. A "contract" is the Move call target (package::module::function), the "wallet" is the sender,
// a "block" is the checkpoint, and changed pure inputs play the role of changed calldata words.
// Status: built against Sui's documented JSON-RPC response shapes; not yet verified against Sui Mainnet through
// Tatum (see `npm run sui:check`). Docs must not claim Sui support until that check and a real pair pass.
import { rpc } from "./tatum.ts";
import { isOutOfGas, memoryKey, recallFor, type FailureLike } from "./clew.ts";
import { walrus, type MemoryStore } from "./memory.ts";

export const SUI = "sui";
/** Sui Mainnet's chain identifier (first 4 bytes of the genesis checkpoint digest). */
export const SUI_MAINNET_ID = "35834a8a";
const TX_OPTIONS = { showInput: true, showEffects: true };

export interface SuiAttempt extends FailureLike {
  status: "success" | "failure";
  checkpoint: number;
  timestampMs: number;
  /** Gas budget and gas price set by the sender; gasUsed is computation + storage - rebate, in MIST. */
  gasLimit: number;
  gasUsed: number;
  gasPrice: number;
  /** Pure input values, in order; object inputs are shown by id. */
  inputs: string[];
  typeArgs: string[];
}

type Raw = any;
const n = (v: unknown) => Number(v ?? 0);

/** The first MoveCall in a programmable transaction: package::module::function. */
function moveTarget(tx: Raw): { target: string; fn: string; typeArgs: string[] } {
  const calls: Raw[] = tx?.transaction?.data?.transaction?.transactions ?? [];
  const call = calls.find((c) => c.MoveCall)?.MoveCall;
  if (!call) return { target: `${tx?.transaction?.data?.transaction?.kind ?? "unknown"}`, fn: "none", typeArgs: [] };
  return { target: `${call.package}::${call.module}::${call.function}`.toLowerCase(), fn: call.function, typeArgs: call.type_arguments ?? [] };
}

/**
 * Error signature for a failed Sui transaction. MoveAbort keeps module, function and abort code, the closest analogue
 * of a revert reason; InsufficientGas maps to out-of-gas so the gas gate behaves as on EVM chains.
 */
export function suiErrorSignature(error: string | undefined, fn: string): string {
  const e = error ?? "";
  const abort = e.match(/MoveAbort\(.*?name: Identifier\("([^"]+)"\).*?function_name: Some\("([^"]+)"\).*?\},\s*(\d+)\)/s);
  if (abort) return `moveabort:${abort[1]}::${abort[2]}:${abort[3]}`;
  if (/InsufficientGas/i.test(e)) return `out-of-gas:${fn}`;
  const kind = e.match(/^([A-Za-z]+)/)?.[1];
  return kind ? `sui:${kind.toLowerCase()}` : `${fn}:failed`;
}

export function toSuiAttempt(raw: Raw): SuiAttempt {
  const fx = raw.effects ?? {};
  const data = raw.transaction?.data ?? {};
  const { target, fn, typeArgs } = moveTarget(raw);
  const g = fx.gasUsed ?? {};
  const status = fx.status?.status === "success" ? "success" : "failure";
  const inputs: string[] = (data.transaction?.inputs ?? []).map((i: Raw) => (i.type === "pure" ? JSON.stringify(i.value) : `object:${i.objectId}`));
  const a: SuiAttempt = {
    chain: SUI, hash: raw.digest, wallet: String(data.sender ?? "").toLowerCase(), contract: target, selector: fn, status,
    checkpoint: n(raw.checkpoint), timestampMs: n(raw.timestampMs),
    gasLimit: n(data.gasData?.budget), gasPrice: n(data.gasData?.price),
    gasUsed: n(g.computationCost) + n(g.storageCost) - n(g.storageRebate), inputs, typeArgs,
  };
  if (status === "failure") {
    a.errorSig = suiErrorSignature(fx.status?.error, fn);
    a.errorDetail = fx.status?.error ?? "failed, no error";
  }
  return a;
}

export async function loadSuiAttempt(digest: string): Promise<SuiAttempt> {
  const raw = await rpc(SUI, "sui_getTransactionBlock", [digest, TX_OPTIONS]);
  if (!raw?.digest) throw new Error(`sui tx ${digest} not found`);
  return toSuiAttempt(raw);
}

/**
 * The sender's first successful tx to the same Move target after the failure, within `windowCheckpoints`.
 * Walks the sender's history newest-first (bounded pages): everything listed before the failure itself is later,
 * including txs in the same checkpoint, so the walk stops at the failure's digest (or once it passes its checkpoint).
 */
export async function findSuiRetry(f: SuiAttempt, windowCheckpoints = 3_000, maxPages = 5): Promise<string | null> {
  let cursor: string | null = null, best: SuiAttempt | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res = await rpc(SUI, "suix_queryTransactionBlocks", [{ filter: { FromAddress: f.wallet }, options: TX_OPTIONS }, cursor, 50, true]);
    for (const raw of res?.data ?? []) {
      const a = toSuiAttempt(raw);
      if (a.hash === f.hash || a.checkpoint < f.checkpoint) return best?.hash ?? null;
      if (a.status === "success" && a.contract === f.contract && a.checkpoint - f.checkpoint <= windowCheckpoints) best = a; // newest-first: keep overwriting to end on the earliest
    }
    if (!res?.hasNextPage) break;
    cursor = res.nextCursor;
  }
  return best?.hash ?? null;
}

const clip = (v: string) => (v.length > 24 ? `${v.slice(0, 12)}…${v.slice(-6)}` : v);

export function suiMemoryText(f: SuiAttempt, s: SuiAttempt): string {
  const changed = f.inputs.map((v, i) => ({ i, from: v, to: s.inputs[i] })).filter((x) => x.from !== x.to);
  const typeChanged = f.typeArgs.join(",") !== s.typeArgs.join(",");
  const later = s.checkpoint - f.checkpoint;
  const oog = isOutOfGas(f.errorSig, f.gasUsed, f.gasLimit);
  const changes = [
    `gas used was ${s.gasUsed} vs ${f.gasUsed} on failure`, `gas budget ${s.gasLimit} vs ${f.gasLimit}`, `gas price ${s.gasPrice} vs ${f.gasPrice} MIST`,
    typeChanged ? `type arguments ${f.typeArgs.join(",") || "none"} -> ${s.typeArgs.join(",") || "none"}` : "same type arguments",
    `inputs ${f.inputs.length} -> ${s.inputs.length}`,
    changed.length ? `${changed.length} input(s) changed (` + changed.slice(0, 3).map((c) => `input ${c.i} ${clip(c.from)} -> ${clip(c.to ?? "∅")}`).join(", ") + ")" : "inputs identical",
  ].join("; ");
  const next = [
    oog ? `out of gas: retry used gas limit ${s.gasLimit} (failed with limit ${f.gasLimit}, retry used ${s.gasUsed}); consider gas limit >= ${s.gasLimit}` : `reason: ${f.errorDetail?.slice(0, 120)} (used ${f.gasUsed} of ${f.gasLimit} gas, not out of gas)`,
    ...(typeChanged ? [`use type arguments ${s.typeArgs.join(",")}`] : []),
    ...(changed.length ? [`change inputs: ` + changed.slice(0, 3).map((c) => `input ${c.i} = ${clip(c.to ?? "∅")} (was ${clip(c.from)})`).join("; ")] : []),
    `template tx ${s.hash}`,
  ].join("; ");
  return `CLEW chain=${SUI} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector} failed_tx=${f.hash} success_tx=${s.hash} success_block=${s.checkpoint}. ` +
    `Contract ${f.contract} on ${SUI} failed with error ${f.errorSig} (${f.errorDetail?.slice(0, 120)}) for wallet ${f.wallet}. ` +
    `Successful retry in tx ${s.hash} at block ${s.checkpoint}, ${later} blocks later. Change: ${changes}. NEXT_ACTION: ${next}`;
}

export async function recordSuiRetry(failed: string, success: string, store: MemoryStore = walrus) {
  const f = await loadSuiAttempt(failed), s = await loadSuiAttempt(success);
  if (f.status !== "failure") throw new Error(`${failed} succeeded, not a failure`);
  if (s.status !== "success") throw new Error(`${success} is not a success`);
  if (s.wallet !== f.wallet || s.contract !== f.contract) throw new Error("retry must be same sender -> same Move target");
  if (s.checkpoint < f.checkpoint) throw new Error("retry must come after the failure");
  const text = suiMemoryText(f, s);
  return { failure: f, success: s, text, ...(await store.remember(text, memoryKey(SUI, f.hash, s.hash))) };
}

export async function onSuiFailure(digest: string, opts: { store?: MemoryStore; namespace?: string } = {}) {
  const f = await loadSuiAttempt(digest);
  if (f.status !== "failure") throw new Error(`${digest} succeeded, not a failure`);
  return recallFor(f, opts);
}
