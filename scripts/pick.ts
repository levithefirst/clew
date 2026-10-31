// Pick a small, diverse set of REAL fail->success pairs from discovery candidates (receipts via Tatum).
// Ranking: human-like wallets first (src/classify.ts), then pairs whose wallet failed AGAIN later with a similar
// error, so step 4 runs on real on-chain data. One pair per contract. Writes fixtures/pairs.json.
//   npx tsx scripts/pick.ts [base=8] [ethereum=2] [polygon=2]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadAttempt, similarError } from "../src/clew.ts";
import { classifyWallet } from "../src/classify.ts";

const quota: Record<string, number> = Object.fromEntries(
  (process.argv.length > 2 ? process.argv.slice(2) : ["base=8", "ethereum=2", "polygon=2"]).map((q) => [q.split("=")[0], Number(q.split("=")[1])]),
);
const scans: Record<string, number> = JSON.parse(readFileSync("fixtures/scans.json", "utf8"));
// Classifying costs ~8 Tatum calls per candidate (two txs, receipts, blocks, trace) at 3 req/s: cap the pool per chain.
// Candidates are pre-sorted by discovery with repeat failures first.
const MAX_EVAL = 40;

const picked: any[] = [];
for (const chain of Object.keys(quota)) {
  const f = `fixtures/candidates-${chain}.json`;
  if (!existsSync(f)) continue;
  const scored: any[] = [];
  for (const c of JSON.parse(readFileSync(f, "utf8")).slice(0, MAX_EVAL)) {
    try {
      const fail = await loadAttempt(chain, c.fail), ok = await loadAttempt(chain, c.success);
      const cls = classifyWallet({
        chain, nonce: fail.nonce, retryNonce: ok.nonce, retryBlocks: ok.block - fail.block, retrySeconds: ok.timestamp - fail.timestamp,
        calls: c.total, fails: c.fails, scanBlocks: c.scanBlocks ?? scans[chain],
      });
      let nextFailure: string | null = null;
      for (const h of c.laterFails.slice(0, 2)) {
        if (similarError((await loadAttempt(chain, h)).errorSig!, fail.errorSig!)) { nextFailure = h; break; }
      }
      scored.push({ chain, wallet: c.wallet, contract: c.contract, fail: c.fail, success: c.success, errorSig: fail.errorSig, nextFailure, class: cls });
    } catch (e: any) { console.log("skip", c.fail, e.message); }
    if (scored.filter((s) => s.class.label === "human-like" && s.nextFailure).length >= quota[chain]) break;
  }
  const rank = (s: any) => (s.class.label === "human-like" ? 0 : 2) + (s.nextFailure ? 0 : 1);
  const contracts = new Set<string>();
  for (const s of scored.sort((a, b) => rank(a) - rank(b))) {
    if (picked.filter((p) => p.chain === chain).length >= quota[chain]) break;
    if (contracts.has(s.contract)) continue;
    contracts.add(s.contract);
    picked.push(s);
    console.log(chain, s.contract, s.errorSig, s.class.label, s.nextFailure ? "repeat-fail:yes" : "");
  }
}
writeFileSync("fixtures/pairs.json", JSON.stringify(picked, null, 2) + "\n");
console.log(`picked ${picked.length} real pairs: ${picked.filter((p) => p.class.label === "human-like").length} human-like, ` +
  `${picked.filter((p) => p.nextFailure).length} with a real repeat failure`);
