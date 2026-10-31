// Tatum client against a mocked fetch: 429 backoff, then success. No network.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TATUM_API_KEY = "test-key-not-real";
process.env.TATUM_BACKOFF_MS = "1";
process.env.TATUM_MIN_GAP_MS = "0";
const { rpc } = await import("../src/tatum.ts");

test("rpc backs off on 429 and retries with the api key header", async () => {
  const seen: { url: string; key: string | null }[] = [];
  const responses = [new Response("{}", { status: 429 }), Response.json({ jsonrpc: "2.0", id: 1, result: "0x10" })];
  globalThis.fetch = async (url: any, init: any) => {
    seen.push({ url: String(url), key: new Headers(init.headers).get("x-api-key") });
    return responses.shift()!;
  };
  assert.equal(await rpc("base", "eth_blockNumber"), "0x10");
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.url === "https://base-mainnet.gateway.tatum.io" && s.key === "test-key-not-real"));
});
