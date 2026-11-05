import "@/lib/server-env";
import { liveConfigured } from "@/lib/server-env";
import { limiter, clientKey } from "@/lib/rate-limit";
import { agentRecall, parseRecallRequest, type RecallResponse } from "@/lib/core/agent";
import { ClewError, type ClewErrorCode } from "@/lib/core/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // a failure read and two calldata reads (about 7 Tatum calls at the free plan's 360 ms spacing), plus one Walrus recall

// Agents call this from servers, but browsers may too (the /try page does, same-origin). Read-only, so any origin may read.
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type" };
const STATUS: Record<ClewErrorCode | "rate_limited" | "unconfigured", number> = {
  bad_input: 400, not_found: 404, not_a_failure: 422, upstream: 502, sui_disabled: 501, rate_limited: 429, unconfigured: 503,
};
const perMinute = limiter(12, 60_000);

const reply = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...CORS, ...headers } });
const fail = (code: keyof typeof STATUS, message: string, headers?: HeadersInit) => reply({ error: { code, message } }, STATUS[code], headers);

// Answers are cached for a minute per (chain, hash): an agent that retries the call does not re-read the chain.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: RecallResponse }>();

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });
}

/**
 * POST { chain, failedTxHash, agentId? } -> { action, recommended, confidence, evidence, demotionFlag, priorRetries }.
 * chain is base | ethereum | polygon | sui. Errors are { error: { code, message } }. Read-only: nothing is written to Walrus.
 */
export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return fail("bad_input", "Send a JSON body: { chain, failedTxHash, agentId? }."); }
  return recall(req, body);
}

/** The same read-only call as a link: GET /v1/recall?chain=base&failedTxHash=0x…&agentId=… (shareable, and checkable without a client). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return recall(req, { chain: q.get("chain") ?? undefined, failedTxHash: q.get("failedTxHash") ?? undefined, agentId: q.get("agentId") ?? undefined });
}

async function recall(req: Request, body: unknown): Promise<Response> {
  let parsed: ReturnType<typeof parseRecallRequest>;
  try { parsed = parseRecallRequest(body); } catch (e) { return fail("bad_input", e instanceof Error ? e.message : "Bad request."); }

  if (!liveConfigured()) return fail("unconfigured", "Live lookups are not switched on for this deployment.");

  const key = `${parsed.chain}:${parsed.hash}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return reply(hit.body);

  const wait = perMinute.take(parsed.agentId ? `agent:${parsed.agentId}` : clientKey(req));
  if (wait) return fail("rate_limited", `Slow down a little: try again in ${wait} seconds.`, { "retry-after": String(wait) });

  try {
    const answer = await agentRecall(body);
    if (cache.size > 200) cache.clear();
    cache.set(key, { at: Date.now(), body: answer });
    return reply(answer);
  } catch (e) {
    if (e instanceof ClewError) return fail(e.code, e.message);
    console.error("[v1/recall]", e instanceof Error ? e.message : e); // message only: never log request headers or keys
    return fail("upstream", "Something went wrong reading the chain. Try again in a moment.");
  }
}
