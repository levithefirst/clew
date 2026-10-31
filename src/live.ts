// Guaranteed live demo on Base Mainnet: one deliberate failure, the corrected retry, the memory write, then a
// second similar failure that recall answers. The contract is Base's canonical WETH (OP Stack predeploy, WETH9):
// withdraw(wad) reverts when wad exceeds the caller's WETH balance, so the failure and its fix are deterministic.
// Amounts are 1 gwei of ETH; each tx is a ~25k-45k gas call on Base. Everything goes through Tatum RPC.
import { recordRetry, onFailure } from "./clew.ts";
import type { MemoryStore } from "./memory.ts";

export const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const BASE_CHAIN_ID = 8453;
export const AMOUNT = 1_000_000_000n; // 1 gwei of ETH
const SEL = { deposit: "0xd0e30db0", withdraw: "0x2e1a7d4d", balanceOf: "0x70a08231" } as const;
const GAS = { deposit: 80_000n, withdraw: 60_000n } as const;
/** Refuse to start if the four txs could cost more than this at current fees (about a dollar). */
export const MAX_FEE_WEI = 300_000_000_000_000n; // 0.0003 ETH

const word = (n: bigint) => n.toString(16).padStart(64, "0");
const withdraw = (wad: bigint) => SEL.withdraw + word(wad);

export interface Step { name: "setup" | "failure" | "retry" | "next-failure"; label: string; data: string; value: bigint; gas: bigint; expect: "0x1" | "0x0" }

/** The four transactions, given the wallet's current WETH balance. Setup is skipped when the balance already covers the retry. */
export function planDemo(wethBalance: bigint): Step[] {
  const steps: Step[] = [];
  let balance = wethBalance;
  if (balance < AMOUNT) {
    steps.push({ name: "setup", label: `deposit ${AMOUNT} wei as WETH`, data: SEL.deposit, value: AMOUNT, gas: GAS.deposit, expect: "0x1" });
    balance += AMOUNT;
  }
  steps.push({ name: "failure", label: `withdraw ${balance + AMOUNT} wei (balance ${balance})`, data: withdraw(balance + AMOUNT), value: 0n, gas: GAS.withdraw, expect: "0x0" });
  steps.push({ name: "retry", label: `withdraw ${AMOUNT} wei`, data: withdraw(AMOUNT), value: 0n, gas: GAS.withdraw, expect: "0x1" });
  balance -= AMOUNT;
  steps.push({ name: "next-failure", label: `withdraw ${balance + 2n * AMOUNT} wei (balance ${balance})`, data: withdraw(balance + 2n * AMOUNT), value: 0n, gas: GAS.withdraw, expect: "0x0" });
  return steps;
}

export type Rpc = (method: string, params: unknown[]) => Promise<any>;
export interface UnsignedTx { chainId: number; nonce: number; to: string; data: string; value: bigint; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
export type Signer = { address: string; sign: (tx: UnsignedTx) => Promise<string> };

export async function wethBalance(rpc: Rpc, address: string): Promise<bigint> {
  return BigInt(await rpc("eth_call", [{ to: WETH_BASE, data: SEL.balanceOf + word(BigInt(address)) }, "latest"]));
}

/** EIP-1559 fees: twice the latest base fee plus the node's suggested tip. */
export async function fees(rpc: Rpc): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const tip = BigInt(await rpc("eth_maxPriorityFeePerGas", []));
  return { maxFeePerGas: 2n * BigInt(block.baseFeePerGas) + tip, maxPriorityFeePerGas: tip };
}

const maxCost = (steps: Step[], maxFeePerGas: bigint) => steps.reduce((s, x) => s + x.gas * maxFeePerGas, 0n);

/** --dry-run: simulate every step with eth_call against the current state and print what would be sent. */
export async function dryRun(rpc: Rpc, address: string, log: (s: string) => void) {
  const chain = await rpc("eth_chainId", []);
  if (Number(chain) !== BASE_CHAIN_ID) throw new Error(`gateway is chain ${Number(chain)}, not Base (${BASE_CHAIN_ID})`);
  const [eth, weth, f] = [BigInt(await rpc("eth_getBalance", [address, "latest"])), await wethBalance(rpc, address), await fees(rpc)];
  const steps = planDemo(weth);
  log(`DRY RUN base wallet ${address}: ${eth} wei ETH, ${weth} wei WETH; maxFeePerGas ${f.maxFeePerGas} wei`);
  for (const s of steps) {
    let sim: string;
    try {
      await rpc("eth_call", [{ from: address, to: WETH_BASE, data: s.data, value: "0x" + s.value.toString(16), gas: "0x" + s.gas.toString(16) }, "latest"]);
      sim = "succeeds now";
    } catch (e: any) {
      sim = `reverts now (${e.message})`;
    }
    const note = s.name === "retry" && steps[0].name === "setup" ? "; expected to succeed once the setup deposit lands" : "";
    log(`  [${s.name}] ${s.label}: to ${WETH_BASE} data ${s.data} value ${s.value} gas ${s.gas} -> eth_call ${sim}${note}`);
  }
  const cost = maxCost(steps, f.maxFeePerGas);
  log(`  max L2 fee for all steps: ${cost} wei (cap ${MAX_FEE_WEI}); Base adds a small L1 data fee per tx`);
  if (eth < cost + AMOUNT) log(`  NOT ENOUGH ETH: fund ${address} with at least ${cost + AMOUNT - eth} more wei`);
}

export interface LiveDeps { rpc: Rpc; signer: Signer; store: MemoryStore; log: (s: string) => void; pollMs?: number; sleep?: (ms: number) => Promise<void> }

async function send(d: LiveDeps, s: Step, nonce: number, f: Awaited<ReturnType<typeof fees>>) {
  const raw = await d.signer.sign({ chainId: BASE_CHAIN_ID, nonce, to: WETH_BASE, data: s.data, value: s.value, gas: s.gas, ...f });
  const hash: string = await d.rpc("eth_sendRawTransaction", [raw]);
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < 60; i++) {
    const r = await d.rpc("eth_getTransactionReceipt", [hash]);
    if (r) {
      if (r.status !== s.expect) throw new Error(`[${s.name}] ${hash} has status ${r.status}, expected ${s.expect}; stopping`);
      d.log(`[${s.name}] ${s.label}: tx ${hash} status ${r.status} block ${Number(r.blockNumber)} gasUsed ${Number(r.gasUsed)}`);
      return hash;
    }
    await sleep(d.pollMs ?? 2_000);
  }
  throw new Error(`[${s.name}] ${hash} not mined within ${60 * (d.pollMs ?? 2_000) / 1000}s`);
}

/** The real run. Stops at the first step whose status is not the expected one. */
export async function runLive(d: LiveDeps) {
  const chain = await d.rpc("eth_chainId", []);
  if (Number(chain) !== BASE_CHAIN_ID) throw new Error(`gateway is chain ${Number(chain)}, not Base (${BASE_CHAIN_ID})`);
  const address = d.signer.address.toLowerCase();
  const [eth, weth, f] = [BigInt(await d.rpc("eth_getBalance", [address, "latest"])), await wethBalance(d.rpc, address), await fees(d.rpc)];
  const steps = planDemo(weth);
  const cost = maxCost(steps, f.maxFeePerGas);
  if (cost > MAX_FEE_WEI) throw new Error(`max fee ${cost} wei exceeds the ${MAX_FEE_WEI} wei cap; try again when Base fees are lower`);
  if (eth < cost + AMOUNT) throw new Error(`wallet ${address} has ${eth} wei; needs at least ${cost + AMOUNT}`);
  d.log(`LIVE DEMO base wallet ${address} (key from DEMO_PRIVATE_KEY, not shown): ${eth} wei ETH, ${weth} wei WETH`);

  let nonce = Number(await d.rpc("eth_getTransactionCount", [address, "pending"]));
  const hashes: Partial<Record<Step["name"], string>> = {};
  for (const s of steps.filter((x) => x.name !== "next-failure")) hashes[s.name] = await send(d, s, nonce++, f);

  const memory = await recordRetry("base", hashes.failure!, hashes.retry!, d.store);
  d.log(`[memory] ${memory.skipped ? "already stored" : "STORED"} job=${memory.job_id ?? "-"} blob=${memory.blob_id}`);

  const next = await send(d, steps.at(-1)!, nonce++, f);
  const without = await onFailure("base", next, { store: d.store, namespace: "clew-counterfactual-empty" });
  const withMem = await onFailure("base", next, { store: d.store });
  d.log(`  WITHOUT memory: ${without.matched ? "unexpected match" : without.message}`);
  if (!withMem.matched) throw new Error(`recall found no memory for ${next}: ${withMem.message}`);
  d.log(`  WITH memory: prior success ${withMem.priorPath.successTx} (block ${withMem.priorPath.successBlock}, blob ${withMem.memoryBlobId})`);
  d.log(`  NEXT ACTION\n${withMem.suggestion.replace(/^/gm, "    ")}`);
  return { ...hashes, nextFailure: next, blobId: memory.blob_id };
}
