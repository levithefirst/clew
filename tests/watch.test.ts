// Watcher against a recorded fixture stream: reorg handling, watched vs unwatched failures, recall, cursor resume.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replay } from "./replay.ts";

const dir = mkdtempSync(join(tmpdir(), "clew-watch-"));
const W = "0x" + "a1".repeat(20), C = "0x" + "c1".repeat(20);
// A one-memory ledger for the watched pair (W -> C). memory.ts reads CLEW_LEDGER when it loads.
process.env.CLEW_LEDGER = join(dir, "ledger.json");
writeFileSync(process.env.CLEW_LEDGER, JSON.stringify({
  [`base:0x01:0x02`]: { blob_id: "blobW", namespace: "clew", written_at: "2026-01-01T00:00:00Z", text:
    `CLEW chain=base contract=${C} wallet=${W} error=revert:too_little_received selector=0x38ed1739 failed_tx=0x01 success_tx=0x02 success_block=90. ` +
    `Contract ${C} on base failed with error revert:too_little_received (Too little received) for wallet ${W}. Successful retry in tx 0x02 at block 90, 2 blocks later. ` +
    `Change: gas used was 12000 vs 12000 on failure; gas limit 200000 vs 200000; nonce 7 -> 8; same function 0x38ed1739; 1 arg word(s) changed (arg 1 0x3de -> 0x3b6). ` +
    `NEXT_ACTION: reason: Too little received (used 12000 of 200000 gas, not out of gas); re-encode calldata: arg word 1 = 0x3b6 (was 0x3de); template tx 0x02` },
}));

const { setRpc } = await import("../src/tatum.ts");
const { watch, loadCursor } = await import("../src/watch.ts");
const { ledgerStore } = await import("../src/memory.ts");
const stream = JSON.parse(readFileSync("fixtures/watch-stream.json", "utf8"));
const cursorFile = join(dir, "cursor.json");
const run = async (opts: { from?: number; maxBlocks: number }) => {
  const events = [];
  for await (const e of watch("base", { store: ledgerStore, cursorFile, sleep: async () => {}, ...opts })) events.push(e);
  return events;
};

test("watcher: reorg rewinds, only watched failures are recalled, cursor tracks the canonical chain", async () => {
  setRpc(replay(stream.calls));
  const events = await run({ from: 100, maxBlocks: 5 }); // 100, 101, 102 (orphaned), 102, 103
  assert.deepEqual(events.map((e) => e.type), ["start", "block", "block", "failure", "recall", "block", "reorg", "block", "block"]);
  assert.deepEqual(events.filter((e) => e.type === "block").map((e: any) => e.block), [100, 101, 102, 102, 103]);
  const reorg: any = events.find((e) => e.type === "reorg");
  assert.deepEqual([reorg.block, reorg.rewoundTo], [103, 101]);

  const fail: any = events.find((e) => e.type === "failure");
  assert.equal(fail.wallet, W); // the unwatched wallet's failure in the same block is not reported
  const recall: any = events.find((e) => e.type === "recall");
  assert.equal(recall.result.matched, true);
  assert.equal(recall.result.priorPath.successTx, "0x02");
  assert.match(recall.result.suggestion, /Failure reason: Too little received/);

  const c = loadCursor(cursorFile, "base")!;
  assert.equal(c.block, 103);
  assert.deepEqual(c.hashes.slice(-2), ["0x" + "12".repeat(32), "0x" + "13".repeat(32)]); // block 102 is the replacement
  assert.deepEqual(c.seen, ["0x" + "f1".repeat(32)]);
});

test("watcher: resumes from the saved cursor, not from --from", async () => {
  const events = await run({ from: 1, maxBlocks: 1 });
  assert.deepEqual(events[0], { type: "start", chain: "base", block: 104, pairs: 1, resumed: true });
  const f: any = events.find((e) => e.type === "failure");
  assert.equal(f.hash, "0x" + "f3".repeat(32));
  assert.equal(loadCursor(cursorFile, "base")!.block, 104);
});

test("cursor file for another chain is refused", () => {
  assert.throws(() => loadCursor(cursorFile, "ethereum"), /is a base cursor, not ethereum/);
});
