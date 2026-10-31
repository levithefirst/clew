# Clew

When a transaction fails, Clew reads the receipt and revert through **Tatum RPC**. If the same wallet then sends a successful retry to the same contract, Clew diffs the two attempts and saves what changed to **Walrus Memory (Mainnet)**. The next time that wallet fails on that contract with a similar error, Clew recalls the memory and returns the **specific path that worked before** (which calldata words or function changed, plus a template tx; a gas hint only when the failure ran out of gas). Without the memory, all it can say is "reverted".

Clew handles one loop only: **failure → successful retry → next failure**.

## How it works

| Step | Code | What happens |
|---|---|---|
| 1. Ingest failure | `recordFailure(chain, hash)` in `src/clew.ts` | Tatum `eth_getTransactionReceipt` (status `0x0`) + `eth_getTransactionByHash` (input, gas, nonce) + `eth_getBlockByNumber` (timestamp). Revert from `debug_traceTransaction` (callTracer), falling back to an `eth_call` replay at `block-1`. Decodes `Error(string)` `0x08c379a0`, `Panic` `0x4e487b71`, and custom error selectors. |
| 2. Find the retry | `watchForRetry(failure, 10min)` | Polls Tatum `eth_getBlockReceipts` after the failed block for a status `0x1` tx from the same wallet to the same contract. |
| 3. Remember | `recordRetry(chain, failed, success)` → `src/memory.ts` | Diffs gas used, gas limit, gas price, nonce, value, function selector, and each differing 32-byte calldata word. Writes a factual memory with `memwal.remember()` → `waitForRememberJob()` to namespace `clew` on `https://relayer.memory.walrus.xyz`. |
| 4. Next failure | `onFailure(chain, hash)` | Ingests the new failure, runs `memwal.recall()`, then keeps only memories with an exact `chain` + `contract` + `wallet` match and a similar error signature. Returns `{priorPath, nextAction, suggestion}`: the stored `NEXT_ACTION` parsed into calldata changes, with the out-of-gas gate applied (below), as copy-ready text. Or a generic message if nothing matches. |

**Gas gate:** a gas hint is emitted only when the failed attempt ran out of gas (error signature `out-of-gas:*`, or gas used at least 98% of the limit). Otherwise the next action starts with the revert reason, and gas price stays in the factual "Change" record. The gate is applied again at recall time (`gateGasHints`), so memories written before it existed (5 of the 12 carry a gas hint; none of the 12 failures ran out of gas) are corrected when read, without rewriting Walrus.

**Error signature:** `revert:<normalized reason>` | `panic:<code>` | `custom:<selector>` | `out-of-gas:<fn selector>` | `<fn selector>:reverted`. "Similar" means an exact match, or a token-Jaccard score of at least 0.6 between two revert strings.

**Memory format** (tags first so recall and the strict filter both work; the diff is bounded):
```
CLEW chain=<chain> contract=<addr> wallet=<addr> error=<signature> selector=<4 bytes> failed_tx=<hash> success_tx=<hash> success_block=<n>[ rev=<n>].
Contract <addr> on <chain> failed with error <signature> (<detail, max 120 chars>) for wallet <addr>. Successful retry in tx <hash> at block <n>, <k> blocks later.
Change: gas used was <s> vs <f> on failure; gas limit <s> vs <f>; gas price <s> vs <f> wei; nonce <f> -> <s>; same function <sel>; calldata <f> -> <s> bytes; <m> arg word(s) changed (at most 3 shown, each clipped).
NEXT_ACTION: reason: <detail> (used <f> of <limit> gas, not out of gas); re-encode calldata: arg word <i> = <new> (was <old>); …; template tx <hash>
```
Memories written before this format (all 12 on Walrus today) omit the gas price, the sizes and the reason clause. Memory #1 (`0x15f0…` → `0x389a…`) also stored six unclipped 32-byte words. Walrus memories are never rewritten: a corrected version is a new write with `rev=2` and its own idempotency key (`chain:failed:success:r2`), linked in `memories.json` by `supersedes`. Recall and the site prefer the highest revision of a pair.

## Setup

Requires Node 20+ (memwal recommends a patched 22.x/24.x for production).

```bash
npm install
cp .env.example .env   # fill in, then: set -a; . ./.env; set +a
```

| Var | What |
|---|---|
| `MEMWAL_KEY` | Walrus Memory delegate private key (hex) |
| `MEMWAL_ACCOUNT_ID` | Walrus Memory account id |
| `TATUM_API_KEY` | Tatum API key (the free plan works; Clew throttles itself to ~3 req/s) |

Supported chains (Tatum gateways): `ethereum`, `base`, `polygon`, `arbitrum`, `optimism`, `bsc`.

## Commands

```bash
npm test                                   # offline: mocked RPC + in-memory store (decode, error sig, diff, loop)
npm run demo                               # full Mainnet loop -> demo-output.txt (idempotent)
npm run check -- base <failedTxHash>       # step 4 for any failure: prior path + next action, or generic
                                           #   --without-memory (empty namespace), --json (raw result)
npm run record -- base <failedTx> [okTx]   # steps 1-3: watch for the retry if okTx is omitted, then write memory
                                           #   --dry-run (print the memory text, write nothing), --rev N (corrected rewrite)
npm run discover -- base 150 300           # find real fail->success candidates (scan 150 blocks, 300-block window)
```

## Two-minute demo

Exact commands and expected output: [`DEMO.md`](DEMO.md). Write-up: [`BLOG.md`](BLOG.md).

1. `npm test` (about 1 s) shows the logic offline.
2. `npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6 --without-memory` returns only the generic "reverted" message.
3. The same command without the flag recalls the stored memory for wallet `0x336a…` on contract `0x8ea5…` and returns the earlier retry `0x389a…` with a copy-ready next action: the revert reason, then the calldata words to re-encode. No gas hint: that failure used 78% of its gas limit.
4. `memories.json` lists the 12 Walrus Mainnet writes (job id + blob id + text).

## What the demo used (all real Mainnet data, no fixtures)

- `scripts/discover.ts` scanned recent blocks with Tatum `eth_getBlockReceipts` on Base (151 blocks), Ethereum (41), and Polygon (101), looking for real `fail → later success` sequences from the same wallet to the same contract. `scripts/pick.ts` then chose 12 pairs on distinct contracts (8 Base, 2 Ethereum, 2 Polygon). 9 of those wallets failed **again** later with a similar error, so step 4 runs on real repeat failures. Candidate lists and picks are in `fixtures/`.
- **12 Walrus Mainnet memories**, all from real pairs. Each write was confirmed by `waitForRememberJob` (`blob_id` recorded in `memories.json`).
- Honest caveat: most wallets that fail and retry within minutes on-chain are bots (swap routers, MEV, relayers), so many of the "changes" are fresh quotes, deadlines, or a higher gas price. Clew reports exactly what differed. It doesn't claim to know why.

## Limits

- Tatum free plan: 3 req/s, so calls are serialized with a 360 ms gap and retried on 429. `debug_traceTransaction` with `callTracer` worked on Base, Ethereum, and Polygon on the free plan.
- Recall is semantic. Clew always applies a strict tag filter afterwards (chain + contract + wallet + similar error), so it never borrows another wallet's path.
- Idempotency comes from the local `memories.json` ledger plus memwal `idempotencyKey` = `chain:failedTx:successTx`. Reruns don't write duplicates.
