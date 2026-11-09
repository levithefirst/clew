# Clew

When a transaction fails, Clew reads the receipt through [Tatum](https://tatum.io) and, if the same wallet later succeeds on the same contract, stores what changed in [Walrus Memory](https://www.walrus.xyz) on Mainnet. The next time that wallet hits the same contract with a similar error, Clew returns the path that worked last time instead of “reverted”.

Clew handles one loop: **failure → successful retry → next failure**.

**Live demo:** [useclew.vercel.app](https://useclew.vercel.app) — paste a failed hash into Try it (also at [`/try`](https://useclew.vercel.app/try)). Base, Ethereum, Polygon, and Sui.

**Write-up:** [Clew: remembering the retry that worked](https://dev.to/levithefirst/clew-remembering-the-retry-that-worked-9gj) · **Demo video:** [on X](https://x.com/levithefirst/status/2119714520012595385)

## Tatum and Walrus

**Tatum** is how Clew reads the chain. On Base, Ethereum and Polygon it uses the JSON-RPC gateways: `eth_getTransactionReceipt` (status `0x0` is a failure, `0x1` a success), `eth_getTransactionByHash` (calldata, gas, nonce, value), `eth_getBlockByNumber` (timestamp), `eth_getBlockReceipts` (to find the later success from the same wallet to the same contract), and `debug_traceTransaction` with `callTracer` to decode the revert (`eth_call` replay at `block-1` if the trace is missing). It decodes `Error(string)` (`0x08c379a0`), `Panic(uint256)` (`0x4e487b71`) and custom error selectors. On Sui, Tatum’s gateway is GraphQL only (`POST https://sui-mainnet.gateway.tatum.io/graphql`): one transaction query returns sender, gas, status, checkpoint, Move calls, Pure inputs, and `executionError` (module, function, abort code). The free plan’s 3 requests/second limit is respected with a 360 ms gap between calls.

**Walrus Memory** is how Clew remembers. Writes go to the Mainnet relayer `https://relayer.memory.walrus.xyz` in namespace `clew` through `@mysten-incubation/memwal`: `remember(text, { idempotencyKey })` then `waitForRememberJob` until a `blob_id` comes back. Nothing counts as stored until that confirmation. Reads use `recall`, then a strict filter: exact chain + contract + wallet, and a similar error. Clew never borrows another wallet’s path. Job and blob ids live in `memories.json`. Each blob resolves on [Walruscan Mainnet](https://walruscan.com); the content is SEAL-encrypted, so the explorer proves the write happened without showing the text.

## Measured result

`npm run measure` read eight real Mainnet failures through Tatum once each and recalled twice: from an empty namespace (memory off) and from namespace `clew` (memory on).

| chain | failed tx | memory off | memory on | confidence | successes | later failures | demotion | prior retries | most consistent change |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base | `0xd72b6322…864bb6` | abstain | retry | 0.5 | 2 | 1 | true | 2 | calldata word 4 |
| base | `0x15f0e33c…1ac153` | abstain | retry | 0.5 | 2 | 1 | true | 2 | calldata word 4 |
| base | `0x05b27e70…fc07a8` | abstain | retry | 0.5 | 1 | 0 | false | 1 | calldata word 1 |
| base | `0x54d4427f…caeaf1` | abstain | retry | 0.5 | 2 | 1 | true | 2 | calldata word 4 |
| base | `0x987c3e00…27abce` | abstain | retry | 0.5 | 1 | 0 | false | 1 | calldata word 0 |
| ethereum | `0xd55c0f54…0b8a20` | abstain | retry | 0.5 | 1 | 0 | false | 1 | calldata word 2 |
| polygon | `0x08272ab6…492f81` | abstain | retry | 0.5 | 1 | 0 | false | 1 | calldata word 0 |
| sui | `GXwW6feRx3…ZR48Vj` | abstain | retry | 0.5 | 1 | 0 | false | 1 | a higher gas price on the retry |

8 failures: memory off acted on 0; memory on returned retry for 8, abort for 0, abstain for 0.

The Base rows that show 2 successes are wallet `0x336a…811d` on contract `0x8ea5…ac50` after `revert:too_little_received`. The live site ranks those earlier retries and leads with the change that appeared most often (here, calldata word 4, in 2 of 2).

## Run it

Requires Node 20+ (memwal recommends a patched 22.x/24.x for production).

```bash
npm install
cp .env.example .env   # then: set -a; . ./.env; set +a
npm test               # offline, currently 47 tests
```

| Variable | Used for |
| --- | --- |
| `TATUM_API_KEY` | All chain reads (the free plan works) |
| `MEMWAL_KEY` | Walrus Memory delegate private key (hex) |
| `MEMWAL_ACCOUNT_ID` | Walrus Memory account id |
| `DEMO_PRIVATE_KEY` | Optional, `npm run live-demo` only: a throwaway Base burner key |
| `CLEW_SUI_LIVE` | Set to `1` to allow live Sui reads (`POST /v1/recall` with `chain: "sui"`). Production has this on. |

```bash
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6 --without-memory
npm run recall -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
npm run measure -- hashes.txt          # one chain:hash per line; --json for raw rows
npm run record -- base <failedTx> [okTx] [--dry-run] [--rev N]
npm run demo                           # full Mainnet loop → demo-output.txt (idempotent)
npm run watch -- base [--store ledger]
npm run discover -- base 150 300 [--to N]
npm run pick -- base=8 ethereum=2
npm run classify
npm run sui:check
npm run sui -- record <failedDigest> [okDigest] [--dry-run]
npm run sui -- recall <failedDigest> [--store ledger]
npm run live-demo [-- --dry-run --address 0x…]
```

Supported chains through Tatum: `ethereum`, `base`, `polygon`, `arbitrum`, `optimism`, `bsc` (JSON-RPC), and `sui` (GraphQL, verified on Mainnet).

Command-by-command notes: [`DEMO.md`](DEMO.md). Write-up: [dev.to](https://dev.to/levithefirst/clew-remembering-the-retry-that-worked-9gj).

---

## How it works

| Step | Code | What happens |
| --- | --- | --- |
| 1. Ingest failure | `recordFailure(chain, hash)` in `src/clew.ts` | Tatum receipt + transaction + block, then revert decode as above. |
| 2. Find the retry | `watchForRetry(failure, 10min)` | Polls `eth_getBlockReceipts` after the failed block for a status `0x1` tx from the same wallet to the same contract. |
| 3. Remember | `recordRetry` → `src/memory.ts` | Diffs gas used, gas limit, gas price, nonce, value, function selector, and each differing 32-byte calldata word. Writes to namespace `clew`. |
| 4. Next failure | `onFailure(chain, hash)` | Ingests the new failure, recalls from Walrus, keeps only memories with an exact chain + contract + wallet match and a similar error, and returns the stored next action (with the gas gate applied). |

**Learning over time.** When the same wallet has more than one earlier retry that succeeded after this contract and error, recall counts each kind of change across them (a calldata word by position, a function selector, a higher gas price, a higher gas limit), leads with the most frequent labelled with its count (“calldata word 4, in 2 of 2 earlier retries that succeeded after this same error”), and uses the newest retry that made that change as the template. When a calldata change is the majority, gas is kept apart as “also differed, not shown as a cause” and the gas-limit hint is held back. If nothing repeats it says so and shows the most recent. One earlier success behaves as a single-memory answer. Counts describe what the earlier retries did, not why they worked.

The Base wallet `0x336a079d7b894f6b6356674b3ad668bffdd5811d` has two stored retries on `0x8ea5ad2a58c1dae75394b1e8636e6518eb6dac50` after `too little received`. Pasting `0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6` on the live site returns that ranked answer. Ranking is also covered by `tests/ranking.test.ts`.

Synthetic illustration (four stored retries, three changed word 1, all four bid a higher gas price):

```
after 1 remembered retry:   - Re-encode calldata like the retry: arg word 1 = 0x6c (was 0x65)
after 2 remembered retries: - Most consistent change: calldata word 1, in 2 of 2 earlier retries that succeeded after this same error.
                            - Also differed, not shown as a cause: a higher gas price on the retry (2 of 2).
after 4 remembered retries: - Most consistent change: calldata word 1, in 3 of 4 earlier retries that succeeded after this same error.
                            - Also differed, not shown as a cause: a higher gas price on the retry (4 of 4).
```

**Gas gate.** A gas hint is emitted only when the failed attempt ran out of gas (error signature `out-of-gas:*`, or gas used at least 98% of the limit). Otherwise the next action starts with the revert reason, and gas price stays in the factual “Change” record. The gate is applied again at recall time (`gateGasHints`), so older memories that carried a gas hint are corrected when read, without rewriting Walrus. None of the stored failures ran out of gas (the highest used 78% of its limit).

**Error signature.** `revert:<normalized reason>` \| `panic:<code>` \| `custom:<selector>` \| `out-of-gas:<fn selector>` \| `<fn selector>:reverted`. “Similar” means an exact match, or a token-Jaccard score of at least 0.6 between two revert strings.

**Memory format** (tags first so recall and the strict filter both work; the diff is bounded):

```
CLEW chain=<chain> contract=<addr> wallet=<addr> error=<signature> selector=<4 bytes> failed_tx=<hash> success_tx=<hash> success_block=<n>[ rev=<n>].
Contract <addr> on <chain> failed with error <signature> (<detail, max 120 chars>) for wallet <addr>. Successful retry in tx <hash> at block <n>, <k> blocks later.
Change: gas used was <s> vs <f> on failure; gas limit <s> vs <f>; gas price <s> vs <f> wei; nonce <f> -> <s>; same function <sel>; calldata <f> -> <s> bytes; <m> arg word(s) changed (at most 3 shown, each clipped).
NEXT_ACTION: reason: <detail> (used <f> of <limit> gas, not out of gas); re-encode calldata: arg word <i> = <new> (was <old>); …; template tx <hash>
```

Earlier EVM memories omit the gas price, the sizes and the reason clause. Memory #1 (`0x15f0…` → `0x389a…`) also stored six unclipped 32-byte words; a corrected rewrite was stored as `rev=2` (blob `-TPBis5hFtwGoakXTDFdqTR9coE_OTCNTX70TUTB3sA`) with its own idempotency key `chain:failed:success:r2`, linked in `memories.json` by `supersedes`. Walrus memories are never edited in place. Recall and the site prefer the highest revision of a pair.

There are **16 fail→success memories** on Walrus Mainnet (10 Base, 2 Ethereum, 2 Polygon, 2 Sui), plus that one corrected rewrite, for **17 entries** in `memories.json`.

## Try it

https://useclew.vercel.app has a Try it box (also at `/try`): paste a failed transaction hash (Base, Ethereum, Polygon or a Sui digest). Clew finds the chain, reads the receipt through Tatum, and shows two columns from the same run, then the structured agent response for that failure.

- **Memory off:** what Clew says with an empty Walrus namespace — a generic “reverted” message — plus a one-sentence plain-English reason.
- **Memory on:** the retry that worked before (source transaction), what changed, the copyable next action (with ranking when more than one earlier success exists), and the Walrus blob id. If the wallet has no memory on that contract, both columns say so.
- **Agent response:** the `POST /v1/recall` fields for the same hash (`action`, `recommended`, `confidence`, `evidence`, `demotionFlag`, `priorRetries`).

The example buttons are real repeat failures from the Mainnet runs, with the **featured** one first: an Ethereum wallet (`0xaffa7d95ea5984a18e1b4d6f38c1175bdb18a793`, 65 prior transactions, no automation signal) whose retry changed one calldata word, a deadline moved 60 seconds forward, not just gas. `web/scripts/build-data.mjs` picks it by rule (Base or Ethereum, no automation signal, a calldata word changed, a later failure from the same wallet). “No automation signal” is what the heuristic can say, not proof of a person. The page only reads; it never writes a memory.

- Logic: `src/explain.ts` (`checkFailure`), `src/reasons.ts`, `src/agent.ts` (`POST /v1/recall`). `POST /api/check` powers the two columns.
- Server settings (Vercel project, names only): `TATUM_API_KEY`, `MEMWAL_KEY`, `MEMWAL_ACCOUNT_ID`, and `CLEW_SUI_LIVE=1` for live Sui. Without the three keys the box falls back to the recorded run for the example buttons, labelled as recorded, and shows a plain message for any other hash. Give the website a dedicated Walrus delegate key; the delegate can write to its account.
- Limits: `/api/check` is rate-limited to 6 calls a minute per server instance and answers are cached for 5 minutes. `/v1/recall` allows 12 calls a minute and caches answers for 60 seconds. Best-effort on serverless, not a hard cap.
- The vendored core: Vercel builds `web/` with its own install, so the API can’t import `../src`. `web/lib/core/` is a generated copy (`npm run sync-core` in `web/`), and `tests/core-sync.test.ts` fails if it drifts.
- A first-time visitor whose wallet has never been remembered gets the plain explanation and “no memory”. The answer changes on a repeat failure.

## Agent endpoint: `POST /v1/recall`

One call in, one JSON object out. It runs the same recall and ranking as Try it and adds an action, a concrete retry and a confidence for the path.

```
POST https://useclew.vercel.app/v1/recall     (GET with ?chain=&failedTxHash= works too; read-only)
{ "chain": "base" | "ethereum" | "polygon" | "sui", "failedTxHash": "0x…", "agentId": "optional" }
->
{ "action": "retry" | "abort" | "abstain",
  "recommended": { "calldata": "0x…" | null, "gasLimit": 246585 | null, "gasPrice": "21373757" | null, "nonceStrategy": "next" | null },
  "confidence": 0.5,
  "evidence": { "successes": 2, "laterFailures": 1, "mostConsistentChange": "calldata word 4", "blobIds": ["…"] },
  "demotionFlag": true,
  "priorRetries": 2 }
```

Errors are `{ "error": { "code", "message" } }` with 400 `bad_input`, 404 `not_found`, 422 `not_a_failure`, 429 `rate_limited`, 501 `sui_disabled`, 502 `upstream`, 503 `unconfigured`. Read-only: nothing is written to Walrus. Limits: 12 calls a minute per `agentId` (else per client address, best-effort per server instance), answers cached 60 seconds.

- **action:** `abstain` when nothing is remembered for this wallet + contract + error. `retry` while successes outnumber later failures. `abort` once later failures catch up (the remembered path has failed as often as it worked); `recommended` is then all null.
- **recommended:** `calldata` is the failed call’s calldata with the retry’s change applied (full words, read from the two transactions, not the clipped memory text); null on Sui. `gasLimit` and `gasPrice` are the failed attempt’s own unless the failure ran out of gas. `gasPrice` is a decimal string (wei, or MIST on Sui). `nonceStrategy` is `next`: a failed transaction is mined and spent its nonce.
- **Confidence** for a (wallet + contract + error) path: `successes / (successes + laterFailures + 1)`. `successes` are the distinct earlier retries that worked. A **later failure** is a distinct failure on the path that arrived after one of those successes: a failure already on record (it has its own retry in memory) counts when its block is later than that success; the failure you are asking about counts only when it replays a remembered change (its calldata already holds the retry’s value, so the path was applied and failed). A plain next failure is the question, not evidence against the path. Everything is read from the stored memory text (failure block = success block minus “N blocks later”) and the failure itself, so it works on every memory already on Walrus and stores nothing new.
- **Demotion:** any later failure sets `demotionFlag` and lowers confidence. In the ranking, a retry outrun by later failures votes with weight `1 / (1 + its later failures)`; the counts shown stay plain counts. So a new failure after a success can change which change leads (covered in `tests/agent.test.ts`). One memory is unchanged: no ranking, same advice, confidence 0.5.
- **Real data:** Base failure `0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6` has two stored retries on the same contract and error, and that failure landed after the first retry’s success: 2 successes, 1 later failure, confidence 0.5, `demotionFlag` true, action `retry`, `mostConsistentChange` `calldata word 4`.
- **Sui:** `chain: "sui"` takes a transaction digest and returns the same object. Live Sui reads run when the deployment sets `CLEW_SUI_LIVE=1` (otherwise 501 `sui_disabled`, no Sui call). Production has this set. Code: `loadFailure` in `src/agent.ts`; a caller can also pass `loadSui` or a generic `load`. Sui `recommended.calldata` is null (Sui has Pure inputs, not calldata). Verified live on 2026-11-07 for digest `GXwW6feRx386m9W3z7UX9CRWAFNyuGETWPux6zZR48Vj` (blob `qNi52wSgAQz8iz2XcTpgbbXQL4A0KS3Z3focMSu7eUs`).
- **CLI:** `npm run recall -- base 0xd72b…` runs the same code locally (needs the three keys).

### Measurement harness

`npm run measure -- hashes.txt` (one `chain:hash` per line, `#` comments allowed; `--json` for rows) reads each failure through Tatum once and recalls twice, from an empty namespace (memory off) and from the real one (memory on), then prints a Markdown table. A row that cannot be read shows its error and the run continues. Code in `src/measure.ts`; the offline test is in `tests/agent.test.ts`. It makes live calls when run, so it is not part of `npm test`.

## What the stored memories are

`scripts/discover.ts` scanned recent blocks with Tatum `eth_getBlockReceipts` on Base (151 blocks), Ethereum (41), and Polygon (101), looking for real `fail → later success` sequences from the same wallet to the same contract. `scripts/pick.ts` chose 12 pairs on distinct contracts (8 Base, 2 Ethereum, 2 Polygon). That pick predates the wallet classifier; the tags were added afterwards from the same data. Nine of those wallets failed again later with a similar error, so step 4 runs on real repeat failures. Two Sui pairs were added from Tatum GraphQL (2026-10-31). Two further Base pairs were written later: a low-activity wallet (`0xf22f566751f933545deb42c1637adeb7fa11ee24`, calldata word 1 changed) and a second success for `0x336a…811d` (so ranking has two retries to count). Candidate lists and picks are in `fixtures/`.

Every write was confirmed by `waitForRememberJob` (`blob_id` in `memories.json`).

Honest caveat: most wallets that fail and retry within minutes on-chain are bots (swap routers, MEV, relayers), so many of the “changes” are fresh quotes, deadlines, or a higher gas price. Clew reports exactly what differed. It does not claim to know why. Of the 17 ledger entries, `npm run classify` tags 14 bot-like, 2 human-like, and 1 unclassified. The two human-like wallets show no automation signal: Ethereum `0xaffa7d95ea5984a18e1b4d6f38c1175bdb18a793` (65 prior transactions, retried about 48 s later) and Base `0xf22f566751f933545deb42c1637adeb7fa11ee24` (982 prior transactions, retried about 5 minutes later). “Human-like” only means no signal was seen, never that a person is confirmed. The unclassified memory is Sui `GXwW6feR…`: Sui has no account nonce, so only retry latency can be checked.

## Watcher

`npm run watch -- <chain>` polls Tatum for every new block, keeps the failed receipts whose wallet and contract already have a memory, runs recall on each, and prints the prior successful path.

```bash
npm run watch -- base                      # from the current head; Ctrl-C to stop, rerun to resume
npm run watch -- base --store ledger       # recall from memories.json: needs only TATUM_API_KEY
npm run watch -- base --from 53160000 --blocks 300 --verbose
npm run watch -- base --record fixtures/watch-recorded.json
```

- **Rate limit:** one header plus one `eth_getBlockReceipts` call per block (about 1 request per second on Base). All calls go through the 360 ms throttle, and a 429 backs off and retries.
- **Resume:** the cursor (`.clew/watch-<chain>.json`, git-ignored) is saved after every block.
- **Reorgs:** the watcher keeps the last 12 block hashes. If a new block’s parent hash doesn’t match, it rewinds one block and rescans. A failure that appears again on the new chain is not reported twice.
- **Output** (stable, one block per event):

```
WATCH base from block <n> (new cursor .clew/watch-base.json), <k> wallet+contract pairs with memories, store walrus
FAILURE base block <n> tx <hash>
  wallet <addr> -> contract <addr>
  error <signature> (<detail>)
  WITH MEMORY prior success <hash> (block <n>, blob <id>)
  NEXT ACTION
    ...
REORG at block <n>: parent hash changed, rewound to <n-1>
```

- **Tests:** `tests/watch.test.ts` replays `fixtures/watch-stream.json` (hand-built, marked synthetic) through the same code. It covers a reorg, a watched failure next to an unwatched one, recall, and resume.

No live catch has been recorded yet. The watcher (EVM chains) only reports failures from remembered EVM wallet+contract pairs, so a catch needs one of those wallets to fail again while it runs.

## Live demo (optional burner)

`npm run live-demo` produces a fresh example on Base Mainnet using Base’s canonical WETH (`0x4200000000000000000000000000000000000006`). `withdraw(wad)` reverts when `wad` exceeds the caller’s balance.

| Step | Transaction | Expected |
| --- | --- | --- |
| setup (only if WETH balance < 1 gwei) | `deposit()` with 1 gwei of ETH | success |
| failure | `withdraw(balance + 1 gwei)` | revert |
| retry | `withdraw(1 gwei)` | success |
| memory | diff the pair, write to Walrus | stored |
| next failure | `withdraw(balance + 2 gwei)` | revert, then recall without and with memory |

Recall should answer the second failure with “re-encode calldata: arg word 0 = 0x3b9aca00” (1 gwei) and the retry as the template tx. The run stops at the first transaction whose status isn’t the expected one. Every call goes through Tatum (`eth_sendRawTransaction`, receipts, traces).

Use a new throwaway key that holds nothing else. Send it a few cents of ETH on Base. Each run sends 3 or 4 transactions of 25k to 45k gas. The script refuses to start if the maximum L2 fee for the run exceeds 0.0003 ETH. Put the key in `.env` as `DEMO_PRIVATE_KEY` (git-ignored). It is read from the environment, used only to sign, and never printed; output shows the derived address only.

```bash
npm run live-demo -- --dry-run --address 0xYourBurner
npm run live-demo
```

`tests/live.test.ts` runs the same flow offline against a fake Base chain with WETH9 behaviour, signing with Anvil’s public dev key, and checks that the key never appears in the output. A real run has not been made yet.

## Sui

`src/sui.ts` runs the same loop on Sui through Tatum’s Sui gateway. That gateway serves **GraphQL only** (`POST https://sui-mainnet.gateway.tatum.io/graphql`, `x-api-key`, one operation per request), not `sui_*` JSON-RPC. A first JSON-RPC version failed with HTTP 404 on a real run and was replaced.

Verified on Sui Mainnet on 2026-10-31 (project keys): `npm run sui:check` printed `SUI GATEWAY OK` at checkpoint 340173364 (50 programmable transactions decoded, 2 FAILURE, single-transaction query passed, retry search found a later SUCCESS). Two memories were written to Walrus Mainnet:

| Failed | Retry | Error | Change | Wallet tag |
| --- | --- | --- | --- | --- |
| `GXwW6feRx386m9W3z7UX9CRWAFNyuGETWPux6zZR48Vj` | `ByGXz3iXES3NHEAbXzZmfNuKmHZVQkuak9mGGag4U6JV`, 441 checkpoints later | `moveabort:errors::err_amount_out_slippage_check_failed:1` on `0xde5d…9640::router` | gas price 3,410 → 17,038 MIST, budget 6,410,000 → 20,038,000; pure inputs identical | unclassified (no nonce on Sui; retried about 106 s later) |
| `FzUf8HxE3yeT4dVxNEvrtAoK99WCvDJkFBivGrUjoDYp` | `EthYTxV1SnLdTRuc4VAhBJ8Q7Lg8AvTykmCzYMWhrTtw`, 3 checkpoints later | `moveabort:order_info::assert_execution:5` on `0xcaf6…ec3a::balance_manager` | gas budget only | bot-like (retried within about a second) |

Recall on a later failure from the same router sender, `6mDBLQjL4Ld48683HjpZnV4xBQEZB5ymohxzxNaYxcvM`, returned the earlier success `ByGXz3iX…U6JV` with the reason “used 3411613 of 6410000 gas, not out of gas” (so no gas hint), even though the retry had raised the gas price about fivefold. On 2026-11-07 the live endpoint returned the same structured shape as Base for both `GXwW6feR…` and `6mDBLQjL…` (blob `qNi52wSgAQz8iz2XcTpgbbXQL4A0KS3Z3focMSu7eUs`). The slippage pair is the useful one. The `balance_manager` pair is weaker: only the gas budget changed, and the wallet retried within about a second.

On 2026-11-07 Tatum’s GraphQL `transactions` list query returned “Failed to list transactions”, so a new pair could not be discovered that day. Single-transaction reads still worked.

| EVM concept | Sui equivalent |
| --- | --- |
| wallet | sender |
| contract | the called `package::module` that matches the abort location (else one in the same package, else the last Move call) |
| block | checkpoint |
| calldata words | `Pure` inputs (BCS bytes, shown as hex); object inputs are not compared |
| revert reason | `executionError`: `moveabort:<module>::<function>:<abortCode>` |

Retry search uses one server-side filter, `transactions(filter: { sentAddress, function: "<package>::<module>", afterCheckpoint })`. The `function` filter matches functions the transaction *called*, so filtering on the abort location returns nothing when that function was not a command. Sui reports out-of-gas as “Insufficient Gas”; it maps to `out-of-gas`, so the gas gate applies unchanged. Both memories were written before the input wording was tightened: their “inputs identical” means the Pure inputs were identical; object inputs are not compared. New memories say “pure inputs identical” and how many inputs are Pure.

`sui:check` looks at failures about 10 minutes old, so their retries can already exist. `--record` saves every request and response. Tests parse two real responses recorded through Tatum on 2026-10-31 (`fixtures/sui-recorded-2026-10-31.json`); command lists, sender history and the record/recall flow are synthetic and labelled. The real recall is in `fixtures/sui-recall-2026-10-31.json`. Checkpoint time for latency (about 0.24 s) is measured from two Suiscan timestamps.

## Wallet classifier

Most wallets that fail and retry within minutes are bots, so Clew labels each one with a transparent heuristic (`src/classify.ts`). Any one signal makes a wallet **bot-like**:

| Signal | Threshold |
| --- | --- |
| Lifetime nonce (transactions sent before the failure) | >= 10,000 |
| Retry latency | <= 6 s |
| Other transactions between failure and retry | >= 3 within 60 s |
| Calls to the same contract in the discovery scan window | >= 5, at >= 30 per hour |

No signal makes it **human-like**, which only means no automation signal was seen. It never means “a person”: a slow, low-volume bot passes, and a power user running a script fails. Latency comes from block timestamps when the transactions are loaded live (`pick`), or from block count times average block time when only the memory text is available (`classify`, marked `~`). The repeat-call signal needs discovery data; the scan size per chain for the original candidates is in `fixtures/scans.json`. `pick` ranks human-like wallets with a real repeat failure first, so the headline example comes from a human-like wallet when one is available.

## Limits

- Tatum free plan: 3 req/s, so calls are serialized with a 360 ms gap and retried on 429. `debug_traceTransaction` with `callTracer` worked on Base, Ethereum, and Polygon on the free plan.
- Recall is semantic. Clew always applies a strict tag filter afterwards (chain + contract + wallet + similar error), so it never borrows another wallet’s path.
- Idempotency comes from the local `memories.json` ledger plus memwal `idempotencyKey` = `chain:failedTx:successTx`. Reruns don’t write duplicates.
