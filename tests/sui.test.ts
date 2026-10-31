// Sui adapter (GraphQL). Parsing runs on real responses recorded from Tatum's Sui gateway on 2026-10-31
// (fixtures/sui-recorded-2026-10-31.json). Command lists, sender history and the record/recall flow use SYNTHETIC
// nodes in the same GraphQL shape (fake digests, addresses and values), labelled where they are built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setRpc } from "../src/tatum.ts";
import { toSuiAttempt, primaryCall, suiErrorSignature, findSuiRetry, recordSuiRetry, onSuiFailure, loadSuiAttempt } from "../src/sui.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const recorded = JSON.parse(readFileSync("fixtures/sui-recorded-2026-10-31.json", "utf8"));
const DEEPBOOK = "0xcaf6ba059d539a97646d47f0b9ddf843e138d215e2a12ca1f4585d386f7aec3a";

test("recorded failure node: sender, checkpoint, gas and the abort location become the error signature", () => {
  const a = toSuiAttempt(recorded.failureNode.node);
  assert.equal(a.hash, "GJdRDQAjvBBgsWvuNkf7m9WpAagFWPkpVSSoBtqWMJDc");
  assert.equal(a.status, "failure");
  assert.equal(a.wallet, "0xffd4f043057226453aeba59732d41c6093516f54823ebc3a16d17f8a77d2f0ad");
  assert.equal(a.checkpoint, 305948772);
  assert.equal(a.errorSig, "moveabort:balance_manager::withdraw_with_proof:3");
  assert.match(a.errorDetail!, /^Error in 2nd command, from '0xcaf6.*abort code: 3$/);
  assert.equal(a.gasLimit, 10_000_000);
  assert.equal(a.gasPrice, 110);
  assert.equal(a.gasUsed, 111_100 + 5_198_400); // no storageRebate in that recorded query
  // That query did not ask for commands, so the contract falls back to the abort module.
  assert.equal(a.contract, `${DEEPBOOK}::balance_manager`);
  assert.equal(a.selector, "withdraw_with_proof");
});

test("recorded checkpoint response shape", () => {
  assert.equal(recorded.checkpoint.response.data.checkpoint.sequenceNumber, 340151921);
});

// ---- synthetic from here on ----
const call = (pkg: string, module: string, fn: string) => ({ __typename: "MoveCallCommand", function: { name: fn, module: { name: module, package: { address: pkg } } } });
const pure = (hex: string) => ({ __typename: "Pure", bytes: Buffer.from(hex, "hex").toString("base64") });
const SENDER = "0x" + "5e".repeat(32), PKG = DEEPBOOK, OTHER = "0x" + "01".repeat(32);

/** SYNTHETIC node in the GraphQL shape of src/sui.ts TX_FIELDS. */
function node(digest: string, checkpoint: number, ok: boolean, qty: string, opts: { calls?: any[]; abortFn?: string } = {}) {
  return {
    digest, sender: { address: SENDER }, gasInput: { gasBudget: "10000000", gasPrice: "110" },
    effects: {
      status: ok ? "SUCCESS" : "FAILURE", checkpoint: { sequenceNumber: checkpoint },
      executionError: ok ? null : { abortCode: "3", message: `abort code: 3`, instructionOffset: 55, module: { name: "balance_manager", package: { address: PKG } }, function: { name: opts.abortFn ?? "withdraw_with_proof" } },
      gasEffects: { gasSummary: { computationCost: 111100, storageCost: 5198400, storageRebate: 978120 } },
    },
    kind: {
      __typename: "ProgrammableTransaction",
      commands: { nodes: opts.calls ?? [call(PKG, "balance_manager", "generate_proof_as_owner"), call(PKG, "pool", "place_limit_order")] },
      inputs: { nodes: [{ __typename: "SharedInput" }, pure(qty), pure("01")] },
    },
  };
}

test("contract choice: the called module where the abort happened, not the abort function itself", () => {
  const a = toSuiAttempt(node("F", 10, false, "e803"));
  assert.equal(a.contract, `${PKG}::balance_manager`);
  assert.equal(a.selector, "generate_proof_as_owner");
  assert.equal(a.errorSig, "moveabort:balance_manager::withdraw_with_proof:3");
  assert.deepEqual(a.inputs, ["SharedInput", "0xe803", "0x01"]);
  const abort = { package: PKG, module: "vault", function: "x", code: "1" };
  assert.equal(primaryCall([{ package: OTHER, module: "a", function: "f" }, { package: PKG, module: "pool", function: "g" }], abort)?.module, "pool"); // same package
  assert.equal(primaryCall([{ package: OTHER, module: "a", function: "f" }], abort)?.module, "a"); // else last call
  assert.equal(suiErrorSignature(undefined, "InsufficientGas", "f"), "out-of-gas:f");
});

const failure = node("Fail1", 1000, false, "e803");
const history = [
  node("Early0", 1000, true, "0100"),                                         // same checkpoint, before the failure: ignored
  failure,
  node("Fail2", 1001, false, "e903"),                                        // a later FAILURE: not a retry
  node("Other3", 1002, true, "0100", { calls: [call(OTHER, "router", "swap")] }), // success, different module
  node("Okay4", 1003, true, "d007"),                                         // first later SUCCESS on balance_manager
  node("Okay5", 1004, true, "d007"),
];
const next = node("Fail6", 2000, false, "ea03");
const byDigest = new Map([...history, next].map((t) => [t.digest, t]));
const listCalls: any[] = [];

setRpc(async (_chain, method, [query, vars]: any[]) => {
  assert.equal(method, "graphql");
  if (query.includes("transaction(digest")) return { transaction: structuredClone(byDigest.get(vars.digest)) };
  listCalls.push(vars);
  const start = vars.after ? Number(vars.after) : 0; // SYNTHETIC pages of 2 to exercise the cursor
  return { transactions: { pageInfo: { hasNextPage: start + 2 < history.length, endCursor: String(start + 2) }, nodes: history.slice(start, start + 2) } };
});

test("retry search: one server-side filter (sender + module + from the failure's checkpoint), paged, first later SUCCESS", async () => {
  assert.equal(await findSuiRetry(await loadSuiAttempt("Fail1")), "Okay4");
  assert.deepEqual(listCalls[0], { first: 50, after: null, filter: { sentAddress: SENDER, function: `${PKG}::balance_manager`, afterCheckpoint: 999 } });
  assert.deepEqual(listCalls.map((v) => v.after), [null, "2", "4"]);
});

test("record + recall: the next abort from the same sender gets the changed input and the template tx", async () => {
  const mem: string[] = [];
  const store: MemoryStore = {
    async remember(text) { mem.push(text); return { blob_id: "blobS" }; },
    async recall(): Promise<Recalled[]> { return mem.map((text) => ({ text, blob_id: "blobS", distance: 0 })); },
  };
  const r = await recordSuiRetry("Fail1", "Okay4", store);
  assert.match(r.text, new RegExp(`^CLEW chain=sui contract=${PKG}::balance_manager wallet=${SENDER} error=moveabort:balance_manager::withdraw_with_proof:3 selector=generate_proof_as_owner `));
  assert.match(r.text, /same 2 Move call\(s\); inputs 3 -> 3; 1 input\(s\) changed \(input 1 0xe803 -> 0xd007\)/);
  await assert.rejects(recordSuiRetry("Fail1", "Other3", store), /same sender calling the same package::module/);
  const hit = await onSuiFailure("Fail6", { store });
  assert.ok(hit.matched);
  if (hit.matched) {
    assert.equal(hit.priorPath.successTx, "Okay4");
    assert.match(hit.suggestion, /Failure reason: abort code: 3 \(used 4331380 of 10000000 gas, not out of gas\)/);
    assert.match(hit.suggestion, /input 1 = 0xd007 \(was 0xe803\)/);
    assert.match(hit.suggestion, /^Prior successful retry \(template\): Okay4$/m);
  }
});
