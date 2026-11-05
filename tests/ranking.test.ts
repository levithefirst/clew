// Learning over time: with several earlier successes after the same error, recall counts which changes repeat,
// leads with the most frequent (labelled with its count) and holds gas back when calldata is the majority.
// Memories here are built from SYNTHETIC attempts (fake addresses and hashes) through the real memoryText; the
// last test reads change keys from the real stored memories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeKeys, diffAttempts, formatNextAction, gateGasHints, memoryText, parseNextAction, rankChanges, recallFor, rememberedFailure, type Attempt, type FailureLike } from "../src/clew.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const W = "0x" + "a".repeat(40), C = "0x" + "c".repeat(40), SEL = "0x38ed1739", SEL2 = "0x12345678";
const word = (n: number) => n.toString(16).padStart(64, "0");
const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");

interface Retry { words?: Record<number, number>; gasPriceUp?: boolean; gasLimitUp?: boolean; fn?: boolean; outOfGas?: boolean; rev?: number }

/** One stored memory: a failure with six calldata words 100..105, then a retry that changes what `r` says. */
function memory(i: number, r: Retry): Recalled {
  const base = { chain: "base", wallet: W, contract: C, value: 0n, timestamp: 0 } as const;
  const failWords = [100, 101, 102, 103, 104, 105];
  const okWords = failWords.map((w, k) => (r.words && k in r.words ? r.words[k] : w));
  const f: Attempt = { ...base, hash: H(1000 + i), status: "failure", selector: SEL, input: SEL + failWords.map(word).join(""), nonce: i, block: 100 * i, gasPrice: 1_000_000_000n,
    gasLimit: 200_000, gasUsed: r.outOfGas ? 200_000 : 30_000, errorSig: r.outOfGas ? `out-of-gas:${SEL}` : "revert:too_little_received", errorDetail: "Too little received" };
  const s: Attempt = { ...base, hash: H(2000 + i), status: "success", selector: r.fn ? SEL2 : SEL, input: (r.fn ? SEL2 : SEL) + okWords.map(word).join(""), nonce: i + 1, block: 100 * i + 4,
    gasPrice: r.gasPriceUp ? 3_000_000_000n : 1_000_000_000n, gasLimit: r.gasLimitUp ? 400_000 : 200_000, gasUsed: 120_000 };
  return { text: memoryText(f, s, diffAttempts(f, s), r.rev ?? 1), blob_id: `blob${i}`, distance: 0.1 };
}

const store = (mems: Recalled[]): MemoryStore => ({ remember: async () => ({ blob_id: "x" }), recall: async () => mems });
const failure = (over: Partial<FailureLike> = {}): FailureLike => ({ chain: "base", hash: H(9999), contract: C, wallet: W, selector: SEL, errorSig: "revert:too_little_received", errorDetail: "Too little received", gasUsed: 30_000, gasLimit: 200_000, ...over });
const recall = async (mems: Recalled[], f = failure()) => {
  const r = await recallFor(f, { store: store(mems) });
  assert.ok(r.matched);
  return r.matched ? r : (undefined as never);
};

test("one earlier success: exactly the single-memory answer, no evidence", async () => {
  const m = memory(1, { words: { 1: 7 } });
  const r = await recall([m]);
  assert.equal("evidence" in r.nextAction, false);
  assert.doesNotMatch(r.suggestion, /Most consistent|earlier retries/);
  const next = m.text.match(/NEXT_ACTION: (.*)$/)![1];
  assert.equal(r.suggestion, formatNextAction(gateGasHints(parseNextAction(next), rememberedFailure(m.text), failure())));
  assert.equal(r.priorPath.successTx, H(2001));
});

test("a corrected rewrite of the same pair is one retry, not two", async () => {
  const r = await recall([memory(1, { words: { 1: 7 } }), memory(1, { words: { 1: 7 }, rev: 2 })]);
  assert.equal("evidence" in r.nextAction, false);
});

test("the second memory changes the output: the repeated change is named and counted", async () => {
  const first = await recall([memory(1, { words: { 1: 7 } })]);
  const second = await recall([memory(1, { words: { 1: 7 } }), memory(2, { words: { 1: 9 }, gasPriceUp: true })]);
  assert.equal("evidence" in first.nextAction, false);
  assert.deepEqual(second.nextAction.evidence, { total: 2, repeated: true, ranked: [{ label: "calldata word 1", count: 2 }], alsoDiffered: [{ label: "a higher gas price on the retry", count: 1 }] });
  assert.match(second.suggestion, /- Most consistent change: calldata word 1, in 2 of 2 earlier retries that succeeded after this same error\./);
  assert.notEqual(second.suggestion, first.suggestion);
  assert.equal(second.priorPath.successTx, H(2002)); // newest retry that made that change
});

test("3 of 4: the most frequent change leads, gas is demoted to a fact, the template is one that made the change", async () => {
  const mems = [
    memory(1, { words: { 1: 7 }, gasPriceUp: true }),
    memory(2, { words: { 1: 8 }, gasPriceUp: true }),
    memory(3, { words: { 1: 9 }, gasPriceUp: true }),
    memory(4, { words: { 2: 5 }, gasPriceUp: true }), // newest, but a different change
  ].reverse(); // the store returns them in no particular order
  const r = await recall(mems);
  const e = r.nextAction.evidence!;
  assert.equal(e.total, 4);
  assert.deepEqual(e.ranked, [{ label: "calldata word 1", count: 3 }, { label: "calldata word 2", count: 1 }]);
  assert.deepEqual(e.alsoDiffered, [{ label: "a higher gas price on the retry", count: 4 }]);
  assert.match(r.suggestion, /Most consistent change: calldata word 1, in 3 of 4 earlier retries/);
  assert.match(r.suggestion, /Also differed, not shown as a cause: a higher gas price on the retry \(4 of 4\)\./);
  assert.doesNotMatch(r.suggestion, /Also seen/); // word 2 appeared once
  assert.equal(r.priorPath.successTx, H(2003)); // not the newest (H(2004) changed word 2)
  assert.match(r.suggestion, /arg word 1 = 0x9 \(was 0x65\)/);
  assert.ok(r.suggestion.indexOf("Most consistent") < r.suggestion.indexOf("Failure reason"));
});

test("no calldata majority: a frequent gas difference is ranked like any other change", async () => {
  const r = await recall([
    memory(1, { gasPriceUp: true }), memory(2, { gasPriceUp: true }), memory(3, { gasPriceUp: true }), memory(4, { words: { 3: 1 } }),
  ]);
  assert.deepEqual(r.nextAction.evidence!.ranked[0], { label: "a higher gas price on the retry", count: 3 });
  assert.deepEqual(r.nextAction.evidence!.alsoDiffered, []);
  assert.match(r.suggestion, /Most consistent change: a higher gas price on the retry, in 3 of 4/);
});

test("nothing repeats: say so and show the most recent", async () => {
  const r = await recall([memory(1, { words: { 1: 7 } }), memory(2, { words: { 2: 7 } }), memory(3, { words: { 3: 7 } })]);
  assert.equal(r.nextAction.evidence!.repeated, false);
  assert.match(r.suggestion, /3 earlier retries succeeded after this same error and no single change repeated across them\. Showing the most recent\./);
  assert.equal(r.priorPath.successTx, H(2003));
});

test("a function change counts like a calldata change", () => {
  const e = rankChanges([memory(2, { fn: true, gasPriceUp: true }).text, memory(1, { fn: true }).text, memory(0, { words: { 0: 1 } }).text]);
  assert.deepEqual(e.ranked.map((r) => `${r.label}:${r.count}`), [`function ${SEL} → ${SEL2}:2`, "calldata word 0:1"]);
  assert.equal(e.calldataMajority, true);
});

test("calldata majority holds the gas-limit hint back; a single out-of-gas memory keeps it", async () => {
  const oog = (i: number, words: Record<number, number>) => memory(i, { words, gasLimitUp: true, outOfGas: true });
  const f = failure({ errorSig: `out-of-gas:${SEL}`, gasUsed: 200_000 });
  const single = await recall([oog(1, {})], f);
  assert.ok(single.nextAction.gasLimit, "a lone out-of-gas memory still gives its gas-limit hint");
  assert.match(single.suggestion, /- Out of gas:/);
  const many = await recall([oog(1, { 1: 7 }), oog(2, { 1: 8 }), oog(3, { 1: 9 })], f);
  assert.equal(many.nextAction.gasLimit, undefined);
  assert.doesNotMatch(many.suggestion, /- Out of gas:/);
  assert.match(many.suggestion, /calldata word 1, in 3 of 3/);
  assert.match(many.suggestion, /Also differed, not shown as a cause: a higher gas limit on the retry \(3 of 3\)/);
});

test("change keys from the real stored memories (original format included)", () => {
  const stored = (needle: string): string => Object.values<any>(JSON.parse(readFileSync("memories.json", "utf8"))).find((m) => m.text.includes(needle)).text;
  // Base #1: words 4, 15, 16 changed; gas price was bid 61% higher (only recorded in its NEXT_ACTION); limit +12% is below the bar.
  assert.deepEqual(changeKeys(stored("success_tx=0x389a50464dd3")).map((k) => k.id), ["word:4", "word:15", "word:16", "gasPrice"]);
  // Ethereum 0xd55c...: one word (a deadline) changed, gas limit identical.
  assert.deepEqual(changeKeys(stored("success_tx=0x539321141eb9")).map((k) => k.id), ["word:2"]);
  // Base 0x82d2...: the function itself changed.
  assert.ok(changeKeys(stored("success_tx=0x82d2caf4")).some((k) => k.kind === "function"));
  // Sui, original wording: no calldata words; gas price and budget are not counted as changes of the call.
  assert.deepEqual(changeKeys(stored("success_tx=ByGXz3iXES3N")).map((k) => k.id), ["gasPrice", "gasLimit"]);
});

test("ties list calldata words in numeric order (word 4 before word 15)", () => {
  const texts = [memory(1, { words: { 4: 1, 5: 2, 3: 3 } }).text, memory(2, { words: { 4: 1, 5: 2, 3: 3 } }).text];
  assert.deepEqual(rankChanges(texts).ranked.map((r) => r.label), ["calldata word 3", "calldata word 4", "calldata word 5"]);
  const wide = (i: number) => memory(i, { words: { 1: 1, 4: 2 } }).text.replace(/arg 4 /, "arg 15 ").replace(/arg 1 /, "arg 4 ");
  assert.deepEqual(rankChanges([wide(1), wide(2)]).ranked.map((r) => r.label), ["calldata word 4", "calldata word 15"]);
});
