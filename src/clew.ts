// Clew core: failure -> successful retry -> memory -> next failure gets the prior path.
import { getReceipt, getTx, getBlock, getBlockReceipts, getRevert, blockNumber, rpc, type Revert } from "./tatum.ts";
import { walrus, type MemoryStore } from "./memory.ts";

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

/** The concrete next action the memory encodes. Gas items say what the retry did, not that gas was the cause. */
export function suggest(f: Attempt, s: Attempt, d: Diff): string {
  const out: string[] = [];
  const oog = f.errorSig?.startsWith("out-of-gas") || f.gasUsed >= f.gasLimit * 0.98;
  if (d.selectorChanged) out.push(`call ${d.selectors[1]} instead of ${d.selectors[0]}`);
  if (d.value[0] !== d.value[1]) out.push(`send value ${d.value[1]} wei (failed with ${d.value[0]})`);
  if (!d.selectorChanged && d.args.length) {
    const shown = d.args.slice(0, 3).map((a) => `arg word ${a.index} = ${a.to} (was ${a.from})`).join("; ");
    out.push(`re-encode calldata: ${shown}${d.args.length > 3 ? `; +${d.args.length - 3} more words differ; rebuild params like tx ${s.hash}` : ""}`);
  }
  if (oog || d.gasLimit[1] > d.gasLimit[0] * 1.2) out.push(`retry used gas limit ${d.gasLimit[1]} (failed with limit ${d.gasLimit[0]}, retry used ${d.gasUsed[1]}); consider gas limit >= ${d.gasLimit[1]}`);
  if (d.gasPrice[1] > (d.gasPrice[0] * 11n) / 10n) out.push(`retry bid ${d.gasPrice[1]} wei (failed at ${d.gasPrice[0]}); consider bidding >= ${d.gasPrice[1]} wei`);
  if (!out.length) out.push(`resubmit identical calldata/gas after ~${d.blocksLater} blocks (${d.secondsLater}s): params did not change, so state or timing likely did`);
  return out.join("; ") + `; template tx ${s.hash}`;
}

/** Structured form of a stored NEXT_ACTION. Parses both the current and the original (pre-softening) wording. */
export interface NextAction {
  calldata: { index: number; to: string; from: string }[]; moreWords: number;
  callInstead?: { to: string; from: string }; value?: { to: string; from: string };
  gasLimit?: { floor: number; failed: number }; gasPrice?: { floor: string; failed: string };
  resubmit?: string; templateTx?: string;
}

export function parseNextAction(text: string): NextAction {
  const a: NextAction = { calldata: [], moreWords: 0 };
  for (const m of text.matchAll(/arg word (\d+) = (\S+) \(was (\S+?)\)/g)) a.calldata.push({ index: Number(m[1]), to: m[2], from: m[3] });
  const more = text.match(/\+(\d+) more words differ/); if (more) a.moreWords = Number(more[1]);
  const fn = text.match(/call (0x[0-9a-f]+) instead of (0x[0-9a-f]+)/); if (fn) a.callInstead = { to: fn[1], from: fn[2] };
  const v = text.match(/send value (\d+) wei \(failed with (\d+)\)/); if (v) a.value = { to: v[1], from: v[2] };
  const gl = text.match(/(?:raise gas limit to >= |retry used gas limit )(\d+) \(failed with limit (\d+)/); if (gl) a.gasLimit = { floor: Number(gl[1]), failed: Number(gl[2]) };
  const gp = text.match(/(?:bid gas price >= |retry bid )(\d+) wei \(failed at (\d+)\)/); if (gp) a.gasPrice = { floor: gp[1], failed: gp[2] };
  const rs = text.match(/resubmit identical calldata\/gas after ~(\d+) blocks \((\d+)s\)/); if (rs) a.resubmit = `${rs[1]} blocks (${rs[2]}s)`;
  a.templateTx = text.match(/template tx (0x[0-9a-f]+)/)?.[1];
  return a;
}

/** Copy-ready next action. Calldata/function changes first; gas is reported as what the retry did, with a floor to consider. */
export function formatNextAction(a: NextAction): string {
  const out: string[] = [];
  if (a.templateTx) out.push(`Prior successful retry (template): ${a.templateTx}`);
  if (a.callInstead) out.push(`- Call ${a.callInstead.to} instead of ${a.callInstead.from}.`);
  if (a.value) out.push(`- Send value ${a.value.to} wei (failed with ${a.value.from}).`);
  if (a.calldata.length) {
    out.push(`- Re-encode calldata like the retry:`);
    for (const c of a.calldata) out.push(`    arg word ${c.index} = ${c.to} (was ${c.from})`);
    if (a.moreWords) out.push(`    +${a.moreWords} more word${a.moreWords === 1 ? " differs; copy it" : "s differ; copy them"} from the template tx`);
  }
  if (a.gasLimit) out.push(`- Gas limit: the retry used ${a.gasLimit.floor} (failed with ${a.gasLimit.failed}). Consider >= ${a.gasLimit.floor}.`);
  if (a.gasPrice) out.push(`- Gas price: the retry bid ${a.gasPrice.floor} wei (failed at ${a.gasPrice.failed}). Consider bidding >= ${a.gasPrice.floor} wei.`);
  if (a.gasLimit || a.gasPrice) out.push(`  Gas differed between the attempts; that does not prove it caused the revert.`);
  if (a.resubmit) out.push(`- Calldata and gas were identical; the retry landed ${a.resubmit} later. State or timing likely changed, so resubmitting may be enough.`);
  return out.join("\n");
}

export function memoryText(f: Attempt, s: Attempt, d: Diff): string {
  const changes = [
    `gas used was ${d.gasUsed[1]} vs ${d.gasUsed[0]} on failure`,
    `gas limit ${d.gasLimit[1]} vs ${d.gasLimit[0]}`,
    `nonce ${d.nonce[0]} -> ${d.nonce[1]}`,
    d.selectorChanged ? `function ${d.selectors[0]} -> ${d.selectors[1]}` : `same function ${d.selectors[0]}`,
    d.args.length ? `calldata ${d.args.length} arg word(s) changed (` + d.args.slice(0, 3).map((a) => `arg ${a.index} ${a.from} -> ${a.to}`).join(", ") + ")" : "calldata identical",
  ].join("; ");
  return `CLEW chain=${f.chain} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector} failed_tx=${f.hash} success_tx=${s.hash} success_block=${s.block}. ` +
    `Contract ${f.contract} on ${f.chain} failed with error ${f.errorSig} (${f.errorDetail}) for wallet ${f.wallet}. ` +
    `Successful retry in tx ${s.hash} at block ${s.block}, ${d.blocksLater} blocks later. Change: ${changes}. NEXT_ACTION: ${suggest(f, s, d)}`;
}

// ---------- retry: record + watch ----------
export async function recordRetry(chain: string, failedHash: string, successHash: string, store: MemoryStore = walrus) {
  const f = await recordFailure(chain, failedHash);
  const s = await loadAttempt(chain, successHash);
  if (s.status !== "success") throw new Error(`${successHash} is not a success`);
  if (s.wallet !== f.wallet || s.contract !== f.contract) throw new Error("retry must be same wallet -> same contract");
  if (s.block < f.block) throw new Error("retry must come after the failure");
  const d = diffAttempts(f, s), text = memoryText(f, s, d);
  const w = await store.remember(text, `${chain}:${f.hash}:${s.hash}`);
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

export async function onFailure(chain: string, hash: string, opts: { store?: MemoryStore; namespace?: string } = {}) {
  const store = opts.store ?? walrus;
  const f = await recordFailure(chain, hash);
  const query = `CLEW chain=${f.chain} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector}`;
  const hits = await store.recall(query, { namespace: opts.namespace, topK: 10 });
  const match = hits
    .filter((h) => field(h.text, "chain") === f.chain && field(h.text, "contract") === f.contract && field(h.text, "wallet") === f.wallet)
    .filter((h) => similarError(field(h.text, "error") ?? "", f.errorSig!))
    .sort((a, b) => Number(field(b.text, "success_block")) - Number(field(a.text, "success_block")))[0];
  if (!match) {
    return { matched: false as const, failure: f,
      message: `Tx ${f.hash} on ${chain} reverted (${f.errorSig}). No prior successful path on record for this wallet+contract. Check params and retry.` };
  }
  const stored = match.text.match(/NEXT_ACTION: (.*)$/)?.[1] ?? "";
  const nextAction = parseNextAction(stored);
  return {
    matched: true as const, failure: f, memoryBlobId: match.blob_id, distance: match.distance,
    priorPath: { failedTx: field(match.text, "failed_tx"), successTx: field(match.text, "success_tx"), successBlock: Number(field(match.text, "success_block")),
      change: match.text.match(/Change: (.*?)\. NEXT_ACTION/)?.[1] },
    nextAction, suggestion: formatNextAction(nextAction), storedNextAction: stored,
  };
}
