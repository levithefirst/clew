// GENERATED from src/measure.ts by web/scripts/sync-core.mjs. Do not edit here; edit src/ and run `npm run sync-core` in web/.
// Measurement harness: take a list of failed transactions and put memory-off next to memory-on, in a table.
// Nothing here runs a lookup by itself; `npm run measure` (scripts/measure.ts) is the live entry point and needs
// TATUM_API_KEY, MEMWAL_KEY and MEMWAL_ACCOUNT_ID (plus CLEW_SUI_LIVE=1 for Sui rows).
//   memory off = recall from an empty Walrus namespace (what an agent knows with no memory: the failure only)
//   memory on  = the real /v1/recall answer for the same failure, loaded once and recalled twice
import { loadFailure, parseRecallRequest, recallResponse, type AgentDeps, type RecallResponse } from "./agent.ts";
import { ClewError, EMPTY_NAMESPACE } from "./explain.ts";

export interface MeasureEntry { chain: string; hash: string }
export interface MeasureRow {
  chain: string; hash: string;
  /** Null when the failure could not be loaded; see `error`. */
  off: RecallResponse | null;
  on: RecallResponse | null;
  error?: string;
}

/**
 * One failure per line: `chain:hash`, `chain hash`, or `chain,hash`. Blank lines and # comments are skipped.
 * A bare 0x hash defaults to `defaultChain` (base), a bare Sui digest to sui.
 */
export function parseEntries(text: string, defaultChain = "base"): MeasureEntry[] {
  const out: MeasureEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/[\s,:]+/).filter(Boolean);
    const hash = parts.at(-1)!;
    const chain = parts.length > 1 ? parts[0].toLowerCase() : /^0x/i.test(hash) ? defaultChain : "sui";
    out.push({ chain, hash });
  }
  return out;
}

/** Run every entry in order (sequential: Tatum's free plan is 3 requests a second). Never throws for one bad row. */
export async function measure(entries: MeasureEntry[], deps: AgentDeps = {}, progress?: (row: MeasureRow, i: number, n: number) => void): Promise<MeasureRow[]> {
  const rows: MeasureRow[] = [];
  for (const [i, e] of entries.entries()) {
    let row: MeasureRow;
    try {
      const req = parseRecallRequest({ chain: e.chain, failedTxHash: e.hash });
      const f = await loadFailure(req.chain, req.hash, deps);
      const off = await recallResponse(f, { ...deps, namespace: EMPTY_NAMESPACE });
      const on = await recallResponse(f, deps);
      row = { chain: req.chain, hash: req.hash, off, on };
    } catch (err) {
      row = { chain: e.chain, hash: e.hash, off: null, on: null, error: err instanceof ClewError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err) };
    }
    rows.push(row);
    progress?.(row, i, entries.length);
  }
  return rows;
}

export interface MeasureSummary { rows: number; errors: number; memoryOffActed: number; memoryOnActed: number; memoryOnRetry: number; abort: number; abstain: number }

/** Counts for the footer. "Acted" means the answer carries a recommendation (action retry). */
export function summarize(rows: MeasureRow[]): MeasureSummary {
  const ok = rows.filter((r) => r.on && r.off);
  const n = (a: string) => ok.filter((r) => r.on!.action === a).length;
  return {
    rows: rows.length, errors: rows.length - ok.length,
    memoryOffActed: ok.filter((r) => r.off!.action === "retry").length, memoryOnActed: n("retry"),
    memoryOnRetry: n("retry"), abort: n("abort"), abstain: n("abstain"),
  };
}

const short = (h: string) => (h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h);
const cell = (s: string | number | boolean) => String(s).replace(/\|/g, "\\|");

/** A Markdown table, one row per failure, memory off beside memory on. */
export function toTable(rows: MeasureRow[]): string {
  const head = ["chain", "failed tx", "memory off", "memory on", "confidence", "successes", "later failures", "demotion", "prior retries", "most consistent change"];
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) {
    if (!r.on || !r.off) { lines.push(`| ${cell(r.chain)} | ${cell(short(r.hash))} | error | ${cell(r.error ?? "")} | | | | | | |`); continue; }
    const { on, off } = r;
    lines.push(`| ${[r.chain, short(r.hash), off.action, on.action, on.confidence, on.evidence.successes, on.evidence.laterFailures, on.demotionFlag, on.priorRetries, on.evidence.mostConsistentChange].map(cell).join(" | ")} |`);
  }
  const s = summarize(rows);
  lines.push("", `${s.rows} failures: memory off acted on ${s.memoryOffActed}; memory on returned retry for ${s.memoryOnRetry}, abort for ${s.abort}, abstain for ${s.abstain}${s.errors ? `; ${s.errors} could not be read` : ""}.`);
  return lines.join("\n");
}
