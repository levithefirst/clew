// CLI for the Sui adapter (Tatum Sui Mainnet gateway, GraphQL). Needs TATUM_API_KEY; record also needs MEMWAL keys unless --dry-run.
//   npm run sui:check [-- --record FILE]   feasibility: GraphQL reachable, recent failures decoded, a later retry from the same sender
//   npm run sui -- record <failedDigest> [successDigest] [--dry-run]
//   npm run sui -- recall <failedDigest> [--store ledger]
// --record writes every GraphQL request and response to FILE so a real run can become a test fixture.
import { writeFileSync } from "node:fs";
import { graphql, setRpc, tatumGraphql } from "../src/tatum.ts";
import { walrus, ledgerStore, type MemoryStore } from "../src/memory.ts";
import { findSuiRetry, listSuiTransactions, loadSuiAttempt, recordSuiRetry, onSuiFailure, type SuiAttempt } from "../src/sui.ts";

/** Sui Mainnet makes ~4 checkpoints per second: look at failures about 10 minutes old so their retries can exist. */
const FAILURE_AGE_CHECKPOINTS = 2_400;

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !["--store", "--record"].includes(rest[i - 1]));

const record = opt("--record");
if (record) {
  const calls: { query: string; variables: unknown; data: unknown }[] = [];
  setRpc(async (_chain, _method, [query, variables]: any[]) => {
    const data = await tatumGraphql(query, variables);
    calls.push({ query, variables, data });
    writeFileSync(record, JSON.stringify({ recordedAt: new Date().toISOString(), endpoint: "Tatum Sui Mainnet GraphQL", calls }, null, 2) + "\n");
    return data;
  });
}

let ok = true;
const line = (pass: boolean, name: string, detail: string) => { if (!pass) ok = false; console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`); };
async function step<T>(name: string, f: () => Promise<T>, show: (v: T) => string): Promise<T | undefined> {
  try { const v = await f(); line(true, name, show(v)); return v; }
  catch (e: any) { line(false, name, `${e.message}${e.cause?.message ? ` (${e.cause.message})` : ""}`); return undefined; }
}
const finish = (pairFound: boolean) => {
  console.log(ok
    ? `SUI GATEWAY OK: GraphQL reads, failure decoding and sender history work through Tatum${pairFound ? "; a real fail -> retry pair was found" : "; no fail -> retry pair in this sample"}`
    : "SUI GATEWAY NOT USABLE: see the FAIL lines above");
  process.exit(ok ? 0 : 2);
};

async function check() {
  const head = await step("graphql reachable (latest checkpoint)", () => graphql("{ checkpoint { sequenceNumber } }"), (d) => String(d.checkpoint.sequenceNumber));
  if (!head) return finish(false);
  const before = Number(head.checkpoint.sequenceNumber) - FAILURE_AGE_CHECKPOINTS;

  const page = await step(`recent programmable txs before checkpoint ${before}`,
    () => listSuiTransactions({ last: 50, filter: { kind: "PROGRAMMABLE_TX", beforeCheckpoint: before } }),
    (p) => `${p.attempts.length} txs, ${p.attempts.filter((a) => a.status === "failure").length} FAILURE`);
  if (!page) return finish(false);
  const failures = page.attempts.filter((a: SuiAttempt) => a.status === "failure");
  for (const f of failures) console.log(`INFO failure ${f.hash} checkpoint ${f.checkpoint} sender ${f.wallet}\n     ${f.errorSig} | calls ${f.calls.map((c) => `${c.module}::${c.function}`).join(", ") || "none"} | contract ${f.contract}`);
  if (!failures.length) { line(false, "failure sample", "no FAILURE among 50 programmable txs; run again"); return finish(false); }

  const one = await step("single transaction query", () => loadSuiAttempt(failures[0].hash), (a) => `${a.hash} ${a.status} ${a.errorSig} inputs ${a.inputs.length}`);
  if (!one) return finish(false);

  for (const f of failures.slice(0, 5)) {
    const retry = await step(`retry search for ${f.hash}`, () => findSuiRetry(f), (r) => (r ? `later SUCCESS ${r} from ${f.wallet} calling ${f.contract}` : `none from ${f.wallet} calling ${f.contract} within the window`));
    if (retry === undefined) return finish(false);
    if (retry) return finish(true);
  }
  finish(false);
}

try {
  if (cmd === "check") await check();
  else if (cmd === "record") {
    const [failed, given] = positional;
    if (!failed) throw new Error("usage: sui record <failedDigest> [successDigest] [--dry-run]");
    const success = given ?? (await findSuiRetry(await loadSuiAttempt(failed)));
    if (!success) { console.log("no later SUCCESS from the same sender calling the same package::module; nothing stored"); process.exit(0); }
    const dry = rest.includes("--dry-run");
    const noWrite: MemoryStore = { remember: async () => ({ blob_id: "(dry run, not written)", skipped: true }), recall: async () => [] };
    const r = await recordSuiRetry(failed, success, dry ? noWrite : walrus);
    console.log(`${dry ? "DRY RUN" : r.skipped ? "already stored" : "STORED"} job_id=${r.job_id ?? "-"} blob_id=${r.blob_id}\n${r.text}`);
  } else if (cmd === "recall") {
    const [failed] = positional;
    if (!failed) throw new Error("usage: sui recall <failedDigest> [--store ledger]");
    const r = await onSuiFailure(failed, { store: opt("--store") === "ledger" ? ledgerStore : walrus });
    console.log(`FAILURE sui ${r.failure.hash}\n  sender ${r.failure.wallet} -> ${r.failure.contract}\n  error ${r.failure.errorSig}`);
    console.log(r.matched ? `WITH MEMORY prior success ${r.priorPath.successTx} (checkpoint ${r.priorPath.successBlock}, blob ${r.memoryBlobId})\nNEXT ACTION\n${r.suggestion.replace(/^/gm, "  ")}` : `NO MATCH: ${r.message}`);
  } else throw new Error("usage: sui <check|record|recall> ...");
} catch (e: any) {
  console.error(`sui: ${e.message}`);
  process.exit(1);
}
