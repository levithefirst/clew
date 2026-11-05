import "@/lib/server-env";
import { liveConfigured } from "@/lib/server-env";
import { limiter, clientKey } from "@/lib/rate-limit";
import { cachedAnswer, cacheAnswer } from "@/lib/answer-cache";
import { checkFailure, ClewError } from "@/lib/core/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // ~8 Tatum calls at the free plan's 360 ms spacing, plus two Walrus recalls

const perMinute = limiter(6, 60_000);

const STATUS = { bad_input: 400, not_found: 404, not_a_failure: 422, upstream: 502, sui_disabled: 501 } as const;
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

async function lookup(req: Request, input: unknown, chainRaw: unknown): Promise<Response> {
  if (typeof input !== "string" || !input.trim() || input.length > 200) return json({ ok: false, code: "bad_input", message: "Paste a transaction hash." }, 400);
  const chain = typeof chainRaw === "string" && ["base", "ethereum", "polygon"].includes(chainRaw) ? chainRaw : undefined;

  if (!liveConfigured()) return json({ ok: false, code: "unconfigured", message: "Live lookups are not switched on for this deployment." }, 503);

  const key = `${chain ?? ""}:${input.trim().toLowerCase()}`;
  const hit = cachedAnswer(key);
  if (hit) return json({ ok: true, answer: hit, cached: true });

  const wait = perMinute.take(clientKey(req));
  if (wait) return json({ ok: false, code: "rate_limited", message: `Slow down a little: try again in ${wait} seconds.` }, 429, { "retry-after": String(wait) });

  try {
    const answer = await checkFailure(input, { chain });
    cacheAnswer(key, answer);
    return json({ ok: true, answer, cached: false });
  } catch (e) {
    if (e instanceof ClewError) return json({ ok: false, code: e.code, message: e.message }, STATUS[e.code]);
    console.error("[check]", e instanceof Error ? e.message : e); // message only: never log request headers or keys
    return json({ ok: false, code: "upstream", message: "Something went wrong reading the chain. Try again in a moment." }, 502);
  }
}

/** POST { input: string, chain?: "base" | "ethereum" | "polygon" } -> { ok, answer } | { ok: false, code, message }. Read-only. */
export async function POST(req: Request) {
  let body: { input?: unknown; chain?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad_input", message: "Send a JSON body with an input field." }, 400); }
  return lookup(req, body.input, body.chain);
}

/** The same read-only lookup as a link: GET /api/check?input=0x…  (shareable, and checkable without a client). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return lookup(req, q.get("input"), q.get("chain"));
}
