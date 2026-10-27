// CLI: npx tsx scripts/check.ts <chain> <failedTxHash>  -> Clew's answer for a failure.
import { onFailure } from "../src/clew.ts";
const [chain, hash] = process.argv.slice(2);
if (!chain || !hash) { console.error("usage: check.ts <chain> <failedTxHash>"); process.exit(1); }
const r = await onFailure(chain, hash);
console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
