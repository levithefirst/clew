// Offline: mocked Tatum RPC + in-memory store. Covers revert decoding, error signature, diff, and the recall loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRpc, decodeRevert } from "../src/tatum.ts";
import { readFileSync } from "node:fs";
import { errorSignature, similarError, diffAttempts, recordRetry, onFailure, parseNextAction, formatNextAction, gateGasHints, rememberedFailure, memoryKey, memoryText, type Attempt } from "../src/clew.ts";
import { supersededKey, type MemoryStore, type Recalled } from "../src/memory.ts";

const W = "0x" + "a".repeat(40), C = "0x" + "c".repeat(40), W2 = "0x" + "b".repeat(40), C2 = "0x" + "d".repeat(40), C3 = "0x" + "e".repeat(40);
const word = (n: number) => n.toString(16).padStart(64, "0");
const errStr = (s: string) => "0x08c379a0" + word(32) + word(s.length) + Buffer.from(s).toString("hex").padEnd(64, "0");
const sel = "0x38ed1739";
const txs: Record<string, any> = {
  "0xf1": { from: W, to: C, status: "0x0", input: sel + word(1000) + word(990), gas: 200000, used: 150000, nonce: 7, block: 100, out: errStr("Too little received") },
  "0xs1": { from: W, to: C, status: "0x1", input: sel + word(1000) + word(950), gas: 200000, used: 160000, nonce: 8, block: 103 },
  "0xf2": { from: W, to: C, status: "0x0", input: sel + word(2000) + word(1990), gas: 200000, used: 150000, nonce: 9, block: 200, out: errStr("Too little received") },
  "0xf3": { from: W2, to: C, status: "0x0", input: sel + word(1) + word(1), gas: 200000, used: 150000, nonce: 1, block: 201, out: errStr("Too little received") },
  // Out of gas: burned the whole limit, no revert data; the retry raised the limit.
  "0xf4": { from: W, to: C2, status: "0x0", input: sel + word(5), gas: 100000, used: 100000, nonce: 20, block: 300, out: "0x", err: "out of gas" },
  "0xs4": { from: W, to: C2, status: "0x1", input: sel + word(5), gas: 250000, used: 180000, nonce: 21, block: 302 },
  // A revert retried with a much higher gas limit and price: gas changed, but gas was not the cause.
  "0xf5": { from: W, to: C3, status: "0x0", input: sel + word(7), gas: 100000, used: 30000, nonce: 30, block: 400, out: errStr("Expired") },
  "0xs5": { from: W, to: C3, status: "0x1", input: sel + word(8), gas: 300000, used: 60000, nonce: 31, block: 401, price: "0x77359400" },
};
const hex = (n: number) => "0x" + n.toString(16);
setRpc(async (_c, method, params: any[]) => {
  const t = txs[params[0]];
  switch (method) {
    case "eth_getTransactionReceipt": return { from: t.from, to: t.to, status: t.status, gasUsed: hex(t.used), blockNumber: hex(t.block), effectiveGasPrice: t.price ?? "0x3b9aca00" };
    case "eth_getTransactionByHash": return { from: t.from, to: t.to, input: t.input, gas: hex(t.gas), nonce: hex(t.nonce), value: "0x0", blockNumber: hex(t.block), gasPrice: "0x3b9aca00" };
    case "eth_getBlockByNumber": return { timestamp: hex(1_700_000_000 + parseInt(params[0], 16) * 2) };
    case "debug_traceTransaction": return { output: t.out, error: t.err ?? "execution reverted" };
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

const realMemory = (needle: string): string =>
  Object.values<any>(JSON.parse(readFileSync("memories.json", "utf8"))).find((m) => m.text.includes(needle)).text;

test("gas gate: an out-of-gas failure keeps its gas-limit hint", async () => {
  const r = await recordRetry("base", "0xf4", "0xs4", store);
  assert.equal(r.failure.errorSig, `out-of-gas:${sel}`);
  assert.match(r.text, /NEXT_ACTION: out of gas: retry used gas limit 250000 \(failed with limit 100000/);
  assert.doesNotMatch(r.text, /reason: /);
  const a = gateGasHints(parseNextAction(r.text.split("NEXT_ACTION: ")[1]), rememberedFailure(r.text));
  assert.deepEqual(a.gasLimit, { floor: 250000, failed: 100000 });
  assert.match(formatNextAction(a), /Out of gas: the failed attempt hit its limit of 100000/);
});

test("gas gate: a revert retried with more gas gets the reason, not a gas hint", async () => {
  const r = await recordRetry("base", "0xf5", "0xs5", store);
  const next = r.text.split("NEXT_ACTION: ")[1];
  assert.match(next, /^reason: Expired \(used 30000 of 100000 gas, not out of gas\)/);
  assert.doesNotMatch(next, /gas limit|retry bid|gas price/);
  assert.match(r.text, /gas price 2000000000 vs 1000000000 wei/); // still recorded as a fact in Change
  assert.match(r.text, /calldata 36 -> 36 bytes/);
});

test("gas gate: real stored memory 0x3b9e41d7 (34296 of 626972 gas) loses its stored gas hint at recall", () => {
  const text = realMemory("error=custom:0x3b9e41d7");
  const stored = parseNextAction(text.split("NEXT_ACTION: ")[1]);
  assert.deepEqual(stored.gasLimit, { floor: 1044916, failed: 626972 }); // what was written before the gate
  const gated = gateGasHints(stored, rememberedFailure(text));
  assert.equal(gated.gasLimit, undefined);
  assert.equal(gated.reason, "custom error 0x3b9e41d7 (used 34296 of 626972 gas, not out of gas)");
  assert.doesNotMatch(formatNextAction(gated), /- Out of gas:|gas limit/);
});

test("next action: real stored Base memory parses into calldata; recall drops its gas-price hint", () => {
  const text = realMemory("success_tx=0x389a50464dd3");
  const a = parseNextAction(text.match(/NEXT_ACTION: (.*)$/)![1]);
  assert.deepEqual(a.calldata.map((c) => c.index), [4, 15, 16]);
  assert.equal(a.calldata[0].to, "0x40345a5d65e9884189");
  assert.equal(a.moreWords, 1);
  assert.deepEqual(a.gasPrice, { floor: "9532143", failed: "5916993" });
  assert.equal(a.templateTx, "0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03");
  const s = formatNextAction(gateGasHints(a, rememberedFailure(text)));
  assert.match(s, /Failure reason: Too little received \(used 192148 of 246588 gas, not out of gas\)/);
  assert.match(s, /arg word 4 = 0x40345a5d65e9884189 \(was 0x4034297ede533478d4\)/);
  assert.doesNotMatch(s, /gas price|bidding/i);
  assert.doesNotMatch(s, /\u2014/);
});

test("revisions: a corrected memory gets its own idempotency key and wins recall for the same pair", async () => {
  assert.equal(memoryKey("base", "0xf1", "0xs1"), "base:0xf1:0xs1");
  assert.equal(memoryKey("base", "0xf1", "0xs1", 2), "base:0xf1:0xs1:r2");
  const before = mem.length;
  const r = await recordRetry("base", "0xf1", "0xs1", store, 2);
  assert.match(r.text, / success_block=103 rev=2\. /);
  assert.equal(mem.length, before + 1);
  const hit = await onFailure("base", "0xf2", { store });
  assert.ok(hit.matched && hit.memoryBlobId === `blob${before + 1}`);
});

test("bounded memory: long calldata with full-width words stays short (memory #1 had 6 unclipped words)", () => {
  const wide = (n: number) => "6ae07577" + n.toString(16).padStart(56, "0"); // 64 hex chars, no leading zeros to strip
  const input = (k: number) => sel + Array.from({ length: 21 }, (_, i) => wide(i * 1000 + (i >= 15 ? k : 0))).join("");
  const base = { chain: "base", wallet: W, contract: C, selector: sel, value: 0n, gasPrice: 1n, timestamp: 0, gasLimit: 246588, nonce: 1 } as const;
  const f: Attempt = { ...base, hash: "0xf", status: "failure", input: input(1), gasUsed: 192148, block: 1, errorSig: "revert:too_little_received", errorDetail: "x".repeat(400) };
  const s: Attempt = { ...base, hash: "0xs", status: "success", input: input(2), gasUsed: 176390, block: 7 };
  const text = memoryText(f, s, diffAttempts(f, s));
  assert.match(text, /calldata 676 -> 676 bytes; 6 arg word\(s\) changed/);
  assert.ok(!/(?:arg \d+ |= |\(was |-> )0x[0-9a-f]{25,}/.test(text), "every calldata word is clipped");
  assert.ok(text.includes("x".repeat(119) + "…") && !text.includes("x".repeat(121)), "error detail capped at 120 chars");
  assert.ok(text.length < 1500, `length ${text.length}`);
});

test("ledger: a revision names the key it supersedes", () => {
  assert.equal(supersededKey("base:0xf:0xs"), undefined);
  assert.equal(supersededKey("base:0xf:0xs:r2"), "base:0xf:0xs");
  assert.equal(supersededKey("base:0xf:0xs:r3"), "base:0xf:0xs:r2");
});
