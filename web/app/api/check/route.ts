import "@/lib/server-env";
import { liveConfigured, teachEnabled } from "@/lib/server-env";
import { limiter, clientKey } from "@/lib/rate-limit";
import { cachedAnswer, cacheAnswer } from "@/lib/answer-cache";
import { checkFailure, ClewError } from "@/lib/core/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // ~8 Tatum calls at the free plan's 360 ms spacing, plus two Walrus recalls

const perMinute = limiter(6, 60_000);

const STATUS = { bad_input: 400, not_found: 404, not_a_failure: 422, mismatch: 422, upstream: 502 } as const;
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** POST { input: string, chain?: "base" | "ethereum" | "polygon" } -> { ok, answer, canTeach } | { ok: false, code, message } */
export async function POST(req: Request) {
  let body: { input?: unknown; chain?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad_input", message: "Send a JSON body with an input field." }, 400); }
  if (typeof body.input !== "string" || body.input.length > 200) return json({ ok: false, code: "bad_input", message: "Paste a transaction hash." }, 400);
  const chain = typeof body.chain === "string" && ["base", "ethereum", "polygon"].includes(body.chain) ? body.chain : undefined;

  if (!liveConfigured()) return json({ ok: false, code: "unconfigured", message: "Live lookups are not switched on for this deployment." }, 503);

  const key = `${chain ?? ""}:${body.input.trim().toLowerCase()}`;
  const hit = cachedAnswer(key);
  if (hit) return json({ ok: true, answer: hit, canTeach: teachEnabled(), cached: true });

  const wait = perMinute.take(clientKey(req));
  if (wait) return json({ ok: false, code: "rate_limited", message: `Slow down a little: try again in ${wait} seconds.` }, 429, { "retry-after": String(wait) });

  try {
    const answer = await checkFailure(body.input, { chain });
    cacheAnswer(key, answer);
    return json({ ok: true, answer, canTeach: teachEnabled(), cached: false });
  } catch (e) {
    if (e instanceof ClewError) return json({ ok: false, code: e.code, message: e.message }, STATUS[e.code]);
    console.error("[check]", e instanceof Error ? e.message : e); // message only: never log request headers or keys
    return json({ ok: false, code: "upstream", message: "Something went wrong reading the chain. Try again in a moment." }, 502);
  }
}
