// Sui adapter on synthetic transactions shaped like Sui JSON-RPC responses (sui_getTransactionBlock with
// showInput + showEffects; suix_queryTransactionBlocks pages). Fake digests and addresses, not chain data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setRpc } from "../src/tatum.ts";
import { suiErrorSignature, toSuiAttempt, findSuiRetry, recordSuiRetry, onSuiFailure, loadSuiAttempt } from "../src/sui.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const PKG = "0x" + "de".repeat(32), SENDER = "0x" + "5e".repeat(32), OTHER_PKG = "0x" + "01".repeat(32);
const ABORT = `MoveAbort(MoveLocation { module: ModuleId { address: ${PKG.slice(2)}, name: Identifier("pool") }, function: 12, instruction: 34, function_name: Some("swap_exact_in") }, 7) in command 0`;

function tx(digest: string, checkpoint: number, opts: { ok: boolean; minOut: string; pkg?: string; error?: string; budget?: number }) {
  return {
    digest, checkpoint: String(checkpoint), timestampMs: String(1_800_000_000_000 + checkpoint * 250),
    transaction: { data: {
      sender: SENDER,
      gasData: { budget: String(opts.budget ?? 5_000_000), price: "750" },
      transaction: {
        kind: "ProgrammableTransaction",
        inputs: [{ type: "object", objectId: "0x" + "0b".repeat(32) }, { type: "pure", valueType: "u64", value: "1000000" }, { type: "pure", valueType: "u64", value: opts.minOut }],
        transactions: [{ MoveCall: { package: opts.pkg ?? PKG, module: "pool", function: "swap_exact_in", type_arguments: ["0x2::sui::SUI"], arguments: [] } }],
      },
    } },
    effects: {
      status: opts.ok ? { status: "success" } : { status: "failure", error: opts.error ?? ABORT },
      gasUsed: { computationCost: "750000", storageCost: "1976000", storageRebate: "978120", nonRefundableStorageFee: "9880" },
    },
  };
}

const failed = tx("Fail1", 1000, { ok: false, minOut: "990000" });
const retry = tx("Okay2", 1000, { ok: true, minOut: "950000" }); // same checkpoint, listed after the failure on-chain
const history = [
  tx("Late9", 1400, { ok: true, minOut: "1", pkg: OTHER_PKG }), // other target: ignored
  tx("Okay3", 1200, { ok: true, minOut: "940000" }),            // later success, but not the first one
  retry, failed,
  tx("Early0", 900, { ok: true, minOut: "1" }),                 // before the failure: never a retry
];
const next = tx("Fail4", 2000, { ok: false, minOut: "995000" });
const byDigest = new Map([...history, next].map((t) => [t.digest, t]));

setRpc(async (_chain, method, params: any[]) => {
  if (method === "sui_getTransactionBlock") return structuredClone(byDigest.get(params[0]));
  if (method === "suix_queryTransactionBlocks") {
    const start = params[1] ? Number(params[1]) : 0; // page size 2 to exercise the cursor
    return { data: history.slice(start, start + 2), hasNextPage: start + 2 < history.length, nextCursor: String(start + 2) };
  }
  throw new Error(`unmocked ${method}`);
});

test("error signature: MoveAbort keeps module, function and abort code; InsufficientGas maps to out-of-gas", () => {
  assert.equal(suiErrorSignature(ABORT, "swap_exact_in"), "moveabort:pool::swap_exact_in:7");
  assert.equal(suiErrorSignature("InsufficientGas", "swap_exact_in"), "out-of-gas:swap_exact_in");
  assert.equal(suiErrorSignature("InsufficientCoinBalance in command 2", "f"), "sui:insufficientcoinbalance");
  assert.equal(suiErrorSignature(undefined, "f"), "f:failed");
});

test("attempt: target, sender, checkpoint, gas (computation + storage - rebate) and inputs", () => {
  const a = toSuiAttempt(failed);
  assert.equal(a.contract, `${PKG}::pool::swap_exact_in`);
  assert.equal(a.wallet, SENDER);
  assert.equal(a.checkpoint, 1000);
  assert.equal(a.gasUsed, 750000 + 1976000 - 978120);
  assert.deepEqual(a.inputs, [`object:0x${"0b".repeat(32)}`, '"1000000"', '"990000"']);
  assert.equal(a.errorSig, "moveabort:pool::swap_exact_in:7");
});

test("retry search walks newest-first across pages and returns the first later success to the same target", async () => {
  assert.equal(await findSuiRetry(await loadSuiAttempt("Fail1")), "Okay2");
});

test("record + recall: the next MoveAbort from the same sender gets the changed input and the template tx", async () => {
  const mem: string[] = [];
  const store: MemoryStore = {
    async remember(text) { mem.push(text); return { blob_id: "blobS" }; },
    async recall(): Promise<Recalled[]> { return mem.map((text) => ({ text, blob_id: "blobS", distance: 0 })); },
  };
  const r = await recordSuiRetry("Fail1", "Okay2", store);
  assert.match(r.text, new RegExp(`^CLEW chain=sui contract=${PKG}::pool::swap_exact_in wallet=${SENDER} error=moveabort:pool::swap_exact_in:7 `));
  assert.match(r.text, /1 input\(s\) changed \(input 2 "990000" -> "950000"\)/);
  const hit = await onSuiFailure("Fail4", { store });
  assert.ok(hit.matched);
  if (hit.matched) {
    assert.equal(hit.priorPath.successTx, "Okay2");
    assert.match(hit.suggestion, /Failure reason: MoveAbort/);
    assert.match(hit.suggestion, /input 2 = "950000" \(was "990000"\)/);
    assert.doesNotMatch(hit.suggestion, /Out of gas/);
  }
});
