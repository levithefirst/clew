// CLI: npx tsx scripts/record.ts <chain> <failedTxHash> [successTxHash] [--rev N] [--dry-run]
//   Watches for the retry if successTxHash is omitted, then writes the memory to Walrus.
//   --rev N     write a corrected rewrite of an existing memory (new idempotency key chain:failed:success:rN);
//               the original stays on Walrus, the ledger links the two, recall prefers the highest rev.
//   --dry-run   read both txs through Tatum and print the memory text; write nothing (no MEMWAL keys needed).
import { recordFailure, watchForRetry, recordRetry, memoryKey } from "../src/clew.ts";
import { walrus, readLedger, supersededKey, type MemoryStore } from "../src/memory.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const revAt = args.indexOf("--rev");
const rev = revAt < 0 ? 1 : Number(args[revAt + 1]);
const [chain, failed, given] = args.filter((a, i) => !a.startsWith("--") && (revAt < 0 || i !== revAt + 1));
if (!chain || !failed || !Number.isInteger(rev) || rev < 1) {
  console.error("usage: record.ts <chain> <failedTxHash> [successTxHash] [--rev N] [--dry-run]");
  process.exit(1);
}
const success = given ?? (await watchForRetry(await recordFailure(chain, failed)));
if (!success) { console.log("no successful retry within window; nothing stored"); process.exit(0); }

const key = memoryKey(chain, failed.toLowerCase(), success.toLowerCase(), rev);
const replaces = supersededKey(key);
if (replaces && !readLedger()[replaces]) { console.error(`--rev ${rev}: ${replaces} is not in memories.json`); process.exit(1); }

const noWrite: MemoryStore = { remember: async () => ({ blob_id: "(dry run, not written)", skipped: true }), recall: async () => [] };
const r = await recordRetry(chain, failed, success, dryRun ? noWrite : walrus, rev);
console.log(`${dryRun ? "DRY RUN" : r.skipped ? "already stored" : "STORED"} key=${key}${replaces ? ` supersedes=${replaces}` : ""}`);
console.log(`job_id=${r.job_id ?? "-"} blob_id=${r.blob_id} text_length=${r.text.length}`);
console.log(r.text);
