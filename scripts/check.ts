// CLI: npx tsx scripts/check.ts <chain> <failedTxHash> [--without-memory] [--json]  -> Clew's answer for a failure.
//   --without-memory  recall from an empty namespace: the generic answer Clew gives when nothing is stored
//   --json            raw result instead of the readable summary
import { onFailure } from "../src/clew.ts";
const args = process.argv.slice(2), flags = new Set(args.filter((a) => a.startsWith("--")));
const [chain, hash] = args.filter((a) => !a.startsWith("--"));
if (!chain || !hash) { console.error("usage: check.ts <chain> <failedTxHash> [--without-memory] [--json]"); process.exit(1); }
const t0 = Date.now();
const r = await onFailure(chain, hash, flags.has("--without-memory") ? { namespace: "clew-counterfactual-empty" } : {});
if (flags.has("--json")) {
  console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  process.exit(0);
}
const f = r.failure;
console.log(`FAILURE  ${f.chain} ${f.hash}`);
console.log(`         wallet ${f.wallet} -> contract ${f.contract}, status 0x0, block ${f.block}`);
console.log(`         error ${f.errorSig} (${f.errorDetail})`);
if (!r.matched) {
  console.log(`\nWITHOUT MEMORY\n  ${r.message}`);
} else {
  console.log(`\nWITH MEMORY  (Walrus blob ${r.memoryBlobId})`);
  console.log(`  prior failure ${r.priorPath.failedTx}`);
  console.log(`  prior success ${r.priorPath.successTx} (block ${r.priorPath.successBlock})`);
  console.log(`\nNEXT ACTION\n${r.suggestion.replace(/^/gm, "  ")}`);
}
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
