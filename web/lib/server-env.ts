// Import this before any lib/core module. The Walrus ledger is a local file (memories.json in the CLI); on Vercel
// only /tmp is writable, and a failed ledger write must never turn a confirmed Walrus write into an error.
process.env.CLEW_LEDGER ??= "/tmp/clew-ledger.json";

/** The three secrets live lookups need. Names only; values are never read into responses or logs. */
export const LIVE_ENV = ["TATUM_API_KEY", "MEMWAL_KEY", "MEMWAL_ACCOUNT_ID"] as const;
export const liveConfigured = () => LIVE_ENV.every((k) => Boolean(process.env[k]?.trim()));
