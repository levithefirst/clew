import type { Answer } from "@/lib/core/explain";

/** Five-minute cache of check answers, per server instance. */
const TTL_MS = 5 * 60_000;
const entries = new Map<string, { at: number; answer: Answer }>();

export const cachedAnswer = (key: string): Answer | undefined => {
  const hit = entries.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.answer : undefined;
};
export const cacheAnswer = (key: string, answer: Answer) => {
  if (entries.size > 200) entries.clear();
  entries.set(key, { at: Date.now(), answer });
};
