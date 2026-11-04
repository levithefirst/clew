// Walrus Memory (Mainnet relayer) via @mysten-incubation/memwal. Namespace "clew".
import { MemWal } from "@mysten-incubation/memwal";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const RELAYER = process.env.MEMWAL_SERVER_URL ?? "https://relayer.memory.walrus.xyz";
export const NAMESPACE = "clew";
const LEDGER = process.env.CLEW_LEDGER ?? "memories.json"; // local record of what was written (ids only, no secrets)

export interface Recalled { text: string; blob_id: string; distance: number }
export interface MemoryStore {
  remember(text: string, key: string): Promise<{ job_id?: string; blob_id: string; skipped?: boolean }>;
  recall(query: string, opts?: { namespace?: string; topK?: number }): Promise<Recalled[]>;
}

let client: MemWal | null = null;
function memwal(): MemWal {
  if (!client) {
    const key = process.env.MEMWAL_KEY, accountId = process.env.MEMWAL_ACCOUNT_ID;
    if (!key || !accountId) throw new Error("MEMWAL_KEY / MEMWAL_ACCOUNT_ID not set");
    client = MemWal.create({ key, accountId, serverUrl: RELAYER, namespace: NAMESPACE });
  }
  return client;
}

/** One ledger entry per Walrus write. `supersedes` links a corrected rewrite (key suffix :rN) to the key it replaces. */
type Ledger = Record<string, { job_id?: string; blob_id: string; namespace: string; written_at: string; text: string; supersedes?: string }>;

/** chain:failed:success:r3 -> chain:failed:success:r2; :r2 -> the original key. */
export const supersededKey = (key: string): string | undefined => {
  const m = key.match(/^(.*):r(\d+)$/);
  if (!m) return undefined;
  return Number(m[2]) > 2 ? `${m[1]}:r${Number(m[2]) - 1}` : m[1];
};
// The ledger path is a runtime setting (CLEW_LEDGER), so the bundler is told not to trace the whole project for it.
export const readLedger = (): Ledger => (existsSync(/*turbopackIgnore: true*/ LEDGER) ? JSON.parse(readFileSync(/*turbopackIgnore: true*/ LEDGER, "utf8")) : {});

export const walrus: MemoryStore = {
  async remember(text, key) {
    const ledger = readLedger();
    if (ledger[key]) return { ...ledger[key], skipped: true }; // idempotent: never re-write the same pair
    const m = memwal();
    const accepted = await m.remember(text, { idempotencyKey: key });
    const done = await m.waitForRememberJob(accepted.job_id, { timeoutMs: 180_000, pollIntervalMs: 2_000 });
    const supersedes = supersededKey(key);
    if (supersedes && !ledger[supersedes]) throw new Error(`${key} corrects ${supersedes}, which is not in the ledger`);
    ledger[key] = { job_id: accepted.job_id, blob_id: done.blob_id, namespace: done.namespace, written_at: new Date().toISOString(), text, ...(supersedes && { supersedes }) };
    writeFileSync(/*turbopackIgnore: true*/ LEDGER, JSON.stringify(ledger, null, 2) + "\n");
    return { job_id: accepted.job_id, blob_id: done.blob_id };
  },
  async recall(query, opts = {}) {
    const r = await memwal().recall({ query, topK: opts.topK ?? 10, namespace: opts.namespace ?? NAMESPACE });
    return r.results.map((x) => ({ text: x.text, blob_id: x.blob_id, distance: x.distance }));
  },
};

/**
 * Recall from the local ledger instead of Walrus: every memory Clew wrote, unranked. The caller's strict tag filter
 * (chain + contract + wallet + similar error) does the matching. For runs without MEMWAL keys and for tests; it never
 * writes, because a memory only counts once Walrus confirms it.
 */
export const ledgerStore: MemoryStore = {
  async remember() { throw new Error("ledger store is read-only: write memories through Walrus"); },
  async recall() { return Object.values(readLedger()).map((m) => ({ text: m.text, blob_id: m.blob_id, distance: 0 })); },
};
