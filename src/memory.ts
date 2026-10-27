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

type Ledger = Record<string, { job_id?: string; blob_id: string; namespace: string; written_at: string; text: string }>;
export const readLedger = (): Ledger => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : {});

export const walrus: MemoryStore = {
  async remember(text, key) {
    const ledger = readLedger();
    if (ledger[key]) return { ...ledger[key], skipped: true }; // idempotent: never re-write the same pair
    const m = memwal();
    const accepted = await m.remember(text, { idempotencyKey: key });
    const done = await m.waitForRememberJob(accepted.job_id, { timeoutMs: 180_000, pollIntervalMs: 2_000 });
    ledger[key] = { job_id: accepted.job_id, blob_id: done.blob_id, namespace: done.namespace, written_at: new Date().toISOString(), text };
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
    return { job_id: accepted.job_id, blob_id: done.blob_id };
  },
  async recall(query, opts = {}) {
    const r = await memwal().recall({ query, topK: opts.topK ?? 10, namespace: opts.namespace ?? NAMESPACE });
    return r.results.map((x) => ({ text: x.text, blob_id: x.blob_id, distance: x.distance }));
  },
};
