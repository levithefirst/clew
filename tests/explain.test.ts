// The "Try it" product logic against a mocked chain (SYNTHETIC txs, fake addresses) and an in-memory store:
// input handling, chain detection, plain-English reasons (on real error signatures from memories.json), the
// with/without-memory answer, and the guards that keep a bad pair from ever reaching Walrus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRpc } from "../src/tatum.ts";
import { ClewError, checkFailure, detectTarget, explainError, teach, findEvmChain } from "../src/explain.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const W = "0x" + "a".repeat(40), W2 = "0x" + "b".repeat(40), C = "0x" + "c".repeat(40);
const word = (n: number) => n.toString(16).padStart(64, "0");
const errStr = (s: string) => "0x08c379a0" + word(32) + word(s.length) + Buffer.from(s).toString("hex").padEnd(64, "0");
const sel = "0x38ed1739";
const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const hex = (n: number) => "0x" + n.toString(16);

type Tx = { chain: string; from: string; status: "0x0" | "0x1"; arg: number; nonce: number; block: number };
const txs: Record<string, Tx> = {
  [H(1)]: { chain: "base", from: W, status: "0x0", arg: 990, nonce: 7, block: 100 },    // failure
  [H(2)]: { chain: "base", from: W, status: "0x1", arg: 950, nonce: 8, block: 103 },    // the fix
  [H(3)]: { chain: "base", from: W, status: "0x0", arg: 995, nonce: 9, block: 200 },    // later failure, same wallet
  [H(4)]: { chain: "base", from: W2, status: "0x0", arg: 1, nonce: 1, block: 201 },     // other wallet, same contract
  [H(5)]: { chain: "base", from: W2, status: "0x1", arg: 1, nonce: 2, block: 202 },     // other wallet success
  [H(6)]: { chain: "base", from: W, status: "0x1", arg: 940, nonce: 10, block: 50_000 },// "retry" far too late
  [H(7)]: { chain: "polygon", from: W, status: "0x0", arg: 1, nonce: 1, block: 10 },    // only on polygon
};
const calls: string[] = [];
setRpc(async (chain, method, p: any[]) => {
  calls.push(`${chain} ${method}`);
  const t = txs[p[0]];
  const here = t && t.chain === chain;
  switch (method) {
    case "eth_getTransactionReceipt": return here ? { from: t.from, to: C, status: t.status, gasUsed: "0x5dc0", blockNumber: hex(t.block), effectiveGasPrice: "0x3b9aca00" } : null;
    case "eth_getTransactionByHash": return here ? { from: t.from, to: C, input: sel + word(1000) + word(t.arg), gas: hex(200000), nonce: hex(t.nonce), value: "0x0", blockNumber: hex(t.block), gasPrice: "0x3b9aca00" } : null;
    case "eth_getBlockByNumber": return { timestamp: hex(1_700_000_000 + parseInt(p[0], 16) * 2) };
    case "debug_traceTransaction": return { output: errStr("Too little received"), error: "execution reverted" };
  }
  throw new Error("unmocked " + method);
});

function memoryStore() {
  const mem: { text: string; ns: string }[] = [];
  const store: MemoryStore = {
    async remember(text) { mem.push({ text, ns: "clew" }); return { job_id: "job1", blob_id: `blob${mem.length}` }; },
    async recall(_q, o = {}): Promise<Recalled[]> { return mem.filter((m) => m.ns === (o.namespace ?? "clew")).map((m, i) => ({ text: m.text, blob_id: `blob${i + 1}`, distance: 0.1 })); },
  };
  return { store, mem };
}

test("input: EVM hash, Sui digest, and everything else", () => {
  assert.deepEqual(detectTarget(`  ${H(1).toUpperCase().replace("0X", "0x")}  `), { kind: "evm", hash: H(1) });
  assert.deepEqual(detectTarget("GXwW6feRx386m9W3z7UX9CRWAFNyuGETWPux6zZR48Vj"), { kind: "sui", hash: "GXwW6feRx386m9W3z7UX9CRWAFNyuGETWPux6zZR48Vj" });
  for (const bad of ["", "0x123", "hello", "0x" + "g".repeat(64)]) assert.throws(() => detectTarget(bad), (e: any) => e instanceof ClewError && e.code === "bad_input");
});

test("plain English: real error signatures from the 14 stored memories", () => {
  assert.match(explainError("revert:too_little_received", "Too little received").text, /slippage limit/);
  assert.match(explainError("revert:insufficient_output_amount", undefined).text, /slippage limit/);
  assert.match(explainError("moveabort:errors::err_amount_out_slippage_check_failed:1", undefined).text, /slippage limit/);
  assert.match(explainError("revert:expired", "Expired").text, /deadline/);
  assert.match(explainError("revert:stf", "STF").text, /enough balance/);
  // "SPL" is a short code whose meaning depends on the contract, so Clew does not guess.
  assert.equal(explainError("revert:spl", "SPL").known, false);
  assert.match(explainError("out-of-gas:swap", undefined).text, /ran out of gas/);
  const unknown = explainError("custom:0x3b9e41d7", "custom error 0x3b9e41d7");
  assert.equal(unknown.known, false);
  assert.match(unknown.text, /error code 0x3b9e41d7/);
  assert.equal(explainError("revert:too_little_received", "x").known, true);
});

test("chain detection probes Base, Ethereum, Polygon in order and stops at the first receipt", async () => {
  calls.length = 0;
  assert.equal(await findEvmChain(H(7)), "polygon");
  assert.deepEqual(calls, ["base eth_getTransactionReceipt", "ethereum eth_getTransactionReceipt", "polygon eth_getTransactionReceipt"]);
  calls.length = 0;
  assert.equal(await findEvmChain(H(1)), "base");
  assert.equal(calls.length, 1);
  await assert.rejects(findEvmChain(H(99)), (e: any) => e.code === "not_found");
});

test("answer: no memory -> generic message and no memory; after teaching -> the later failure gets the prior path", async () => {
  const { store, mem } = memoryStore();
  const before = await checkFailure(H(3), { store });
  assert.equal(before.chain, "base");
  assert.equal(before.memory, null);
  assert.match(before.without, /reverted \(revert:too_little_received\)\. No prior successful path/);
  assert.match(before.reason.text, /slippage limit/);

  const taught = await teach(H(1), H(2), { store });
  assert.deepEqual([taught.chain, taught.failedTx, taught.successTx, taught.alreadyStored], ["base", H(1), H(2), false]);
  assert.equal(mem.length, 1);

  const after = await checkFailure(H(3), { store });
  assert.equal(after.memory?.successTx, H(2));
  assert.equal(after.memory?.blobId, "blob1");
  assert.match(after.memory!.suggestion, /arg word 1 = 0x3b6 \(was 0x3de\)/); // the retry (950) against the remembered failure (990)
  assert.equal(after.without, before.without); // the empty-namespace answer is unchanged by the memory
  // another wallet on the same contract still gets nothing: the path is never borrowed
  assert.equal((await checkFailure(H(4), { store })).memory, null);
});

test("answer: errors a visitor can read", async () => {
  const { store } = memoryStore();
  await assert.rejects(checkFailure(H(2), { store }), (e: any) => e.code === "not_a_failure" && /succeeded/.test(e.message));
  await assert.rejects(checkFailure(H(99), { store }), (e: any) => e.code === "not_found");
  await assert.rejects(checkFailure("nope", { store }), (e: any) => e.code === "bad_input");
});

test("teach refuses anything that isn't a real pair, before writing", async () => {
  const { store, mem } = memoryStore();
  const refused = (a: string, b: string, code: string, re?: RegExp) =>
    assert.rejects(teach(a, b, { store }), (e: any) => e.code === code && (!re || re.test(e.message)));
  await refused(H(1), H(1), "mismatch", /two different/);
  await refused(H(1), H(5), "mismatch", /same wallet/);       // other wallet's success
  await refused(H(1), H(2 + 0x100), "not_found");               // the second tx does not exist
  await refused(H(2), H(6), "not_a_failure");                   // first one succeeded
  await refused(H(1), H(3), "mismatch", /not a success/);       // second one failed
  await refused(H(1), H(6), "mismatch", /more than a day/);     // a "retry" 49,900 blocks (~28 h) later
  assert.equal(mem.length, 0, "nothing reached Walrus");
});
