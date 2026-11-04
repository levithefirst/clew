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

