// GENERATED from src/reasons.ts by web/scripts/sync-core.mjs. Do not edit here; edit src/ and run `npm run sync-core` in web/.
// Plain-English reasons for failed transactions. No imports on purpose: the website uses it in the browser, where
// pulling in the Tatum and Walrus code would be wrong.
export interface Reason { text: string; known: boolean }

const RULES: { match: RegExp; text: string }[] = [
  { match: /out-of-gas|insufficient[ _]?gas/i, text: "The transaction ran out of gas before it could finish, so everything it did was undone." },
  { match: /too_little_received|insufficient_output|min_?return|amount_?out|slippage|price_impact/i, text: "The price moved past the slippage limit before the swap landed, so the contract refused to fill it at the worse rate." },
  { match: /expired|deadline|time_window|too_late/i, text: "The transaction waited too long and passed its deadline, so the contract rejected it." },
  { match: /insufficient.*(balance|allowance|funds)|exceeds_balance|exceeds_allowance|transfer_amount|stf\b/i, text: "The wallet didn't have enough balance, or hadn't approved enough, for the amount in the transaction." },
  { match: /^panic:11/, text: "A calculation inside the contract overflowed or underflowed, so it stopped." },
  { match: /^panic:12/, text: "A calculation inside the contract divided by zero, so it stopped." },
];

/** A one-sentence explanation from the error signature. It is pattern matching, not knowledge of the contract. */
export function explainError(errorSig: string | undefined, errorDetail: string | undefined): Reason {
  const sig = errorSig ?? "";
  const hit = RULES.find((r) => r.match.test(sig) || r.match.test(errorDetail ?? ""));
  if (hit) return { text: hit.text, known: true };
  const code = sig.startsWith("custom:") ? ` (error code ${sig.slice(7)})` : "";
  return { text: `The contract refused the call${code}. Clew can't translate this error without the contract's source code, so it shows what the contract said.`, known: false };
}


export interface Change {
  /** What differed in the call itself. Empty when the retry was byte for byte the same call. */
  changed: string[];
  /** Gas differences, reported as facts. They are shown apart because a higher limit or price is rarely the cause. */
  alsoDiffered: string[];
}

const n = (v: string) => Number(v).toLocaleString("en-US");
const words = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Reads the "Change: ..." sentence of a stored memory (any format Clew has written) into short facts.
 * Nonce and gas used are left out: they differ on every retry and say nothing about what to do.
 */
export function summarizeChange(change?: string): Change {
  const text = change ?? "";
  const changed: string[] = [], alsoDiffered: string[] = [];
  const fn = text.match(/function (0x[0-9a-f]+) -> (0x[0-9a-f]+)/);
  if (fn) changed.push(`function ${fn[1]} \u2192 ${fn[2]}`);
  const calldata = text.match(/(\d+) arg word\(s\) changed/);
  if (calldata) changed.push(words(Number(calldata[1]), "calldata word"));
  const calls = text.match(/Move calls (.+?) -> (.+?);/);
  if (calls) changed.push(`Move calls ${calls[1]} \u2192 ${calls[2]}`);
  const pure = text.match(/(\d+) pure input\(s\) changed/) ?? text.match(/(\d+) input\(s\) changed/);
  if (pure) changed.push(words(Number(pure[1]), "pure input"));
  const limit = text.match(/gas limit (\d+) vs (\d+)/);
  if (limit && limit[1] !== limit[2]) alsoDiffered.push(`gas limit ${n(limit[2])} \u2192 ${n(limit[1])}`);
  const price = text.match(/gas price (\d+) vs (\d+)/);
  if (price && price[1] !== price[2]) alsoDiffered.push(`gas price ${n(price[2])} \u2192 ${n(price[1])}`);
  return { changed, alsoDiffered };
}
