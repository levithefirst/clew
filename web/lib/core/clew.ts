// GENERATED from src/clew.ts by web/scripts/sync-core.mjs. Do not edit here; edit src/ and run `npm run sync-core` in web/.
// Clew core: failure -> successful retry -> memory -> next failure gets the prior path.
import { getReceipt, getTx, getBlock, getBlockReceipts, getRevert, blockNumber, type Revert } from "./tatum.ts";
import { walrus, type MemoryStore, type Recalled } from "./memory.ts";

export interface Attempt {
  chain: string; hash: string; wallet: string; contract: string; status: "success" | "failure";
  selector: string; input: string; value: bigint; nonce: number; gasLimit: number; gasUsed: number;
  gasPrice: bigint; block: number; timestamp: number; errorSig?: string; errorDetail?: string;
}

const hexN = (h?: string) => (h ? parseInt(h, 16) : 0);
const hexB = (h?: string) => (h ? BigInt(h) : 0n);
const lc = (s?: string | null) => (s ?? "").toLowerCase();

// ---------- error signature ----------
export function errorSignature(rev: Revert & { vmError?: string }, selector: string, gasUsed: number, gasLimit: number): string {
  if (rev.kind === "error" && rev.reason) {
    const norm = rev.reason.toLowerCase().replace(/0x[0-9a-f]+/g, "0x_").replace(/\d+/g, "n").replace(/[^a-z0-9:_\-]+/g, "_").replace(/^_+|_+$/g, "");
    return `revert:${norm}`;
  }
  if (rev.kind === "panic") return `panic:${rev.data.slice(10).replace(/^0+/, "") || "0"}`;
  if (rev.kind === "custom" && rev.selector) return `custom:${rev.selector}`;
  if (/out of gas/i.test(rev.vmError ?? "") || (gasLimit > 0 && gasUsed >= gasLimit * 0.98)) return `out-of-gas:${selector}`;
  return `${selector}:reverted`;
}

export function similarError(a: string, b: string): boolean {
  if (a === b) return true;
  const [ka, va] = [a.split(":")[0], a.slice(a.indexOf(":") + 1)];
  const [kb, vb] = [b.split(":")[0], b.slice(b.indexOf(":") + 1)];
  if (ka !== kb || ka !== "revert") return false;
  const ta = new Set(va.split(/[^a-z0-9]+/).filter(Boolean)), tb = new Set(vb.split(/[^a-z0-9]+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / new Set([...ta, ...tb]).size >= 0.6;
}

// ---------- ingest ----------
export async function loadAttempt(chain: string, hash: string): Promise<Attempt> {
  const [rc, tx] = [await getReceipt(chain, hash), await getTx(chain, hash)];
  if (!rc || !tx) throw new Error(`tx ${hash} not found on ${chain}`);
  const blk = await getBlock(chain, hexN(rc.blockNumber));
  const input = lc(tx.input);
  const a: Attempt = {
    chain, hash: lc(hash), wallet: lc(rc.from), contract: lc(rc.to), status: rc.status === "0x1" ? "success" : "failure",
    selector: input.slice(0, 10) || "0x", input, value: hexB(tx.value), nonce: hexN(tx.nonce), gasLimit: hexN(tx.gas),
    gasUsed: hexN(rc.gasUsed), gasPrice: hexB(rc.effectiveGasPrice ?? tx.gasPrice), block: hexN(rc.blockNumber), timestamp: hexN(blk?.timestamp),
  };
  if (a.status === "failure") {
    const rev = await getRevert(chain, hash, tx);
    a.errorSig = errorSignature(rev, a.selector, a.gasUsed, a.gasLimit);
    a.errorDetail = rev.reason ?? (rev.kind === "custom" ? `custom error ${rev.selector}` : rev.vmError ?? "reverted, no reason");
  }
  return a;
}

export async function recordFailure(chain: string, hash: string): Promise<Attempt> {
  const a = await loadAttempt(chain, hash);
  if (a.status !== "failure") throw new Error(`${hash} succeeded (status 0x1), not a failure`);
  return a;
}

// ---------- diff ----------
export interface Diff {
  gasUsed: [number, number]; gasLimit: [number, number]; gasPrice: [bigint, bigint]; nonce: [number, number];
  value: [bigint, bigint]; selectorChanged: boolean; selectors: [string, string];
  args: { index: number; from: string; to: string }[]; argCountChanged: boolean; blocksLater: number; secondsLater: number;
}
const words = (input: string) => (input.slice(10).match(/.{1,64}/g) ?? []);
const short = (w?: string) => {
  if (w === undefined) return "∅";
  const t = w.replace(/^0+/, "") || "0";
  return "0x" + (t.length > 20 ? `${t.slice(0, 10)}…${t.slice(-6)}` : t);
};

export function diffAttempts(f: Attempt, s: Attempt): Diff {
  const wf = words(f.input), ws = words(s.input), n = Math.max(wf.length, ws.length), args: Diff["args"] = [];
  for (let i = 0; i < n; i++) if (wf[i] !== ws[i]) args.push({ index: i, from: short(wf[i]), to: short(ws[i]) });
  return {
    gasUsed: [f.gasUsed, s.gasUsed], gasLimit: [f.gasLimit, s.gasLimit], gasPrice: [f.gasPrice, s.gasPrice], nonce: [f.nonce, s.nonce],
    value: [f.value, s.value], selectorChanged: f.selector !== s.selector, selectors: [f.selector, s.selector],
    args, argCountChanged: wf.length !== ws.length, blocksLater: s.block - f.block, secondsLater: s.timestamp - f.timestamp,
  };
}

/** True only when the failed attempt itself ran out of gas: the error says so, or it burned (almost) its whole limit. */
export function isOutOfGas(errorSig: string | undefined, gasUsed: number, gasLimit: number): boolean {
  return Boolean(errorSig?.startsWith("out-of-gas")) || (gasLimit > 0 && gasUsed >= gasLimit * 0.98);
}

/**
 * The concrete next action the memory encodes. A gas-limit hint is emitted only when the failure ran out of gas;
 * otherwise the failure reason is surfaced, because a retry with more gas does not mean gas was the problem.
 */
export function suggest(f: Attempt, s: Attempt, d: Diff): string {
  const out: string[] = [];
  const oog = isOutOfGas(f.errorSig, f.gasUsed, f.gasLimit);
  if (!oog) out.push(`reason: ${clipDetail(f.errorDetail)} (used ${f.gasUsed} of ${f.gasLimit} gas, not out of gas)`);
  if (d.selectorChanged) out.push(`call ${d.selectors[1]} instead of ${d.selectors[0]}`);
  if (d.value[0] !== d.value[1]) out.push(`send value ${d.value[1]} wei (failed with ${d.value[0]})`);
  if (!d.selectorChanged && d.args.length) {
    const shown = d.args.slice(0, 3).map((a) => `arg word ${a.index} = ${a.to} (was ${a.from})`).join("; ");
    out.push(`re-encode calldata: ${shown}${d.args.length > 3 ? `; +${d.args.length - 3} more words differ; rebuild params like tx ${s.hash}` : ""}`);
  }
  if (oog) out.push(`out of gas: retry used gas limit ${d.gasLimit[1]} (failed with limit ${d.gasLimit[0]}, retry used ${d.gasUsed[1]}); consider gas limit >= ${d.gasLimit[1]}`);
  if (out.length === (oog ? 0 : 1)) out.push(`resubmit identical calldata/gas after ~${d.blocksLater} blocks (${d.secondsLater}s): params did not change, so state or timing likely did`);
  return out.join("; ") + `; template tx ${s.hash}`;
}

/** Structured form of a stored NEXT_ACTION. Parses every wording Clew has written (memories on Walrus are immutable). */
export interface NextAction {
  reason?: string;
  calldata: { index: number; to: string; from: string }[]; moreWords: number;
  /** Sui: changed Pure inputs (EVM memories use calldata words instead). */
  inputs: { index: number; to: string; from: string }[];
  callInstead?: { to: string; from: string }; value?: { to: string; from: string };
  gasLimit?: { floor: number; failed: number }; gasPrice?: { floor: string; failed: string };
  resubmit?: string; templateTx?: string;
  /** Present only when more than one earlier retry succeeded after this same error (see rankChanges). */
  evidence?: Evidence;
}

export function parseNextAction(text: string): NextAction {
  const a: NextAction = { calldata: [], moreWords: 0, inputs: [] };
  for (const m of text.matchAll(/input (\d+) = (\S+) \(was (\S+?)\)/g)) a.inputs.push({ index: Number(m[1]), to: m[2], from: m[3] });
  const why = text.match(/(?:^|; )reason: (.*? \(used \d+ of \d+ gas, not out of gas\))/); if (why) a.reason = why[1];
  for (const m of text.matchAll(/arg word (\d+) = (\S+) \(was (\S+?)\)/g)) a.calldata.push({ index: Number(m[1]), to: m[2], from: m[3] });
  const more = text.match(/\+(\d+) more words differ/); if (more) a.moreWords = Number(more[1]);
  const fn = text.match(/call (0x[0-9a-f]+) instead of (0x[0-9a-f]+)/); if (fn) a.callInstead = { to: fn[1], from: fn[2] };
  const v = text.match(/send value (\d+) wei \(failed with (\d+)\)/); if (v) a.value = { to: v[1], from: v[2] };
  const gl = text.match(/(?:raise gas limit to >= |retry used gas limit )(\d+) \(failed with limit (\d+)/); if (gl) a.gasLimit = { floor: Number(gl[1]), failed: Number(gl[2]) };
  const gp = text.match(/(?:bid gas price >= |retry bid )(\d+) wei \(failed at (\d+)\)/); if (gp) a.gasPrice = { floor: gp[1], failed: gp[2] };
  const rs = text.match(/resubmit identical calldata\/gas after ~(\d+) blocks \((\d+)s\)/); if (rs) a.resubmit = `${rs[1]} blocks (${rs[2]}s)`;
  a.templateTx = text.match(/template tx (\S+)/)?.[1]; // EVM 0x hash or Sui base58 digest
  return a;
}

/** What a failure looked like: enough to decide whether a gas hint is honest. */
export interface FailureFacts { errorSig?: string; errorDetail?: string; gasUsed: number; gasLimit: number }

/**
 * Apply the out-of-gas gate to any NextAction, including ones parsed from memories written before the gate existed:
 * gas hints survive only if the remembered failure ran out of gas; otherwise they are dropped and the reason is shown.
 */
export function gateGasHints(a: NextAction, remembered: FailureFacts, current?: FailureFacts): NextAction {
  if (isOutOfGas(remembered.errorSig, remembered.gasUsed, remembered.gasLimit)) return { ...a, gasPrice: undefined };
  const why = current ?? remembered;
  return { ...a, gasLimit: undefined, gasPrice: undefined, reason: a.reason ?? `${clipDetail(why.errorDetail)} (used ${why.gasUsed} of ${why.gasLimit} gas, not out of gas)` };
}

/** Copy-ready next action: the reason first, then what to change; a gas line appears only for out-of-gas failures. */
export function formatNextAction(a: NextAction): string {
  const out: string[] = [];
  if (a.templateTx) out.push(`Prior successful retry (template): ${a.templateTx}`);
  if (a.evidence) out.push(...evidenceLines(a.evidence));
  if (a.reason) out.push(`- Failure reason: ${a.reason}.`);
  if (a.callInstead) out.push(`- Call ${a.callInstead.to} instead of ${a.callInstead.from}.`);
  if (a.value) out.push(`- Send value ${a.value.to} wei (failed with ${a.value.from}).`);
  if (a.calldata.length) {
    out.push(`- Re-encode calldata like the retry:`);
    for (const c of a.calldata) out.push(`    arg word ${c.index} = ${c.to} (was ${c.from})`);
    if (a.moreWords) out.push(`    +${a.moreWords} more word${a.moreWords === 1 ? " differs; copy it" : "s differ; copy them"} from the template tx`);
  }
  if (a.inputs.length) {
    out.push(`- Change the transaction inputs like the retry:`);
    for (const i of a.inputs) out.push(`    input ${i.index} = ${i.to} (was ${i.from})`);
  }
  if (a.gasLimit) out.push(`- Out of gas: the failed attempt hit its limit of ${a.gasLimit.failed}; the retry used a limit of ${a.gasLimit.floor}. Consider >= ${a.gasLimit.floor}.`);
  if (a.gasPrice) out.push(`- Gas price: the retry bid ${a.gasPrice.floor} wei (failed at ${a.gasPrice.failed}).`);
  if (a.resubmit) out.push(`- Calldata and gas were identical; the retry landed ${a.resubmit} later. State or timing likely changed, so resubmitting may be enough.`);
  return out.join("\n");
}

const DETAIL_MAX = 120;
const clipDetail = (d?: string) => {
  const t = (d ?? "reverted, no reason").replace(/\s+/g, " ").trim();
  return t.length > DETAIL_MAX ? `${t.slice(0, DETAIL_MAX - 1)}…` : t;
};
const bytes = (input: string) => Math.max(0, (input.length - 2) / 2);

/**
 * Memory text: tags first (recall + strict filter), then a bounded diff. Bounded means: at most 3 changed words, each
 * clipped, calldata sizes instead of calldata, error detail capped. `rev` > 1 marks a corrected rewrite of an earlier
 * memory for the same pair (the original stays on Walrus untouched; recall prefers the highest rev).
 */
export function memoryText(f: Attempt, s: Attempt, d: Diff, rev = 1): string {
  const changes = [
    `gas used was ${d.gasUsed[1]} vs ${d.gasUsed[0]} on failure`,
    `gas limit ${d.gasLimit[1]} vs ${d.gasLimit[0]}`,
    `gas price ${d.gasPrice[1]} vs ${d.gasPrice[0]} wei`,
    `nonce ${d.nonce[0]} -> ${d.nonce[1]}`,
    d.selectorChanged ? `function ${d.selectors[0]} -> ${d.selectors[1]}` : `same function ${d.selectors[0]}`,
    `calldata ${bytes(f.input)} -> ${bytes(s.input)} bytes`,
    d.args.length ? `${d.args.length} arg word(s) changed (` + d.args.slice(0, 3).map((a) => `arg ${a.index} ${a.from} -> ${a.to}`).join(", ") + ")" : "calldata identical",
  ].join("; ");
  return `CLEW chain=${f.chain} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector} failed_tx=${f.hash} success_tx=${s.hash} success_block=${s.block}${rev > 1 ? ` rev=${rev}` : ""}. ` +
    `Contract ${f.contract} on ${f.chain} failed with error ${f.errorSig} (${clipDetail(f.errorDetail)}) for wallet ${f.wallet}. ` +
    `Successful retry in tx ${s.hash} at block ${s.block}, ${d.blocksLater} blocks later. Change: ${changes}. NEXT_ACTION: ${suggest(f, s, d)}`;
}

/** Idempotency key (also the ledger key). Revision 1 keeps the original format so existing memories are never re-written. */
export const memoryKey = (chain: string, failed: string, success: string, rev = 1) => `${chain}:${failed}:${success}${rev > 1 ? `:r${rev}` : ""}`;

// ---------- retry: record + watch ----------
export async function recordRetry(chain: string, failedHash: string, successHash: string, store: MemoryStore = walrus, rev = 1) {
  const f = await recordFailure(chain, failedHash);
  const s = await loadAttempt(chain, successHash);
  if (s.status !== "success") throw new Error(`${successHash} is not a success`);
  if (s.wallet !== f.wallet || s.contract !== f.contract) throw new Error("retry must be same wallet -> same contract");
  if (s.block < f.block) throw new Error("retry must come after the failure");
  const d = diffAttempts(f, s), text = memoryText(f, s, d, rev);
  const w = await store.remember(text, memoryKey(chain, f.hash, s.hash, rev));
  return { failure: f, success: s, diff: d, text, ...w };
}

/** Poll Tatum block receipts after the failure for a successful tx from the same wallet to the same contract. */
export async function watchForRetry(f: Attempt, windowMs = 10 * 60_000, pollMs = 4_000): Promise<string | null> {
  const deadline = Date.now() + windowMs;
  for (let n = f.block + 1; Date.now() < deadline; ) {
    if (n > (await blockNumber(f.chain))) { await new Promise((r) => setTimeout(r, pollMs)); continue; }
    let rs: any[] | null = null;
    try { rs = await getBlockReceipts(f.chain, n); } catch { /* fall back to full block */ }
    if (!rs) {
      const b = await getBlock(f.chain, n, true);
      for (const t of b.transactions.filter((t: any) => lc(t.from) === f.wallet && lc(t.to) === f.contract)) {
        const r = await getReceipt(f.chain, t.hash); if (r.status === "0x1") return lc(t.hash);
      }
    } else {
      const hit = rs.find((r) => lc(r.from) === f.wallet && lc(r.to) === f.contract && r.status === "0x1");
      if (hit) return lc(hit.transactionHash);
      if ((n - f.block) % 20 === 0) { // cheap window check for historical scans
        const ts = hexN((await getBlock(f.chain, n))?.timestamp);
        if (ts && ts - f.timestamp > windowMs / 1000) return null;
      }
    }
    n++;
  }
  return null;
}

// ---------- next failure: recall changes the action ----------
const field = (t: string, k: string) => t.match(new RegExp(`${k}=(\\S+?)(?:\\.|\\s|$)`))?.[1];

/** The remembered failure's facts, read back from the memory text (works for every memory format written so far). */
export function rememberedFailure(text: string): FailureFacts {
  const used = text.match(/gas used was \d+ vs (\d+) on failure/), limit = text.match(/gas limit \d+ vs (\d+)/);
  return {
    errorSig: field(text, "error"), errorDetail: text.match(/failed with error \S+ \((.*?)\) for wallet/)?.[1],
    gasUsed: Number(used?.[1] ?? 0), gasLimit: Number(limit?.[1] ?? 0),
  };
}

/** Newest successful path first; for the same pair, the highest revision (a corrected rewrite) wins. */
const byRecency = (a: Recalled, b: Recalled) =>
  Number(field(b.text, "success_block")) - Number(field(a.text, "success_block")) || Number(field(b.text, "rev") ?? 1) - Number(field(a.text, "rev") ?? 1);

// ---------- learning over time: what repeats across a wallet's earlier successes ----------
export type ChangeKind = "word" | "input" | "function" | "gasPrice" | "gasLimit";
export interface ChangeKey { kind: ChangeKind; id: string; label: string }
export interface Ranked { label: string; count: number }
export interface Evidence {
  /** Earlier retries that succeeded after this wallet failed on this contract with this error. */
  total: number;
  /** True when at least one change appears in two or more of them. */
  repeated: boolean;
  /** Most frequent first (ties: calldata, function, then gas). Gas drops out of here when calldata is the majority. */
  ranked: Ranked[];
  /** Gas differences kept apart: facts, never the headline, when a calldata change is the majority. */
  alsoDiffered: Ranked[];
}

const CALLDATA: ChangeKind[] = ["word", "input", "function"];
const PRIORITY: Record<ChangeKind, number> = { word: 0, input: 0, function: 1, gasPrice: 2, gasLimit: 3 };

/**
 * The kinds of change one stored retry made, read from its "Change:" sentence (and, for memories written before the
 * gas price was recorded, from its NEXT_ACTION). Calldata words are keyed by position: the value is a fresh quote
 * every time, the position is what repeats. Gas counts only when clearly higher, the same 10% / 20% bars as before.
 */
export function changeKeys(text: string): ChangeKey[] {
  const change = text.match(/Change: (.*?)\. NEXT_ACTION/s)?.[1] ?? "", next = text.match(/NEXT_ACTION: (.*)$/s)?.[1] ?? "";
  const keys = new Map<string, ChangeKey>();
  const add = (kind: ChangeKind, id: string, label: string) => keys.set(id, { kind, id, label });
  for (const m of change.matchAll(/\barg (\d+) \S+ -> \S+/g)) add("word", `word:${m[1]}`, `calldata word ${m[1]}`);
  for (const m of change.matchAll(/\binput (\d+) \S+ -> \S+/g)) add("input", `input:${m[1]}`, `input ${m[1]}`);
  const fn = change.match(/\bfunction (\S+) -> (\S+?);/);
  if (fn) add("function", `function:${fn[1]}>${fn[2]}`, `function ${fn[1]} \u2192 ${fn[2]}`);
  const price = change.match(/gas price (\d+) vs (\d+)/);
  const pricedUp = price ? BigInt(price[1]) > (BigInt(price[2]) * 11n) / 10n : /(?:bid gas price >= |retry bid )\d+ wei \(failed at \d+\)/.test(next);
  if (pricedUp) add("gasPrice", "gasPrice", "a higher gas price on the retry");
  const limit = change.match(/gas limit (\d+) vs (\d+)/);
  if (limit && Number(limit[1]) > Number(limit[2]) * 1.2) add("gasLimit", "gasLimit", "a higher gas limit on the retry");
  return [...keys.values()];
}

/**
 * Count how often each change appears across the earlier successful retries (newest first) and rank them.
 * `template` is the newest retry that contains the top change, so the tx and word values shown are one that did it.
 */
export function rankChanges(texts: string[]): Evidence & { template: number; calldataMajority: boolean } {
  const total = texts.length;
  const seen = new Map<string, ChangeKey & { count: number; newest: number }>();
  const perRetry = texts.map(changeKeys);
  perRetry.forEach((keys, i) => keys.forEach((k) => {
    const e = seen.get(k.id) ?? { ...k, count: 0, newest: i };
    e.count++;
    seen.set(k.id, e);
  }));
  const withCalldata = perRetry.filter((ks) => ks.some((k) => CALLDATA.includes(k.kind))).length;
  const calldataMajority = withCalldata * 2 > total;
  const all = [...seen.values()].sort((a, b) => b.count - a.count || PRIORITY[a.kind] - PRIORITY[b.kind] || a.label.localeCompare(b.label));
  const isGas = (k: ChangeKey) => !CALLDATA.includes(k.kind);
  const ranked = all.filter((k) => !calldataMajority || !isGas(k));
  const alsoDiffered = calldataMajority ? all.filter(isGas) : [];
  const repeated = (ranked[0]?.count ?? 0) >= 2;
  const view = (k: { label: string; count: number }): Ranked => ({ label: k.label, count: k.count });
  return {
    total, repeated, ranked: ranked.slice(0, 3).map(view), alsoDiffered: alsoDiffered.map(view),
    template: repeated ? ranked[0].newest : 0, calldataMajority,
  };
}

const of = (r: Ranked, total: number) => `${r.count} of ${total}`;
/** The evidence as copy-ready lines (the website renders the same facts from the same structure). */
export function evidenceLines(e: Evidence): string[] {
  const out: string[] = [];
  if (e.repeated) {
    const [top, ...rest] = e.ranked;
    out.push(`- Most consistent change: ${top.label}, in ${of(top, e.total)} earlier retries that succeeded after this same error.`);
    for (const r of rest) if (r.count >= 2) out.push(`- Also seen: ${r.label}, in ${of(r, e.total)}.`);
  } else {
    out.push(`- ${e.total} earlier retries succeeded after this same error and no single change repeated across them. Showing the most recent.`);
  }
  if (e.alsoDiffered.length) out.push(`- Also differed, not shown as a cause: ${e.alsoDiffered.map((r) => `${r.label} (${of(r, e.total)})`).join("; ")}.`);
  return out;
}

/** The fields recall needs from a failure, on any chain (an EVM Attempt or a Sui attempt both fit). */
export interface FailureLike extends FailureFacts { chain: string; hash: string; contract: string; wallet: string; selector: string }

/** One entry per failed->success pair: a corrected rewrite (higher rev) replaces the memory it supersedes. */
function distinctPairs(hits: Recalled[]): Recalled[] {
  const best = new Map<string, Recalled>();
  for (const h of [...hits].sort(byRecency)) {
    const k = `${field(h.text, "failed_tx")}:${field(h.text, "success_tx")}`;
    if (!best.has(k)) best.set(k, h);
  }
  return [...best.values()].sort(byRecency);
}

/**
 * Recall for a failure already loaded: semantic search, then the strict tag filter. With one earlier success the
 * answer is that path. With several, the changes are counted and the most frequent leads, labelled with its count;
 * when a calldata change is the majority, gas advice is held back.
 */
export async function recallFor<F extends FailureLike>(f: F, opts: { store?: MemoryStore; namespace?: string } = {}) {
  const store = opts.store ?? walrus;
  const query = `CLEW chain=${f.chain} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector}`;
  const hits = await store.recall(query, { namespace: opts.namespace, topK: 10 });
  const matches = distinctPairs(hits
    .filter((h) => field(h.text, "chain") === f.chain && field(h.text, "contract") === f.contract && field(h.text, "wallet") === f.wallet)
    .filter((h) => similarError(field(h.text, "error") ?? "", f.errorSig!)));
  if (!matches.length) {
    return { matched: false as const, failure: f,
      message: `Tx ${f.hash} on ${f.chain} reverted (${f.errorSig}). No prior successful path on record for this wallet+contract. Check params and retry.` };
  }
  const ranking = matches.length > 1 ? rankChanges(matches.map((m) => m.text)) : undefined;
  const match = matches[ranking?.template ?? 0];
  const stored = match.text.match(/NEXT_ACTION: (.*)$/)?.[1] ?? "";
  let nextAction = gateGasHints(parseNextAction(stored), rememberedFailure(match.text), f);
  if (ranking) {
    const { template: _template, calldataMajority, ...evidence } = ranking;
    // A calldata change that most successes share outranks gas: the gas-limit hint is held back (it stays a fact above).
    nextAction = { ...nextAction, evidence, ...(calldataMajority ? { gasLimit: undefined } : {}) };
  }
  return {
    matched: true as const, failure: f, memoryBlobId: match.blob_id, distance: match.distance, priorRetries: matches.length,
    priorPath: { failedTx: field(match.text, "failed_tx"), successTx: field(match.text, "success_tx"), successBlock: Number(field(match.text, "success_block")),
      change: match.text.match(/Change: (.*?)\. NEXT_ACTION/)?.[1] },
    nextAction, suggestion: formatNextAction(nextAction), storedNextAction: stored,
  };
}

/** Step 4 on an EVM chain: ingest the new failure through Tatum, then recall. */
export async function onFailure(chain: string, hash: string, opts: { store?: MemoryStore; namespace?: string } = {}) {
  return recallFor(await recordFailure(chain, hash), opts);
}
