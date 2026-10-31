// CLI for the Sui adapter (Tatum Sui Mainnet gateway). Needs TATUM_API_KEY; record also needs MEMWAL keys unless --dry-run.
//   npm run sui:check                                  feasibility: gateway, chain id, a real failed Move call, its retry
//   npm run sui -- record <failedDigest> [successDigest] [--dry-run]
//   npm run sui -- recall <failedDigest> [--store ledger]
import { rpc } from "../src/tatum.ts";
import { walrus, ledgerStore, type MemoryStore } from "../src/memory.ts";
import { SUI, SUI_MAINNET_ID, toSuiAttempt, findSuiRetry, loadSuiAttempt, recordSuiRetry, onSuiFailure, type SuiAttempt } from "../src/sui.ts";

const [cmd, ...rest] = process.argv.slice(2);
const step = (ok: boolean, name: string, detail: string) => console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);

async function check() {
  let ok = true;
  const tryStep = async <T>(name: string, f: () => Promise<T>, show: (v: T) => string): Promise<T | undefined> => {
    try { const v = await f(); step(true, name, show(v)); return v; }
    catch (e: any) { ok = false; step(false, name, `${e.code ? `code ${e.code}: ` : ""}${e.message}${e.cause?.message ? ` (${e.cause.message})` : ""}`); return undefined; }
  };
  const id = await tryStep("chain id", () => rpc(SUI, "sui_getChainIdentifier", []), (v) => `${v}${v === SUI_MAINNET_ID ? " (Sui Mainnet)" : ` (expected ${SUI_MAINNET_ID})`}`);
  if (id !== SUI_MAINNET_ID) return finish(false);
  const head = await tryStep("latest checkpoint", () => rpc(SUI, "sui_getLatestCheckpointSequenceNumber", []), String);
  if (head === undefined) return finish(false);

  const failures: SuiAttempt[] = [];
  for (let seq = Number(head); seq > Number(head) - 20 && failures.length < 5; seq--) {
    const cp = await rpc(SUI, "sui_getCheckpoint", [String(seq)]);
    const digests: string[] = cp?.transactions ?? [];
    for (let i = 0; i < digests.length; i += 50) {
      const txs = await rpc(SUI, "sui_multiGetTransactionBlocks", [digests.slice(i, i + 50), { showInput: true, showEffects: true }]);
      failures.push(...txs.map(toSuiAttempt).filter((a: SuiAttempt) => a.status === "failure" && a.contract.includes("::")));
    }
  }
  step(failures.length > 0, "failed Move calls in the last 20 checkpoints", failures.length ? failures.map((f) => `${f.hash} ${f.errorSig}`).join(", ") : "none found (try again later)");
  for (const f of failures) {
    const retry = await findSuiRetry(f);
    if (retry) { step(true, "fail -> retry pair", `sender ${f.wallet} target ${f.contract}: failed ${f.hash} -> retry ${retry}`); return finish(ok); }
  }
  console.log(`INFO no successful retry yet for those failures; Sui pairs need time (or a wider scan) to appear`);
  finish(ok && failures.length > 0);
}

function finish(ok: boolean) {
  console.log(ok ? "SUI GATEWAY OK: reads, failure decoding and history queries work through Tatum" : "SUI GATEWAY NOT USABLE: see the FAIL lines above");
  process.exit(ok ? 0 : 2);
}

const store = (): MemoryStore => (rest.includes("--store") && rest[rest.indexOf("--store") + 1] === "ledger" ? ledgerStore : walrus);
const positional = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--store");

try {
  if (cmd === "check") await check();
  else if (cmd === "record") {
    const [failed, given] = positional;
    if (!failed) throw new Error("usage: sui record <failedDigest> [successDigest] [--dry-run]");
    const success = given ?? (await findSuiRetry(await loadSuiAttempt(failed)));
    if (!success) { console.log("no successful retry from the same sender to the same Move target; nothing stored"); process.exit(0); }
    const dry = rest.includes("--dry-run");
    const noWrite: MemoryStore = { remember: async () => ({ blob_id: "(dry run, not written)", skipped: true }), recall: async () => [] };
    const r = await recordSuiRetry(failed, success, dry ? noWrite : walrus);
    console.log(`${dry ? "DRY RUN" : r.skipped ? "already stored" : "STORED"} job_id=${r.job_id ?? "-"} blob_id=${r.blob_id}\n${r.text}`);
  } else if (cmd === "recall") {
    const [failed] = positional;
    if (!failed) throw new Error("usage: sui recall <failedDigest> [--store ledger]");
    const r = await onSuiFailure(failed, { store: store() });
    console.log(`FAILURE sui ${r.failure.hash}\n  sender ${r.failure.wallet} -> ${r.failure.contract}\n  error ${r.failure.errorSig}`);
    console.log(r.matched ? `WITH MEMORY prior success ${r.priorPath.successTx} (checkpoint ${r.priorPath.successBlock}, blob ${r.memoryBlobId})\nNEXT ACTION\n${r.suggestion.replace(/^/gm, "  ")}` : `NO MATCH: ${r.message}`);
  } else throw new Error("usage: sui <check|record|recall> ...");
} catch (e: any) {
  console.error(`sui: ${e.message}`);
  process.exit(1);
}
