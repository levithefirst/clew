// Clew loop demo on Mainnet: failure (Tatum) -> successful retry (Tatum) -> memory (Walrus) -> next failure gets the prior path.
// Idempotent: pairs already in memories.json are not re-written to Walrus.
import { readFileSync } from "node:fs";
import { recordFailure, watchForRetry, recordRetry, onFailure } from "../src/clew.ts";
import { RELAYER, NAMESPACE } from "../src/memory.ts";

const pairs: any[] = JSON.parse(readFileSync("fixtures/pairs.json", "utf8"));
const cands = (c: string): any[] => JSON.parse(readFileSync(`fixtures/candidates-${c}.json`, "utf8"));
const log = console.log;
log(`Clew demo — Tatum RPC gateways + Walrus Memory relayer ${RELAYER}, namespace "${NAMESPACE}"`);
log(`${pairs.length} REAL on-chain fail->success pairs (discovered by scripts/discover.ts, all receipts via Tatum)\n`);

// 1) Watcher: from a failure alone, find the successful retry on-chain.
const gap = (p: any) => { const c = cands(p.chain).find((x) => x.fail === p.fail); return c ? c.successBlock - c.failBlock : 1e9; };
const w = [...pairs].filter((p) => p.chain === "base").sort((a, b) => gap(a) - gap(b))[0];
const wf = await recordFailure(w.chain, w.fail);
log(`[1] FAILURE ingested via Tatum: ${wf.chain} tx ${wf.hash}\n    wallet ${wf.wallet} -> contract ${wf.contract}, status 0x0, error ${wf.errorSig} (${wf.errorDetail}), block ${wf.block}`);
const found = await watchForRetry(wf, 10 * 60_000);
log(`    watchForRetry -> successful retry ${found} (${found === w.success ? "matches" : "differs from"} discovery)\n`);

// 2+3) Record every pair: diff + memory write (remember -> waitForRememberJob).
log(`[2-3] RECORD retry pairs -> Walrus Mainnet memories`);
let written = 0, skipped = 0;
for (const p of pairs) {
  const r = await recordRetry(p.chain, p.fail, p.success);
  r.skipped ? skipped++ : written++;
  log(`  - ${p.chain} ${r.failure.contract} ${r.failure.errorSig}\n    fail ${r.failure.hash} -> retry ${r.success.hash} (+${r.diff.blocksLater} blocks)\n    ${r.skipped ? "already stored" : "STORED"} job=${r.job_id} blob=${r.blob_id}`);
}
log(`  memories written this run: ${written}, already on Walrus from earlier runs: ${skipped}, total: ${written + skipped}\n`);

// 4) A NEW failure, same wallet + contract + similar error -> recall changes the next action.
log(`[4] NEXT FAILURE -> recall prior successful path`);
const repeats = pairs.filter((p) => p.nextFailure);
for (const p of repeats.slice(0, 3)) {
  const r = await onFailure(p.chain, p.nextFailure);
  const without = await onFailure(p.chain, p.nextFailure, { namespace: "clew-counterfactual-empty" });
  log(`  new failure ${p.chain} ${p.nextFailure}\n    error ${r.failure.errorSig}`);
  log(`    WITHOUT memory: ${without.matched ? "??" : without.message}`);
  if (r.matched) log(`    WITH memory   : prior success ${r.priorPath.successTx} (block ${r.priorPath.successBlock}, blob ${r.memoryBlobId})\n                    change: ${r.priorPath.change}\n                    NEXT ACTION: ${r.suggestion}`);
  else log(`    WITH memory   : no match (${r.message})`);
}

// Counterfactual: a different wallet failing on a remembered contract gets no borrowed path.
const stored = new Set(pairs.map((p) => `${p.chain}|${p.contract}`)), wallets = new Set(pairs.map((p) => p.wallet));
const other = pairs.map((p) => cands(p.chain).find((c) => c.contract === p.contract && !wallets.has(c.wallet))).find(Boolean);
if (other && stored.has(`${other.chain}|${other.contract}`)) {
  const r = await onFailure(other.chain, other.fail);
  log(`\n  counterfactual: other wallet ${other.wallet} failing on remembered contract ${other.contract}\n    -> ${r.matched ? "matched (unexpected)" : r.message}`);
}
