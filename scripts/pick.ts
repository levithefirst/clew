// Pick a small, diverse set of REAL fail->success pairs from discovery candidates (receipts via Tatum).
// Prefers wallets that failed AGAIN later with a similar error, so step 4 runs on real on-chain data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadAttempt, similarError } from "../src/clew.ts";

const quota: Record<string, number> = { base: 8, ethereum: 2, polygon: 2 };
const picked: any[] = [];
for (const chain of Object.keys(quota)) {
  const f = `fixtures/candidates-${chain}.json`; if (!existsSync(f)) continue;
  const cands = JSON.parse(readFileSync(f, "utf8"));
  const seenContracts = new Set<string>(); let n = 0;
  for (const c of cands) {
    if (n >= quota[chain]) break;
    if (seenContracts.has(c.contract)) continue;
    try {
      const fail = await loadAttempt(chain, c.fail);
      let nextFailure: string | null = null;
      for (const h of c.laterFails.slice(0, 2)) {
        const lf = await loadAttempt(chain, h);
        if (similarError(lf.errorSig!, fail.errorSig!)) { nextFailure = h; break; }
      }
      // keep at least half the quota for pairs with a real repeat failure
      if (!nextFailure && n < Math.ceil(quota[chain] / 2) && cands.some((x: any) => x.laterFails.length && !seenContracts.has(x.contract) && x !== c)) continue;
      seenContracts.add(c.contract); n++;
      picked.push({ chain, wallet: c.wallet, contract: c.contract, fail: c.fail, success: c.success, errorSig: fail.errorSig, nextFailure });
      console.log(chain, c.contract, fail.errorSig, nextFailure ? "repeat-fail:yes" : "");
    } catch (e: any) { console.log("skip", c.fail, e.message); }
  }
}
writeFileSync("fixtures/pairs.json", JSON.stringify(picked, null, 2) + "\n");
console.log(`picked ${picked.length} real pairs, ${picked.filter((p) => p.nextFailure).length} with a real repeat failure`);
