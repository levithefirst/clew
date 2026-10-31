// Wallet classifier: thresholds, approximate vs exact latency, and the real numbers behind the 12 stored memories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWallet } from "../src/classify.ts";

test("real human-like wallet: Ethereum 0xd55c… (nonce 65, retry 4 blocks later, 4 calls in 41 blocks)", () => {
  const c = classifyWallet({ chain: "ethereum", nonce: 65, retryNonce: 66, retryBlocks: 4, calls: 4, fails: 2, scanBlocks: 41 });
  assert.equal(c.label, "human-like");
  assert.deepEqual(c.reasons, ["no automation signal: 65 prior transactions, retried ~48s after failing, 4 calls to this contract in ~8 min"]);
});

test("real bot-like wallet: Base 0x0274… (nonce 2,792,958, retry 2 blocks later, 55 calls in 151 blocks)", () => {
  const c = classifyWallet({ chain: "base", nonce: 2_792_958, retryNonce: 2_792_959, retryBlocks: 2, calls: 55, fails: 21, scanBlocks: 151 });
  assert.equal(c.label, "bot-like");
  assert.deepEqual(c.reasons, ["2,792,958 prior transactions", "retried ~4s after failing", "55 calls to this contract in ~5 min (21 failed)"]);
});

test("each signal fires on its own, just at the threshold", () => {
  const quiet = { chain: "ethereum", nonce: 10, retryNonce: 11, retryBlocks: 10 } as const; // 120 s, no gap
  assert.equal(classifyWallet(quiet).label, "human-like");
  assert.equal(classifyWallet({ ...quiet, nonce: 10_000, retryNonce: 10_001 }).label, "bot-like");
  assert.equal(classifyWallet({ ...quiet, retrySeconds: 6 }).label, "bot-like");
  assert.equal(classifyWallet({ ...quiet, retrySeconds: 7 }).label, "human-like");
  assert.equal(classifyWallet({ ...quiet, retryNonce: 14, retrySeconds: 60 }).label, "bot-like"); // 3 txs in between
  assert.equal(classifyWallet({ ...quiet, retryNonce: 14, retrySeconds: 61 }).label, "human-like");
  assert.equal(classifyWallet({ ...quiet, calls: 5, scanBlocks: 50 }).label, "bot-like"); // 5 calls in 10 min = 30/h
  assert.equal(classifyWallet({ ...quiet, calls: 4, scanBlocks: 10 }).label, "human-like"); // fast, but under 5 calls
});

test("exact timestamps are reported without the ~ approximation", () => {
  const c = classifyWallet({ chain: "base", nonce: 3, retryNonce: 4, retryBlocks: 9, retrySeconds: 19 });
  assert.match(c.reasons[0], /retried 19s after failing/);
});

test("Sui (no account nonce): latency can still flag a bot, but no signal means unclassified, never human-like", () => {
  // The two real Sui memories: retries 3 and 441 checkpoints after the failure.
  const fast = classifyWallet({ chain: "sui", retryBlocks: 3 });
  assert.equal(fast.label, "bot-like");
  assert.deepEqual(fast.reasons, ["retried ~1s after failing"]);
  const slow = classifyWallet({ chain: "sui", retryBlocks: 441 });
  assert.equal(slow.label, "unclassified");
  assert.deepEqual(slow.reasons, ["no account nonce on sui, so only retry latency was checked: retried ~106s after failing"]);
});
