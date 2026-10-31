// Live demo against a fake Base chain (WETH9 semantics), signed with viem using Anvil's public dev key #0.
// Covers the plan, the full send -> record -> recall flow, the stop-on-unexpected-status guard, and that the
// private key never reaches the log. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTransaction } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { setRpc, rpc } from "../src/tatum.ts";
import { planDemo, runLive, AMOUNT, WETH_BASE, type Signer } from "../src/live.ts";
import type { MemoryStore, Recalled } from "../src/memory.ts";

const DEV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Anvil #0, public test key
const account = privateKeyToAccount(DEV_KEY);
const signer: Signer = {
  address: account.address,
  sign: (tx) => account.signTransaction({ type: "eip1559", ...tx, to: tx.to as `0x${string}`, data: tx.data as `0x${string}` }),
};
const hex = (n: bigint | number) => "0x" + n.toString(16);

/** Minimal Base: WETH9 deposit/withdraw/balanceOf, one block per tx, receipts, traces. */
function fakeBase(opts: { weth?: bigint; breakRetry?: boolean } = {}) {
  let weth = opts.weth ?? 0n, block = 40_000_000;
  const txs = new Map<string, { tx: any; receipt: any }>();
  setRpc(async (_c, method, p: any[]) => {
    switch (method) {
      case "eth_chainId": return "0x2105";
      case "eth_getBalance": return hex(10n ** 16n);
      case "eth_getBlockByNumber": return { baseFeePerGas: "0x5f5e100", timestamp: hex(1_800_000_000 + block * 2) };
      case "eth_maxPriorityFeePerGas": return "0xf4240";
      case "eth_getTransactionCount": return "0x7";
      case "eth_call": return hex(weth); // balanceOf
      case "eth_sendRawTransaction": {
        const t = parseTransaction(p[0]);
        const data = t.data!, wad = BigInt("0x" + (data.slice(10) || "0"));
        let ok = true;
        if (data.startsWith("0xd0e30db0")) weth += t.value!;
        else if (wad > weth || (opts.breakRetry && wad === AMOUNT)) ok = false;
        else weth -= wad;
        const hash = "0x" + (++block).toString(16).padStart(64, "0");
        const common = { from: account.address.toLowerCase(), to: WETH_BASE, blockNumber: hex(block) };
        txs.set(hash, {
          tx: { ...common, input: data, gas: hex(t.gas!), nonce: hex(t.nonce!), value: hex(t.value ?? 0n), gasPrice: hex(t.maxFeePerGas!) },
          receipt: { ...common, transactionHash: hash, status: ok ? "0x1" : "0x0", gasUsed: ok ? "0x7530" : "0x5dc0", effectiveGasPrice: "0x5f5e100" },
        });
        return hash;
      }
      case "eth_getTransactionReceipt": return txs.get(p[0])?.receipt ?? null;
      case "eth_getTransactionByHash": return txs.get(p[0])?.tx ?? null;
      case "debug_traceTransaction": return { output: "0x", error: "execution reverted" };
    }
    throw new Error(`fake base: unmocked ${method}`);
  });
}

function memoryStore(): MemoryStore {
  const mem: { text: string; ns: string }[] = [];
  return {
    async remember(text) { mem.push({ text, ns: "clew" }); return { job_id: "job1", blob_id: `blob${mem.length}` }; },
    async recall(_q, o = {}): Promise<Recalled[]> { return mem.filter((m) => m.ns === (o.namespace ?? "clew")).map((m, i) => ({ text: m.text, blob_id: `blob${i + 1}`, distance: 0 })); },
  };
}

test("plan: setup only when WETH balance is short; the two failures overdraw, the retry withdraws AMOUNT", () => {
  assert.deepEqual(planDemo(0n).map((s) => [s.name, s.expect]), [["setup", "0x1"], ["failure", "0x0"], ["retry", "0x1"], ["next-failure", "0x0"]]);
  assert.deepEqual(planDemo(AMOUNT).map((s) => s.name), ["failure", "retry", "next-failure"]);
  const [, fail, retry, next] = planDemo(0n);
  assert.equal(fail.data, "0x2e1a7d4d" + (2n * AMOUNT).toString(16).padStart(64, "0"));
  assert.equal(retry.data, "0x2e1a7d4d" + AMOUNT.toString(16).padStart(64, "0"));
  assert.equal(next.data, "0x2e1a7d4d" + (2n * AMOUNT).toString(16).padStart(64, "0"));
});

test("live run: failure -> retry -> memory -> next failure gets the prior path; the key is never logged", async () => {
  fakeBase();
  const lines: string[] = [];
  const r = await runLive({ rpc: (m, p) => rpc("base", m, p), signer, store: memoryStore(), log: (s) => lines.push(s), sleep: async () => {} });
  const out = lines.join("\n");
  assert.match(out, /^LIVE DEMO base wallet 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 \(key from DEMO_PRIVATE_KEY, not shown\)/);
  const sent = lines.map((l) => l.match(/^\[(\S+)\] .*: tx 0x[0-9a-f]+ status (0x\d)/)).filter(Boolean).map((m) => `${m![1]} ${m![2]}`);
  assert.deepEqual(sent, ["setup 0x1", "failure 0x0", "retry 0x1", "next-failure 0x0"]);
  assert.match(out, /\[memory\] STORED job=job1 blob=blob1/);
  assert.match(out, /WITHOUT memory: Tx 0x\S+ on base reverted \(0x2e1a7d4d:reverted\)\. No prior successful path/);
  assert.match(out, new RegExp(`WITH memory: prior success ${r.retry}`));
  assert.match(out, /arg word 0 = 0x3b9aca00 \(was 0x77359400\)/); // withdraw 1 gwei, not 2
  assert.ok(!out.toLowerCase().includes(DEV_KEY.slice(2)), "private key must not appear in output");
});

test("live run stops when a step's status is not the expected one", async () => {
  fakeBase({ breakRetry: true });
  await assert.rejects(
    runLive({ rpc: (m, p) => rpc("base", m, p), signer, store: memoryStore(), log: () => {}, sleep: async () => {} }),
    /\[retry\] 0x\S+ has status 0x0, expected 0x1; stopping/,
  );
});
