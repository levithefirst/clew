// CLI: npm run watch -- <chain> [--from N] [--blocks N] [--store walrus|ledger] [--cursor FILE] [--record FILE] [--verbose]
//   Polls Tatum for new failed txs from wallet -> contract pairs that have a memory, and prints the recalled path.
//   --from N       first block when there is no saved cursor (default: head)
//   --blocks N     stop after N blocks (default: run until Ctrl-C)
//   --store        walrus (default; needs MEMWAL keys) or ledger (memories.json; needs only TATUM_API_KEY)
//   --cursor FILE  resume file (default .clew/watch-<chain>.json, git-ignored)
//   --record FILE  save every RPC call and result to FILE, for replay in tests
import { writeFileSync } from "node:fs";
import { watch } from "../src/watch.ts";
import { setRpc, tatumRpc } from "../src/tatum.ts";
import { walrus, ledgerStore } from "../src/memory.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const chain = args[0];
if (!chain || chain.startsWith("--")) {
  console.error("usage: watch.ts <chain> [--from N] [--blocks N] [--store walrus|ledger] [--cursor FILE] [--record FILE] [--verbose]");
  process.exit(1);
}
const storeName = opt("--store") ?? "walrus";
if (storeName !== "walrus" && storeName !== "ledger") { console.error(`--store must be walrus or ledger, not ${storeName}`); process.exit(1); }
const cursorFile = opt("--cursor") ?? `.clew/watch-${chain}.json`;
const verbose = args.includes("--verbose");

const record = opt("--record");
if (record) {
  const calls: { method: string; params: unknown[]; result: unknown }[] = [];
  setRpc(async (c, method, params) => {
    const result = await tatumRpc(c, method, params);
    calls.push({ method, params, result });
    writeFileSync(record, JSON.stringify({ chain, recordedAt: new Date().toISOString(), calls }, null, 2) + "\n");
    return result;
  });
}

for await (const e of watch(chain, {
  store: storeName === "ledger" ? ledgerStore : walrus,
  cursorFile,
  from: opt("--from") ? Number(opt("--from")) : undefined,
  maxBlocks: opt("--blocks") ? Number(opt("--blocks")) : undefined,
})) {
  switch (e.type) {
    case "start":
      console.log(`WATCH ${e.chain} from block ${e.block} (${e.resumed ? "resumed" : "new"} cursor ${cursorFile}), ${e.pairs} wallet+contract pairs with memories, store ${storeName}`);
      break;
    case "block":
      if (verbose || e.block % 50 === 0) console.log(`block ${e.block} (${e.receipts} receipts)`);
      break;
    case "reorg":
      console.log(`REORG at block ${e.block}: parent hash changed, rewound to ${e.rewoundTo}`);
      break;
    case "failure":
      console.log(`FAILURE ${e.chain} block ${e.block} tx ${e.hash}\n  wallet ${e.wallet} -> contract ${e.contract}`);
      break;
    case "recall": {
      const r = e.result;
      console.log(`  error ${r.failure.errorSig} (${r.failure.errorDetail})`);
      if (!r.matched) { console.log(`  NO MATCH: ${r.message}`); break; }
      console.log(`  WITH MEMORY prior success ${r.priorPath.successTx} (block ${r.priorPath.successBlock}, blob ${r.memoryBlobId})`);
      console.log(`  NEXT ACTION\n${r.suggestion.replace(/^/gm, "    ")}`);
      break;
    }
    case "error":
      console.log(`  ERROR ${e.hash}: ${e.message}`);
      break;
  }
}
