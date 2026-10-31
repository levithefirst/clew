// Live watcher: poll Tatum for new failed transactions from wallet -> contract pairs that already have a memory,
// then recall and return the prior successful path. One block = one header (hash + parent, for reorgs) + one
// eth_getBlockReceipts call, so a 2 s chain costs ~1 req/s, under the free plan's 3 req/s (tatum.ts throttles and
// backs off on 429). The cursor is saved after every block, so a restart resumes where it stopped.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { blockNumber, getBlock, getBlockReceipts } from "./tatum.ts";
import { onFailure } from "./clew.ts";
import { readLedger, type MemoryStore } from "./memory.ts";

/** Blocks of history kept to detect reorgs, and tx hashes kept to avoid re-reporting a failure after a reorg rescan. */
const REORG_DEPTH = 12, SEEN_MAX = 500;

export interface Cursor {
  chain: string;
  /** Last fully processed block. */
  block: number;
  /** Hashes of the last REORG_DEPTH processed blocks, oldest first; the last one is `block`'s hash. */
  hashes: string[];
  /** Failed tx hashes already reported (bounded). */
  seen: string[];
}

export type WatchEvent =
  | { type: "start"; chain: string; block: number; pairs: number; resumed: boolean }
  | { type: "block"; chain: string; block: number; receipts: number }
  | { type: "reorg"; chain: string; block: number; rewoundTo: number }
  | { type: "failure"; chain: string; block: number; hash: string; wallet: string; contract: string }
  | { type: "recall"; hash: string; result: Awaited<ReturnType<typeof onFailure>> }
  | { type: "error"; hash: string; message: string };

export interface WatchOptions {
  store: MemoryStore;
  cursorFile?: string;
  /** Start block when there is no saved cursor (default: current head). */
  from?: number;
  /** Stop after this many processed blocks (default: run forever). */
  maxBlocks?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** wallet|contract pairs on `chain` that have at least one memory in the ledger. */
export function watchedPairs(chain: string): Set<string> {
  const pairs = new Set<string>();
  for (const m of Object.values(readLedger())) {
    const tag = (k: string) => m.text.match(new RegExp(`\\b${k}=(\\S+?)(?:\\.|\\s|$)`))?.[1];
    if (tag("chain") === chain) pairs.add(`${tag("wallet")}|${tag("contract")}`);
  }
  return pairs;
}

export function loadCursor(file: string, chain: string): Cursor | null {
  if (!existsSync(file)) return null;
  const c: Cursor = JSON.parse(readFileSync(file, "utf8"));
  if (c.chain !== chain) throw new Error(`${file} is a ${c.chain} cursor, not ${chain}`);
  return c;
}

function saveCursor(file: string | undefined, c: Cursor) {
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
}

export async function* watch(chain: string, opts: WatchOptions): AsyncGenerator<WatchEvent> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 2_000;
  const pairs = watchedPairs(chain);
  const saved = opts.cursorFile ? loadCursor(opts.cursorFile, chain) : null;
  const cursor: Cursor = saved ?? { chain, block: (opts.from ?? (await blockNumber(chain))) - 1, hashes: [], seen: [] };
  yield { type: "start", chain, block: cursor.block + 1, pairs: pairs.size, resumed: Boolean(saved) };

  for (let done = 0; opts.maxBlocks === undefined || done < opts.maxBlocks; ) {
    const n = cursor.block + 1;
    if (n > (await blockNumber(chain))) { await sleep(pollMs); continue; }

    const header = await getBlock(chain, n);
    const parent = cursor.hashes.at(-1);
    if (parent && lc(header.parentHash) !== parent) {
      // The block we built on was replaced: step back one block and rescan from there.
      cursor.hashes.pop();
      cursor.block -= 1;
      saveCursor(opts.cursorFile, cursor);
      yield { type: "reorg", chain, block: n, rewoundTo: cursor.block };
      continue;
    }

    const receipts: any[] = (await getBlockReceipts(chain, n)) ?? [];
    yield { type: "block", chain, block: n, receipts: receipts.length };
    const hits = receipts.filter((r) => r.status === "0x0" && pairs.has(`${lc(r.from)}|${lc(r.to)}`) && !cursor.seen.includes(lc(r.transactionHash)));
    for (const r of hits) {
      const hash = lc(r.transactionHash);
      yield { type: "failure", chain, block: n, hash, wallet: lc(r.from), contract: lc(r.to) };
      try {
        yield { type: "recall", hash, result: await onFailure(chain, hash, { store: opts.store }) };
      } catch (e: any) {
        yield { type: "error", hash, message: e.message };
      }
      cursor.seen = [...cursor.seen, hash].slice(-SEEN_MAX);
    }

    cursor.block = n;
    cursor.hashes = [...cursor.hashes, lc(header.hash)].slice(-REORG_DEPTH);
    saveCursor(opts.cursorFile, cursor);
    done++;
  }
}
