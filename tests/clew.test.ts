// Offline: mocked Tatum RPC + in-memory store. Covers revert decoding, error signature, diff, and the recall loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRpc, decodeRevert } from "../src/tatum.ts";
import { readFileSync } from "node:fs";
import { errorSignature, similarError, diffAttempts, recordRetry, onFailure, parseNextAction, formatNextAction, type Attempt } from "../src/clew.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const W = "0x" + "a".repeat(40), C = "0x" + "c".repeat(40), W2 = "0x" + "b".repeat(40);
const word = (n: number) => n.toString(16).padStart(64, "0");
const errStr = (s: string) => "0x08c379a0" + word(32) + word(s.length) + Buffer.from(s).toString("hex").padEnd(64, "0");
const sel = "0x38ed1739";
const txs: Record<string, any> = {
  "0xf1": { from: W, to: C, status: "0x0", input: sel + word(1000) + word(990), gas: 200000, used: 150000, nonce: 7, block: 100, out: errStr("Too little received") },
  "0xs1": { from: W, to: C, status: "0x1", input: sel + word(1000) + word(950), gas: 200000, used: 160000, nonce: 8, block: 103 },
  "0xf2": { from: W, to: C, status: "0x0", input: sel + word(2000) + word(1990), gas: 200000, used: 150000, nonce: 9, block: 200, out: errStr("Too little received") },
  "0xf3": { from: W2, to: C, status: "0x0", input: sel + word(1) + word(1), gas: 200000, used: 150000, nonce: 1, block: 201, out: errStr("Too little received") },
};
const hex = (n: number) => "0x" + n.toString(16);
setRpc(async (_c, method, params: any[]) => {
  const t = txs[params[0]];
  switch (method) {
    case "eth_getTransactionReceipt": return { from: t.from, to: t.to, status: t.status, gasUsed: hex(t.used), blockNumber: hex(t.block), effectiveGasPrice: "0x3b9aca00" };
    case "eth_getTransactionByHash": return { from: t.from, to: t.to, input: t.input, gas: hex(t.gas), nonce: hex(t.nonce), value: "0x0", blockNumber: hex(t.block), gasPrice: "0x3b9aca00" };
    case "eth_getBlockByNumber": return { timestamp: hex(1_700_000_000 + parseInt(params[0], 16) * 2) };
    case "debug_traceTransaction": return { output: t.out, error: "execution reverted" };
  }
  throw new Error("unmocked " + method);
});
const mem: { text: string; ns: string }[] = [];
const store: MemoryStore = {
  async remember(text) { mem.push({ text, ns: "clew" }); return { blob_id: "blob" + mem.length }; },
  async recall(_q, o = {}): Promise<Recalled[]> { return mem.filter((m) => m.ns === (o.namespace ?? "clew")).map((m, i) => ({ text: m.text, blob_id: "blob" + (i + 1), distance: 0.1 })); },
};

test("decodes Error(string), Panic, custom", () => {
  assert.equal(decodeRevert(errStr("Too little received")).reason, "Too little received");
  assert.match(decodeRevert("0x4e487b71" + word(0x11)).reason!, /overflow/);
  assert.equal(decodeRevert("0x3b9e41d7").kind, "custom");
  assert.equal(decodeRevert("0x").kind, "none");
});

test("error signature normalizes and falls back to selector", () => {
  assert.equal(errorSignature(decodeRevert(errStr("Too little received: 123")), sel, 1, 10), "revert:too_little_received:_n");
  assert.equal(errorSignature(decodeRevert("0x3b9e41d7"), sel, 1, 10), "custom:0x3b9e41d7");
  assert.equal(errorSignature(decodeRevert("0x4e487b71" + word(0x11)), sel, 1, 10), "panic:11");
  assert.equal(errorSignature({ kind: "none", data: "" }, sel, 5, 10), `${sel}:reverted`);
  assert.equal(errorSignature({ kind: "none", data: "" }, sel, 10, 10), `out-of-gas:${sel}`);
  assert.ok(similarError("revert:too_little_received", "revert:too_little_received:_n"));
  assert.ok(!similarError("custom:0x3b9e41d7", "custom:0x857ade7c"));
});

test("diff finds changed calldata words and gas", () => {
  const base = { chain: "base", hash: "0x1", wallet: W, contract: C, status: "failure", selector: sel, value: 0n, gasPrice: 1n, timestamp: 0 } as const;
  const f: Attempt = { ...base, input: sel + word(1) + word(2), nonce: 1, gasLimit: 100, gasUsed: 100, block: 1 };
  const s: Attempt = { ...base, status: "success", hash: "0x2", input: sel + word(1) + word(3), nonce: 2, gasLimit: 300, gasUsed: 150, block: 4, timestamp: 6 };
  const d = diffAttempts(f, s);
  assert.deepEqual(d.args, [{ index: 1, from: "0x2", to: "0x3" }]);
  assert.deepEqual(d.gasLimit, [100, 300]);
  assert.equal(d.blocksLater, 3);
});

test("loop: retry is remembered, next similar failure gets the prior path; others get generic", async () => {
  const r = await recordRetry("base", "0xf1", "0xs1", store);
  assert.match(r.text, /arg 1 0x3de -> 0x3b6/);
  const hit = await onFailure("base", "0xf2", { store });
  assert.equal(hit.matched, true);
  if (hit.matched) { assert.equal(hit.priorPath.successTx, "0xs1"); assert.match(hit.suggestion!, /arg word 1 = 0x3b6/); }
  assert.equal((await onFailure("base", "0xf3", { store })).matched, false); // other wallet
  assert.equal((await onFailure("base", "0xf2", { store, namespace: "empty" })).matched, false); // no memory
});

test("next action: real stored Base memory parses into calldata + qualified gas floor", () => {
  const ledger = JSON.parse(readFileSync("memories.json", "utf8"));
  const text: string = Object.values<any>(ledger).find((m) => m.text.includes("success_tx=0x389a50464dd3")).text;
  const a = parseNextAction(text.match(/NEXT_ACTION: (.*)$/)![1]);
  assert.deepEqual(a.calldata.map((c) => c.index), [4, 15, 16]);
  assert.equal(a.calldata[0].to, "0x40345a5d65e9884189");
  assert.equal(a.moreWords, 1);
  assert.deepEqual(a.gasPrice, { floor: "9532143", failed: "5916993" });
  assert.equal(a.templateTx, "0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03");
  const s = formatNextAction(a);
  assert.match(s, /arg word 4 = 0x40345a5d65e9884189 \(was 0x4034297ede533478d4\)/);
  assert.match(s, /Consider bidding >= 9532143 wei/);
  assert.match(s, /does not prove it caused the revert/);
  assert.doesNotMatch(s, /—/);
  // new wording round-trips through the same parser
  assert.deepEqual(parseNextAction("retry used gas limit 900 (failed with limit 500, retry used 700); consider gas limit >= 900; retry bid 20 wei (failed at 10); consider bidding >= 20 wei; template tx 0xabc").gasLimit, { floor: 900, failed: 500 });
});
