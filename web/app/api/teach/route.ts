import "@/lib/server-env";
import { liveConfigured, teachEnabled } from "@/lib/server-env";
import { limiter, clientKey } from "@/lib/rate-limit";
import { clearAnswers } from "@/lib/answer-cache";
import { teach, ClewError } from "@/lib/core/explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // two transactions read through Tatum, then a Walrus write that waits for confirmation

const perHour = limiter(3, 3_600_000);
const perDay = limiter(20, 86_400_000); // one shared bucket: a ceiling on Walrus writes per server instance
const STATUS = { bad_input: 400, not_found: 404, not_a_failure: 422, mismatch: 422, upstream: 502 } as const;
const json = (body: unknown, status = 200, headers?: HeadersInit) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** POST { failed, success, chain? } -> { ok, taught } | { ok: false, code, message }. Off unless CLEW_ALLOW_TEACH=1. */
export async function POST(req: Request) {
  if (!teachEnabled()) return json({ ok: false, code: "disabled", message: "Teaching is switched off on this demo. Run Clew locally to teach it (see the README)." }, 403);
  if (!liveConfigured()) return json({ ok: false, code: "unconfigured", message: "Live lookups are not switched on for this deployment." }, 503);

  let body: { failed?: unknown; success?: unknown; chain?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, code: "bad_input", message: "Send a JSON body." }, 400); }
  if (typeof body.failed !== "string" || typeof body.success !== "string" || body.failed.length > 200 || body.success.length > 200) {
    return json({ ok: false, code: "bad_input", message: "Paste the failed transaction and the one that fixed it." }, 400);
  }
  const chain = typeof body.chain === "string" && ["base", "ethereum", "polygon"].includes(body.chain) ? body.chain : undefined;

  const wait = perHour.take(clientKey(req));
  if (wait) return json({ ok: false, code: "rate_limited", message: `You can teach Clew 3 times an hour: try again in ${Math.ceil(wait / 60)} minutes.` }, 429, { "retry-after": String(wait) });
  if (perDay.take("all")) return json({ ok: false, code: "rate_limited", message: "Clew has learned enough for today on this demo. Try again tomorrow." }, 429);

  try {
    const taught = await teach(body.failed, body.success, { chain });
    clearAnswers();
    return json({ ok: true, taught });
  } catch (e) {
    if (e instanceof ClewError) return json({ ok: false, code: e.code, message: e.message }, STATUS[e.code]);
    console.error("[teach]", e instanceof Error ? e.message : e);
    return json({ ok: false, code: "upstream", message: "Something went wrong saving that. Try again in a moment." }, 502);
  }
}
