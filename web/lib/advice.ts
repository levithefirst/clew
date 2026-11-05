// Turn the stored NEXT_ACTION string into readable lines and a copy-ready block (pure string parsing of real data).
// Mirrors parseNextAction/gateGasHints/formatNextAction in ../src/clew.ts: a gas hint is shown only for out-of-gas failures.

export interface NextAction {
  reason?: string;
  calldata: { index: number; to: string; from: string }[];
  moreWords: number;
  /** Sui: changed Pure inputs (EVM memories use calldata words). */
  inputs?: { index: number; to: string; from: string }[];
  callInstead?: { to: string; from: string };
  value?: { to: string; from: string };
  gasLimit?: { floor: number; failed: number };
  gasPrice?: { floor: string; failed: string };
  resubmit?: string;
  templateTx?: string;
  /** Present only when several earlier retries succeeded after this same error (src/clew.ts rankChanges). */
  evidence?: Evidence;
}

export interface Ranked { label: string; count: number }
export interface Evidence { total: number; repeated: boolean; ranked: Ranked[]; alsoDiffered: Ranked[] }

/** Mirrors evidenceLines in ../src/clew.ts. */
export function evidenceLines(e: Evidence): string[] {
  const of = (r: Ranked) => `${r.count} of ${e.total}`;
  const out: string[] = [];
  if (e.repeated) {
    const [top, ...rest] = e.ranked;
    out.push(`- Most consistent change: ${top.label}, in ${of(top)} earlier retries that succeeded after this same error.`);
    for (const r of rest) if (r.count >= 2) out.push(`- Also seen: ${r.label}, in ${of(r)}.`);
  } else if (e.ranked.some((r) => r.count >= 2)) {
    out.push(`- ${e.total} earlier retries succeeded after this same error. The change that repeated across them was followed by a later failure, so the best-supported retry is shown instead.`);
  } else {
    out.push(`- ${e.total} earlier retries succeeded after this same error and no single change repeated across them. Showing the most recent.`);
  }
  if (e.alsoDiffered.length) out.push(`- Also differed, not shown as a cause: ${e.alsoDiffered.map((r) => `${r.label} (${of(r)})`).join("; ")}.`);
  return out;
}

/** What the remembered failure looked like: enough to decide whether a gas hint is honest. */
export interface FailureFacts {
  errorSig?: string | null;
  errorDetail?: string | null;
  gasUsed?: number | null;
  gasLimit?: number | null;
}

export function parseNextAction(text: string): NextAction {
  const a: NextAction = { calldata: [], moreWords: 0 };
  const why = text.match(/(?:^|; )reason: (.*? \(used \d+ of \d+ gas, not out of gas\))/);
  if (why) a.reason = why[1];
  for (const m of text.matchAll(/arg word (\d+) = (\S+) \(was (\S+?)\)/g)) a.calldata.push({ index: Number(m[1]), to: m[2], from: m[3] });
  a.inputs = [...text.matchAll(/input (\d+) = (\S+) \(was (\S+?)\)/g)].map((m) => ({ index: Number(m[1]), to: m[2], from: m[3] }));
  const more = text.match(/\+(\d+) more words differ/);
  if (more) a.moreWords = Number(more[1]);
  const fn = text.match(/call (0x[0-9a-f]+) instead of (0x[0-9a-f]+)/);
  if (fn) a.callInstead = { to: fn[1], from: fn[2] };
  const v = text.match(/send value (\d+) wei \(failed with (\d+)\)/);
  if (v) a.value = { to: v[1], from: v[2] };
  const gl = text.match(/(?:raise gas limit to >= |retry used gas limit )(\d+) \(failed with limit (\d+)/);
  if (gl) a.gasLimit = { floor: Number(gl[1]), failed: Number(gl[2]) };
  const gp = text.match(/(?:bid gas price >= |retry bid )(\d+) wei \(failed at (\d+)\)/);
  if (gp) a.gasPrice = { floor: gp[1], failed: gp[2] };
  const rs = text.match(/resubmit identical calldata\/gas after ~(\d+) blocks \((\d+)s\)/);
  if (rs) a.resubmit = `${rs[1]} blocks (${rs[2]}s)`;
  a.templateTx = text.match(/template tx (\S+)/)?.[1];
  return a;
}

export const isOutOfGas = (f: FailureFacts) =>
  Boolean(f.errorSig?.startsWith("out-of-gas")) || (!!f.gasLimit && (f.gasUsed ?? 0) >= f.gasLimit * 0.98);

/** Gas hints survive only if the remembered failure ran out of gas; otherwise the failure reason replaces them. */
export function gateGasHints(a: NextAction, f: FailureFacts): NextAction {
  if (isOutOfGas(f)) return { ...a, gasPrice: undefined };
  const why = `${f.errorDetail ?? "reverted, no reason"} (used ${f.gasUsed ?? "?"} of ${f.gasLimit ?? "?"} gas, not out of gas)`;
  return { ...a, gasLimit: undefined, gasPrice: undefined, reason: a.reason ?? why };
}

/** Plain-text block for the clipboard: full values, no truncation. */
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
  if (a.inputs?.length) {
    out.push(`- Change the transaction inputs like the retry:`);
    for (const i of a.inputs) out.push(`    input ${i.index} = ${i.to} (was ${i.from})`);
  }
  if (a.gasLimit) out.push(`- Out of gas: the failed attempt hit its limit of ${a.gasLimit.failed}; the retry used a limit of ${a.gasLimit.floor}. Consider >= ${a.gasLimit.floor}.`);
  if (a.resubmit) out.push(`- Calldata and gas were identical; the retry landed ${a.resubmit} later. State or timing likely changed, so resubmitting may be enough.`);
  return out.join("\n");
}

const n = (x: string | number) => Number(x).toLocaleString("en-US");

/** Short display lines: reason first, then what to change; gas only for out-of-gas failures. */
export function adviceLines(a: NextAction, max = 4): string[] {
  const out: string[] = [];
  if (a.reason) out.push(`reason: ${a.reason}`);
  if (a.callInstead) out.push(`call ${a.callInstead.to} instead of ${a.callInstead.from}`);
  if (a.value) out.push(`send value ${n(a.value.to)} wei (failed with ${n(a.value.from)})`);
  for (const c of a.calldata) out.push(`re-encode arg ${c.index} → ${clip(c.to)}`);
  if (a.moreWords) out.push(`+${a.moreWords} more calldata word${a.moreWords === 1 ? "" : "s"}; rebuild params like the retry`);
  for (const i of a.inputs ?? []) out.push(`change input ${i.index} → ${clip(i.to)}`);
  if (a.resubmit) out.push(`same calldata and gas; retry landed ${a.resubmit} later`);
  if (a.gasLimit) out.push(`out of gas at ${n(a.gasLimit.failed)}; retry used a limit of ${n(a.gasLimit.floor)}`);
  return out.slice(0, max);
}

export function clip(hex: string, n = 20) {
  if (hex.includes("…")) return hex;
  const t = hex.replace(/^0x/, "");
  return t.length > n ? `0x${t.slice(0, 10)}…${t.slice(-6)}` : hex;
}
