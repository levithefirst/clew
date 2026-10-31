// Replays recorded RPC traffic ({ calls: [{ method, params, result }] }, as written by `npm run watch -- --record`).
// Each request takes the first unused matching entry; once a request's entries are used up, the last one repeats
// (polling calls like eth_blockNumber, or onFailure re-reading a block header the watcher already read).
type Call = { method: string; params: unknown[]; result: unknown };

export function replay(calls: Call[]) {
  const used = new Set<number>();
  const key = (m: string, p: unknown[]) => `${m} ${JSON.stringify(p)}`;
  return async (_chain: string, method: string, params: unknown[]) => {
    const k = key(method, params);
    const matches = calls.map((c, i) => [c, i] as const).filter(([c]) => key(c.method, c.params) === k);
    if (!matches.length) throw new Error(`no recorded response for ${k}`);
    const next = matches.find(([, i]) => !used.has(i)) ?? matches.at(-1)!;
    used.add(next[1]);
    return structuredClone(next[0].result);
  };
}
