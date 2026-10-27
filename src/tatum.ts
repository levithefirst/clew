// Tatum RPC gateway client: receipts, txs, blocks, revert reasons.
export const GATEWAYS: Record<string, string> = {
  ethereum: "https://ethereum-mainnet.gateway.tatum.io",
  base: "https://base-mainnet.gateway.tatum.io",
  polygon: "https://polygon-mainnet.gateway.tatum.io",
  arbitrum: "https://arbitrum-one-mainnet.gateway.tatum.io",
  optimism: "https://optimism-mainnet.gateway.tatum.io",
  bsc: "https://bsc-mainnet.gateway.tatum.io",
};

// Free Tatum plan = 3 req/s. Serialize calls with a small gap and retry on 429.
const MIN_GAP_MS = Number(process.env.TATUM_MIN_GAP_MS ?? 360);
let last = 0;
let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RpcError extends Error {
  constructor(message: string, public code?: number, public data?: unknown) { super(message); }
}

type Fetcher = (chain: string, method: string, params: unknown[]) => Promise<any>;
let override: Fetcher | null = null;
/** Tests inject a mock RPC here. */
export function setRpc(f: Fetcher | null) { override = f; }

export async function rpc(chain: string, method: string, params: unknown[] = []): Promise<any> {
  if (override) return override(chain, method, params);
  const url = GATEWAYS[chain];
  if (!url) throw new Error(`unsupported chain ${chain}`);
  const key = process.env.TATUM_API_KEY;
  if (!key) throw new Error("TATUM_API_KEY not set");
  const run = async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const wait = last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (res.status === 429 || body?.statusCode === 429) { await sleep(1000 * (attempt + 1)); continue; }
      if (body.error) throw new RpcError(body.error.message, body.error.code, body.error.data);
      if (!res.ok) throw new RpcError(`HTTP ${res.status}`);
      return body.result;
    }
    throw new RpcError("rate limited after retries", 429);
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

export const getReceipt = (c: string, h: string) => rpc(c, "eth_getTransactionReceipt", [h]);
export const getTx = (c: string, h: string) => rpc(c, "eth_getTransactionByHash", [h]);
export const getBlock = (c: string, n: number | "latest", full = false) =>
  rpc(c, "eth_getBlockByNumber", [typeof n === "number" ? "0x" + n.toString(16) : n, full]);
export const getBlockReceipts = (c: string, n: number) => rpc(c, "eth_getBlockReceipts", ["0x" + n.toString(16)]);
export const blockNumber = async (c: string) => parseInt(await rpc(c, "eth_blockNumber", []), 16);

// ---- revert decoding ----
export interface Revert { kind: "error" | "panic" | "custom" | "none"; data: string; reason?: string; selector?: string; }

const PANIC: Record<number, string> = {
  0x01: "assert failed", 0x11: "arithmetic overflow/underflow", 0x12: "division by zero",
  0x21: "invalid enum", 0x22: "bad storage encoding", 0x31: "pop on empty array",
  0x32: "array out of bounds", 0x41: "out of memory", 0x51: "zero-initialized function",
};

export function decodeRevert(data?: string | null): Revert {
  const d = (data ?? "").toLowerCase();
  if (!d || d === "0x" || d.length < 10) return { kind: "none", data: d };
  const sel = d.slice(0, 10);
  if (sel === "0x08c379a0" && d.length >= 138) {
    try {
      const body = d.slice(10);
      const len = parseInt(body.slice(64, 128), 16);
      const hex = body.slice(128, 128 + len * 2);
      return { kind: "error", data: d, selector: sel, reason: Buffer.from(hex, "hex").toString("utf8") };
    } catch { /* fallthrough */ }
  }
  if (sel === "0x4e487b71" && d.length >= 74) {
    const code = parseInt(d.slice(10, 74), 16);
    return { kind: "panic", data: d, selector: sel, reason: `Panic(0x${code.toString(16)}): ${PANIC[code] ?? "unknown"}` };
  }
  return { kind: "custom", data: d, selector: sel };
}

/** Revert data for a failed tx: debug_traceTransaction(callTracer) first, eth_call replay at block-1 as fallback. */
export async function getRevert(chain: string, hash: string, tx?: any): Promise<Revert & { source: string; vmError?: string }> {
  try {
    const t = await rpc(chain, "debug_traceTransaction", [hash, { tracer: "callTracer", tracerConfig: { onlyTopCall: true } }]);
    if (t) {
      const r = decodeRevert(t.output);
      if (r.kind === "none" && t.revertReason) return { kind: "error", data: "", reason: t.revertReason, source: "trace", vmError: t.error };
      return { ...r, source: "trace", vmError: t.error };
    }
  } catch { /* trace unsupported on this chain/plan */ }
  try {
    tx = tx ?? (await getTx(chain, hash));
    const call = { from: tx.from, to: tx.to, data: tx.input, value: tx.value, gas: tx.gas };
    await rpc(chain, "eth_call", [call, "0x" + (parseInt(tx.blockNumber, 16) - 1).toString(16)]);
    return { kind: "none", data: "", source: "replay-succeeded" };
  } catch (e: any) {
    const data = typeof e?.data === "string" ? e.data : e?.data?.data;
    return { ...decodeRevert(data), source: "replay", vmError: e?.message };
  }
}
