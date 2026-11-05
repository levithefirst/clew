// The agent layer: /v1/recall's response shape, confidence, demotion, and ranking change.
// Memories are built from SYNTHETIC attempts (fake addresses and hashes) through the real memoryText; one test runs the
// real stored memories (memories.json) for the Base wallet behind failure 0xd72b...4bb6.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diffAttempts, memoryText, pathStats, replaysChange, recallFor, type Attempt } from "../src/clew.ts";
import { agentRecall, buildCalldata, parseRecallRequest, recallResponse, type LoadedFailure } from "../src/agent.ts";
import { ClewError } from "../src/explain.ts";
import { ledgerStore, type MemoryStore, type Recalled } from "../src/memory.ts";
import { measure, parseEntries, summarize, toTable } from "../src/measure.ts";
import { toSuiAttempt } from "../src/sui.ts";

const W = "0x" + "a".repeat(40), C = "0x" + "c".repeat(40), SEL = "0x38ed1739";
const word = (n: number) => n.toString(16).padStart(64, "0");
const H = (n: number) => "0x" + n.toString(16).padStart(64, "0");
const input = (words: number[]) => SEL + words.map(word).join("");
const BASE_WORDS = [100, 101, 102, 103, 104, 105];

/** Memory i: a failure at block 100*i, a retry 4 blocks later that sets `changes` (word index -> value). */
function memory(i: number, changes: Record<number, number>): Recalled {
  const base = { chain: "base", wallet: W, contract: C, value: 0n, timestamp: 0 } as const;
  const ok = BASE_WORDS.map((w, k) => (k in changes ? changes[k] : w));
  const f: Attempt = { ...base, hash: H(1000 + i), status: "failure", selector: SEL, input: input(BASE_WORDS), nonce: i, block: 100 * i, gasPrice: 1_000_000_000n, gasLimit: 200_000, gasUsed: 30_000, errorSig: "revert:too_little_received", errorDetail: "Too little received" };
  const s: Attempt = { ...base, hash: H(2000 + i), status: "success", selector: SEL, input: input(ok), nonce: i + 1, block: 100 * i + 4, gasPrice: 1_000_000_000n, gasLimit: 200_000, gasUsed: 120_000 };
  return { text: memoryText(f, s, diffAttempts(f, s)), blob_id: `blob${i}`, distance: 0.1 };
}
const store = (mems: Recalled[]): MemoryStore => ({ remember: async () => ({ blob_id: "x" }), recall: async () => mems });
/** A new failure from the same wallet: `words` is its calldata, `block` where it landed. */
const failure = (block: number, words = BASE_WORDS, hash = H(9000 + block)): LoadedFailure => ({
  chain: "base", hash, contract: C, wallet: W, selector: SEL, status: "failure", errorSig: "revert:too_little_received", errorDetail: "Too little received",
  gasUsed: 30_000, gasLimit: 200_000, gasPrice: 1_000_000_000n, block, input: input(words),
});
const loadInput = async (_c: string, hash: string) => {
  const n = Number(BigInt(hash)); // H(1000+i) is memory i's failure, H(2000+i) its retry
  const m = n >= 2000 ? n - 2000 : n - 1000;
  const mem = mems.get(m)!;
  return n >= 2000 ? input(mem.ok) : input(BASE_WORDS);
};
const mems = new Map<number, { ok: number[] }>();
const mk = (i: number, changes: Record<number, number>) => { mems.set(i, { ok: BASE_WORDS.map((w, k) => (k in changes ? changes[k] : w)) }); return memory(i, changes); };

test("request validation: chain, hash shape, agentId", () => {
  assert.deepEqual(parseRecallRequest({ chain: "Base", failedTxHash: H(1).toUpperCase().replace("0X", "0x"), agentId: "bot-1" }), { chain: "base", hash: H(1), agentId: "bot-1" });
  for (const bad of [null, {}, { chain: "solana", failedTxHash: H(1) }, { chain: "base", failedTxHash: "0x12" }, { chain: "sui", failedTxHash: H(1) }, { chain: "base", failedTxHash: H(1), agentId: "" }, { chain: "base", failedTxHash: H(1), agentId: 5 }]) {
    assert.throws(() => parseRecallRequest(bad), (e) => e instanceof ClewError && e.code === "bad_input");
  }
});

test("no memory: abstain, same shape, confidence 0", async () => {
  const r = await recallResponse(failure(500), { store: store([]) });
  assert.deepEqual(r, { action: "abstain", recommended: { calldata: null, gasLimit: null, gasPrice: null, nonceStrategy: null }, confidence: 0, evidence: { successes: 0, laterFailures: 0, mostConsistentChange: "none", blobIds: [] }, demotionFlag: false, priorRetries: 0 });
});

test("one memory: retry, confidence 0.5, a plain next failure does not count against the path", async () => {
  const r = await recallResponse(failure(500), { store: store([mk(1, { 1: 7 })]), loadInput });
  assert.equal(r.action, "retry");
  assert.equal(r.confidence, 0.5);
  assert.deepEqual(r.evidence, { successes: 1, laterFailures: 0, mostConsistentChange: "calldata word 1", blobIds: ["blob1"] });
  assert.equal(r.demotionFlag, false);
  assert.equal(r.priorRetries, 1);
  assert.deepEqual(r.recommended, { calldata: input([100, 7, 102, 103, 104, 105]), gasLimit: 200_000, gasPrice: "1000000000", nonceStrategy: "next" });
});

test("a later failure that replays the remembered change lowers confidence, sets demotion, and flips retry to abort", async () => {
  const m = mk(1, { 1: 7 });
  const before = await recallResponse(failure(500), { store: store([m]), loadInput });
  const replay = failure(500, [100, 7, 102, 103, 104, 105]); // already carries word 1 = 7 and still failed
  const after = await recallResponse(replay, { store: store([m]), loadInput });
  assert.equal(before.confidence, 0.5);
  assert.equal(after.confidence, 0.333);
  assert.equal(after.demotionFlag, true);
  assert.deepEqual([after.evidence.successes, after.evidence.laterFailures], [1, 1]);
  assert.equal(after.action, "abort");
  assert.deepEqual(after.recommended, { calldata: null, gasLimit: null, gasPrice: null, nonceStrategy: null });
  assert.ok(after.confidence < before.confidence);
});

test("a replay that landed before the success is not a later failure", () => {
  const m = mk(1, { 1: 7 }); // success at block 104
  assert.equal(pathStats([m], failure(50, [100, 7, 102, 103, 104, 105])).laterFailures, 0);
  assert.equal(replaysChange(m.text, failure(500)), false);
  assert.equal(replaysChange(m.text, failure(500, [100, 7, 102, 103, 104, 105])), true);
});

test("a recorded failure that came after another retry's success counts, and the ranking changes with it", async () => {
  const m1 = mk(1, { 1: 7 }), m2 = mk(2, { 1: 8 }), m3 = mk(3, { 2: 9 });
  // Two retries, both fixed word 1: word 1 leads and nothing has been outrun except by the second failure.
  const two = await recallResponse(failure(250), { store: store([m1, m2]), loadInput });
  assert.equal(two.evidence.mostConsistentChange, "calldata word 1");
  assert.deepEqual([two.evidence.successes, two.evidence.laterFailures], [2, 1]); // failure 2 (block 200) came after success 1 (block 104)
  assert.equal(two.confidence, 0.5);
  assert.equal(two.demotionFlag, true);
  // A third failure arrives after both successes and was fixed by a different word: the outrun retries lose weight.
  const three = await recallResponse(failure(350), { store: store([m1, m2, m3]), loadInput });
  assert.equal(three.evidence.mostConsistentChange, "calldata word 2");
  assert.deepEqual([three.evidence.successes, three.evidence.laterFailures], [3, 2]);
  assert.equal(three.confidence, 0.5); // 3 / (3 + 2 + 1)
  assert.equal(three.action, "retry");
  const raw = await recallFor(failure(350), { store: store([m1, m2, m3]) });
  assert.ok(raw.matched && raw.nextAction.evidence!.ranked[0].label === "calldata word 2");
  assert.equal(raw.matched && raw.nextAction.evidence!.ranked.find((r) => r.label === "calldata word 1")!.count, 2); // plain counts stay facts
});

test("later failures catch up with successes: abort", async () => {
  const ms = [mk(1, { 1: 7 }), mk(2, { 1: 8 })];
  const r = await recallResponse(failure(500, [100, 8, 102, 103, 104, 105]), { store: store(ms), loadInput }); // replays retry 2 as well
  assert.equal(r.evidence.laterFailures, 2);
  assert.equal(r.action, "abort");
});

test("recommended calldata applies the retry's diff to the failed call (full words, not the clipped memory text)", async () => {
  const out = await buildCalldata("base", { hash: H(9), input: input([1, 2, 3, 4, 5, 6]) }, H(1001), H(2001), async (_c, h) => (h === H(1001) ? input(BASE_WORDS) : input([100, 7, 102, 103, 104, 999])));
  assert.equal(out, input([1, 7, 3, 4, 5, 999])); // words 1 and 5 differed between the remembered failure and its retry
  assert.equal(await buildCalldata("base", { hash: H(9), input: input([1]) }, H(1001), H(2001), async () => { throw new Error("rpc down"); }), null);
});

test("Sui: same shape through the hook; off by default, no Sui call", async () => {
  const digest = "GJdRDQAjvBBgsWvuNkf7m9WpAagFWPkpVSSoBtqWMJDc";
  await assert.rejects(agentRecall({ chain: "sui", failedTxHash: digest }, { store: store([]) }), (e) => e instanceof ClewError && e.code === "sui_disabled");
  const pkg = "0x" + "d".repeat(64);
  const raw = { digest, sender: { address: "0x" + "5e".repeat(32) }, gasInput: { gasBudget: "10000000", gasPrice: "110" },
    effects: { status: "FAILURE", checkpoint: { sequenceNumber: 500 }, executionError: { abortCode: "3", message: "abort code: 3", module: { name: "pool", package: { address: pkg } }, function: { name: "swap" } }, gasEffects: { gasSummary: { computationCost: 1, storageCost: 1, storageRebate: 0 } } },
    kind: { __typename: "ProgrammableTransaction", commands: { nodes: [] }, inputs: { nodes: [] } } };
  const r = await agentRecall({ chain: "sui", failedTxHash: digest }, { store: store([]), loadSui: async () => toSuiAttempt(raw) });
  assert.deepEqual(Object.keys(r), ["action", "recommended", "confidence", "evidence", "demotionFlag", "priorRetries"]);
  assert.equal(r.action, "abstain");
});

test("measurement harness: memory off vs memory on, one row per failure, a bad row does not stop the run", async () => {
  assert.deepEqual(parseEntries("# list\nbase:" + H(1) + "\nethereum " + H(2) + ", \n" + H(3)), [{ chain: "base", hash: H(1) }, { chain: "ethereum", hash: H(2) }, { chain: "base", hash: H(3) }]);
  const m = mk(1, { 1: 7 });
  // The fake store answers by namespace like Walrus does: the empty namespace finds nothing.
  const byNs: MemoryStore = { remember: async () => ({ blob_id: "x" }), recall: async (_q, o) => (o?.namespace ? [] : [m]) };
  const load = async (_c: string, hash: string): Promise<LoadedFailure> => { if (hash === H(2)) throw new ClewError("not_found", "No transaction with that hash was found on that chain."); return failure(500, BASE_WORDS, hash); };
  const rows = await measure([{ chain: "base", hash: H(1) }, { chain: "base", hash: H(2) }, { chain: "base", hash: "nope" }], { store: byNs, load, loadInput });
  assert.deepEqual(rows.map((r) => [r.on?.action ?? null, r.off?.action ?? null]), [["retry", "abstain"], [null, null], [null, null]]);
  assert.match(rows[1].error!, /^not_found/);
  assert.match(rows[2].error!, /^bad_input/);
  assert.deepEqual(summarize(rows), { rows: 3, errors: 2, memoryOffActed: 0, memoryOnActed: 1, memoryOnRetry: 1, abort: 0, abstain: 0 });
  const table = toTable(rows);
  assert.match(table, /^\| chain \| failed tx \| memory off \| memory on \|/);
  assert.match(table, /\| base \| 0x00000000…000001 \| abstain \| retry \| 0\.5 \| 1 \| 0 \| false \| 1 \| calldata word 1 \|/);
});

test("real stored memories: the Base wallet behind failure 0xd72b...4bb6 has two retries and one later failure", async () => {
  const hash = "0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6";
  const f: LoadedFailure = { chain: "base", hash, wallet: "0x336a079d7b894f6b6356674b3ad668bffdd5811d", contract: "0x8ea5ad2a58c1dae75394b1e8636e6518eb6dac50", selector: "0x708909ad",
    status: "failure", errorSig: "revert:too_little_received", errorDetail: "Too little received", gasUsed: 192148, gasLimit: 246585, gasPrice: 21373757n, block: 53152847 };
  const r = await recallResponse(f, { store: ledgerStore });
  assert.equal(r.priorRetries, 2);
  assert.deepEqual([r.evidence.successes, r.evidence.laterFailures, r.confidence, r.demotionFlag, r.action], [2, 1, 0.5, true, "retry"]);
  assert.equal(r.evidence.mostConsistentChange, "calldata word 4");
  assert.equal(r.evidence.blobIds.length, 2);
});
