// CLI: npx tsx scripts/record.ts <chain> <failedTxHash> [successTxHash]  -> watch (if no success given) + write memory.
import { recordFailure, watchForRetry, recordRetry } from "../src/clew.ts";
const [chain, failed, given] = process.argv.slice(2);
if (!chain || !failed) { console.error("usage: record.ts <chain> <failedTxHash> [successTxHash]"); process.exit(1); }
const success = given ?? (await watchForRetry(await recordFailure(chain, failed)));
if (!success) { console.log("no successful retry within window; nothing stored"); process.exit(0); }
const r = await recordRetry(chain, failed, success);
console.log(r.skipped ? "already stored" : "stored", { job_id: r.job_id, blob_id: r.blob_id }, "\n" + r.text);
