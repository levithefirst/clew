// Transparent wallet classifier: is a retrying wallet acting like a bot or like a person?
//
// It is a heuristic over public on-chain behaviour, not an identity check. It says "bot-like" (at least one
// automation signal fired) or "human-like" (none did). "Human-like" means "no automation signal seen", never
// "human": a slow, low-volume bot passes, and a power user on a script can fail it. On chains without an account
// nonce (Sui) a wallet with no signal is "unclassified" instead, because retry latency alone is too weak to rule
// automation out. Every label carries the numbers behind it.
//
// Signals (any one => bot-like):
//   1. Lifetime nonce >= 10,000: the wallet has sent at least that many transactions.
//   2. Retry latency <= 6 s: the successful retry landed within seconds of the failure, faster than a person re-signs.
//   3. Burst nonce gap: >= 3 other transactions sent between failure and retry, within 60 s.
//   4. Repeat calls: >= 5 calls to the same contract in the scan window, at a rate of >= 30 per hour.
// Signal 4 needs discovery data (calls in a scanned block range); without it, signals 1 to 3 decide.

/**
 * Average block time per chain in seconds, used only to turn block counts into approximate durations.
 * Sui counts checkpoints: 1,006,814 checkpoints between 339166550 (2026-10-28 19:54 UTC) and 340173364
 * (2026-10-31 15:10 UTC) on Suiscan, about 0.24 s each.
 */
export const BLOCK_SECONDS: Record<string, number> = { ethereum: 12, base: 2, optimism: 2, arbitrum: 0.25, polygon: 2, bsc: 3, sui: 0.24 };

export const THRESHOLDS = { lifetimeNonce: 10_000, retrySeconds: 6, burstGap: 3, burstSeconds: 60, repeatCalls: 5, repeatPerHour: 30 } as const;

export interface WalletActivity {
  chain: string;
  /** Nonce of the failed transaction: the number of transactions the wallet sent before it. Absent on Sui. */
  nonce?: number;
  /** Nonce of the successful retry. Absent on Sui. */
  retryNonce?: number;
  /** Blocks between the failure and the successful retry. */
  retryBlocks: number;
  /** Exact seconds between failure and retry when known (block timestamps); otherwise derived from block time. */
  retrySeconds?: number;
  /** Discovery data: calls from this wallet to this contract, and failures among them, within `scanBlocks` blocks. */
  calls?: number;
  fails?: number;
  scanBlocks?: number;
}

export type WalletClass = { label: "bot-like" | "human-like" | "unclassified"; reasons: string[] };

const fmt = (n: number) => n.toLocaleString("en-US");
const dur = (s: number) => (s < 120 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`);

export function classifyWallet(a: WalletActivity): WalletClass {
  const blockSecs = BLOCK_SECONDS[a.chain] ?? 12;
  const exact = a.retrySeconds !== undefined;
  const retrySecs = a.retrySeconds ?? a.retryBlocks * blockSecs;
  const approx = exact ? "" : "~";
  const hasNonce = a.nonce !== undefined && a.retryNonce !== undefined;
  const gap = hasNonce ? a.retryNonce! - a.nonce! - 1 : 0;
  const t = THRESHOLDS;

  const bot: string[] = [];
  if (hasNonce && a.nonce! >= t.lifetimeNonce) bot.push(`${fmt(a.nonce!)} prior transactions`);
  if (retrySecs <= t.retrySeconds) bot.push(`retried ${approx}${dur(retrySecs)} after failing`);
  if (gap >= t.burstGap && retrySecs <= t.burstSeconds) bot.push(`${gap} other transactions between failure and retry`);
  let window = "";
  if (a.calls !== undefined && a.scanBlocks) {
    const windowSecs = a.scanBlocks * blockSecs;
    const perHour = (a.calls / windowSecs) * 3600;
    window = `${a.calls} call${a.calls === 1 ? "" : "s"} to this contract in ~${dur(windowSecs)}`;
    if (a.calls >= t.repeatCalls && perHour >= t.repeatPerHour) bot.push(`${window}${a.fails ? ` (${a.fails} failed)` : ""}`);
  }
  if (bot.length) return { label: "bot-like", reasons: bot };

  const checked = [...(hasNonce ? [`${fmt(a.nonce!)} prior transactions`] : []), `retried ${approx}${dur(retrySecs)} after failing`];
  if (window) checked.push(window);
  if (!hasNonce) return { label: "unclassified", reasons: [`no account nonce on ${a.chain}, so only retry latency was checked: ${checked.join(", ")}`] };
  return { label: "human-like", reasons: [`no automation signal: ${checked.join(", ")}`] };
}
