/**
 * Best-effort sliding-window limiter, per server instance (serverless instances don't share memory, so this slows
 * a single client down; it is not a hard global cap). `take` returns the seconds to wait, or 0 if allowed.
 */
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    take(key: string, now = Date.now()): number {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return Math.ceil((recent[0] + windowMs - now) / 1000);
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5_000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return 0;
    },
  };
}

export const clientKey = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
