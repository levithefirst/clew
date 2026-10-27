export const SITE = {
  name: "Clew",
  repo: "https://github.com/levithefirst/clew",
  tagline: "Stop guessing why it reverted. Clew remembers what worked.",
  description:
    "The next time the same contract fails with a similar error, Clew surfaces the exact prior successful retry path (the calldata change, the gas, the nonce) instead of a generic “transaction reverted”.",
  tatum: "https://tatum.io",
  walrus: "https://memory.walrus.xyz",
} as const;

/** Set the first time /account renders the welcome, so it shows once per browser. */
export const WELCOMED_COOKIE = "clew_welcomed";
