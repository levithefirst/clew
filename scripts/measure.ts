// Memory-off vs memory-on for a list of failed transactions. LIVE: reads each failure through Tatum and recalls
// from Walrus twice (empty namespace, then the real one). Needs TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID;
// Sui rows also need CLEW_SUI_LIVE=1.
//   npm run measure -- hashes.txt            one `chain:hash` per line (# comments allowed)
//   npm run measure -- base:0xd72b…  sui:Gx… hashes as arguments
//   npm run measure -- hashes.txt --json     the rows as JSON instead of a table
import { readFileSync, existsSync } from "node:fs";
import { measure, parseEntries, toTable } from "../src/measure.ts";

const args = process.argv.slice(2), json = args.includes("--json");
const inputs = args.filter((a) => !a.startsWith("--"));
if (!inputs.length) { console.error("usage: npm run measure -- <file | chain:hash ...> [--json]"); process.exit(2); }
const text = inputs.map((a) => (existsSync(a) ? readFileSync(a, "utf8") : a)).join("\n");
const entries = parseEntries(text);
if (!entries.length) { console.error("no transactions found in the input"); process.exit(2); }

const rows = await measure(entries, {}, (r, i, n) => console.error(`[${i + 1}/${n}] ${r.chain} ${r.hash.slice(0, 12)}… ${r.error ? "error" : r.on!.action}`));
console.log(json ? JSON.stringify(rows, null, 2) : toTable(rows));
