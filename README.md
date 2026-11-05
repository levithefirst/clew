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

**Learning over time:** when the same wallet has more than one earlier retry that succeeded after this contract and error, recall counts each kind of change across them (a calldata word by position, a function selector, a higher gas price, a higher gas limit), leads with the most frequent labelled with its count ("calldata word 1, in 3 of 4 earlier retries that succeeded after this same error"), and uses the newest retry that made that change as the template. When a calldata change is the majority, gas is kept apart as "also differed, not shown as a cause" and the gas-limit hint is held back. If nothing repeats it says so and shows the most recent. One earlier success behaves exactly as before. Counts describe what the earlier retries did, not why they worked. Synthetic example (four stored retries, three changed word 1, all four bid a higher gas price):

```
after 1 remembered retry:   - Re-encode calldata like the retry: arg word 1 = 0x6c (was 0x65)
after 2 remembered retries: - Most consistent change: calldata word 1, in 2 of 2 earlier retries that succeeded after this same error.
                            - Also differed, not shown as a cause: a higher gas price on the retry (2 of 2).
after 4 remembered retries: - Most consistent change: calldata word 1, in 3 of 4 earlier retries that succeeded after this same error.
                            - Also differed, not shown as a cause: a higher gas price on the retry (4 of 4).
```

No wallet in the current 14 memories has more than one earlier success on a contract, so the live site shows single-memory answers; the ranking is covered by `tests/ranking.test.ts`, which also runs it against the real stored memories.

**Gas gate:** a gas hint is emitted only when the failed attempt ran out of gas (error signature `out-of-gas:*`, or gas used at least 98% of the limit). Otherwise the next action starts with the revert reason, and gas price stays in the factual "Change" record. The gate is applied again at recall time (`gateGasHints`), so memories written before it existed (5 of the 12 carry a gas hint; none of the 12 failures ran out of gas) are corrected when read, without rewriting Walrus.

**Error signature:** `revert:<normalized reason>` | `panic:<code>` | `custom:<selector>` | `out-of-gas:<fn selector>` | `<fn selector>:reverted`. "Similar" means an exact match, or a token-Jaccard score of at least 0.6 between two revert strings.

**Memory format** (tags first so recall and the strict filter both work; the diff is bounded):
```
CLEW chain=<chain> contract=<addr> wallet=<addr> error=<signature> selector=<4 bytes> failed_tx=<hash> success_tx=<hash> success_block=<n>[ rev=<n>].
Contract <addr> on <chain> failed with error <signature> (<detail, max 120 chars>) for wallet <addr>. Successful retry in tx <hash> at block <n>, <k> blocks later.
Change: gas used was <s> vs <f> on failure; gas limit <s> vs <f>; gas price <s> vs <f> wei; nonce <f> -> <s>; same function <sel>; calldata <f> -> <s> bytes; <m> arg word(s) changed (at most 3 shown, each clipped).
NEXT_ACTION: reason: <detail> (used <f> of <limit> gas, not out of gas); re-encode calldata: arg word <i> = <new> (was <old>); …; template tx <hash>
```
EVM memories written before this format (all 12 on Walrus today) omit the gas price, the sizes and the reason clause. Memory #1 (`0x15f0…` → `0x389a…`) also stored six unclipped 32-byte words. Walrus memories are never rewritten: a corrected version is a new write with `rev=2` and its own idempotency key (`chain:failed:success:r2`), linked in `memories.json` by `supersedes`. Recall and the site prefer the highest revision of a pair.

## Try it (the website)

https://clew-eight.vercel.app has a **Try it** box (also at `/try`): paste a failed transaction hash (Base, Ethereum, Polygon or a Sui digest) and Clew finds the chain, reads the receipt through Tatum, and shows two columns produced by the same run:

- **Memory off:** what Clew says with an empty Walrus namespace, a generic "reverted" message, plus a one-sentence plain-English reason.
- **Memory on:** the retry that worked before (source transaction), what changed in it, the copyable next action, and the Walrus blob id. If the wallet has no memory on that contract, both columns say so.

The example buttons are real repeat failures from the Mainnet runs, with the **featured** one first: an Ethereum wallet (`0xaffa…a793`, 65 prior transactions, no automation signal) whose retry changed one calldata word, a deadline moved 60 seconds forward, not just gas. `web/scripts/build-data.mjs` picks it by rule (Base or Ethereum, no automation signal, a calldata word changed, a later failure from the same wallet). "No automation signal" is what the heuristic can say, not proof of a person. The page only reads; it never writes a memory.

- **Where the logic lives:** `src/explain.ts` (`checkFailure`) and `src/reasons.ts` (plain-English reasons and the "what changed" summary). `POST /api/check` is the only route.
- **Server settings** (Vercel project, names only): `TATUM_API_KEY`, `MEMWAL_KEY`, `MEMWAL_ACCOUNT_ID`. Without them the box falls back to the recorded run for the example buttons, labelled as recorded, and shows a plain message for any other hash. The memwal delegate key can write to its Walrus account, so give the website a dedicated delegate key.
- **Limits:** lookups are rate-limited per server instance (6 a minute) and answers are cached for 5 minutes. Best-effort on serverless, not a hard cap.
- **The vendored core:** Vercel builds `web/` with its own install, so the API can't import `../src`. `web/lib/core/` is a generated copy (`npm run sync-core` in `web/`), and `tests/core-sync.test.ts` fails if it drifts.
- **What a first-time visitor will see:** Clew's memory is scoped to the exact wallet and contract, so a wallet's first-ever failure gets the plain explanation and "no memory". It changes the answer on a repeat failure.

## Agent endpoint: `POST /v1/recall`

One call in, one JSON object out (no prose). It runs the same recall and ranking as the Try it box and adds an action, a concrete retry and a confidence for the path.

```
POST https://clew-eight.vercel.app/v1/recall
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
- **recommended:** `calldata` is the failed call's calldata with the retry's change applied (full words, read from the two transactions, not the clipped memory text); null on Sui. `gasLimit` and `gasPrice` are the failed attempt's own unless the failure ran out of gas (the gas gate above). `gasPrice` is a decimal string (wei, or MIST on Sui). `nonceStrategy` is `next`: a failed transaction is mined and spent its nonce.
- **Confidence** for a (wallet + contract + error) path: `successes / (successes + laterFailures + 1)`. `successes` are the distinct earlier retries that worked. A **later failure** is a distinct failure on the path that arrived after one of those successes: a failure already on record (it has its own retry in memory) counts when its block is later than that success; the failure you are asking about counts only when it replays a remembered change (its calldata already holds the retry's value, so the path was applied and failed). A plain next failure is the question, not evidence against the path. Everything is read from the stored memory text (failure block = success block minus "N blocks later") and the failure itself, so it works on every memory already on Walrus and stores nothing new.
- **Demotion:** any later failure sets `demotionFlag` and lowers confidence. In the ranking, a retry outrun by later failures votes with weight `1 / (1 + its later failures)`; the counts shown stay plain counts. So a new failure after a success can change which change leads (covered in `tests/agent.test.ts`). One memory is unchanged: no ranking, same advice, confidence 0.5.
- **Real data:** the Base wallet behind failure `0xd72b…4bb6` has two stored retries on the same contract and error, and that failure landed after the first retry's success: 2 successes, 1 later failure, confidence 0.5, `demotionFlag` true, action `retry`.
- **Sui hook:** `chain: "sui"` takes a transaction digest and returns the same object. Live Sui reads are off until the deployment sets `CLEW_SUI_LIVE=1` (until then: 501 `sui_disabled`, no Sui call). Code: `loadFailure` in `src/agent.ts`; a caller can also pass `loadSui` or a generic `load`. Sui `recommended.calldata` is null (Sui has Pure inputs, not calldata).
- **CLI:** `npm run recall -- base 0xd72b…` runs the same code locally (needs the three keys).

### Measurement harness

`npm run measure -- hashes.txt` (one `chain:hash` per line, `#` comments allowed; `--json` for rows) reads each failure through Tatum once and recalls twice, from an empty namespace (memory off) and from the real one (memory on), then prints a Markdown table with the action, confidence, successes, later failures, demotion flag, prior retries and most consistent change, plus a one-line summary. A row that cannot be read shows its error and the run continues. Code in `src/measure.ts`; the offline test is in `tests/agent.test.ts`. It makes live calls when run, so it is not part of `npm test`.

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
| `DEMO_PRIVATE_KEY` | optional, `npm run live-demo` only: a throwaway Base burner key (see Live demo) |

Supported chains (Tatum gateways): `ethereum`, `base`, `polygon`, `arbitrum`, `optimism`, `bsc` (JSON-RPC), and `sui` (GraphQL, verified on Mainnet; see below).

## Commands

```bash
npm test                                   # offline: mocked RPC + in-memory store (decode, error sig, diff, loop)
npm run demo                               # full Mainnet loop -> demo-output.txt (idempotent)
npm run watch -- base [--store ledger]     # live: new failures from remembered wallet+contract pairs -> recall
npm run check -- base <failedTxHash>       # step 4 for any failure: prior path + next action, or generic
                                           #   --without-memory (empty namespace), --json (raw result)
npm run record -- base <failedTx> [okTx]   # steps 1-3: watch for the retry if okTx is omitted, then write memory
                                           #   --dry-run (print the memory text, write nothing), --rev N (corrected rewrite)
npm run live-demo [-- --dry-run --address 0x..]  # Base: failure, retry, memory, next failure answered by recall (burner key)
npm run discover -- base 150 300 [--to N]  # find real fail->success candidates (scan 150 blocks ending at N, 300-block retry window); merges into fixtures/
npm run pick -- base=8 ethereum=2          # choose pairs: human-like wallets first, then real repeat failures (fixtures/pairs.json)
npm run classify                           # offline: tag each memory's wallet bot-like / human-like (fixtures/wallet-classes.json)
```

## Demo

The 2 to 3 minute video script with exact commands and expected output: [`DEMO.md`](DEMO.md). Write-up: [`BLOG.md`](BLOG.md).

1. `npm test` (about 1 s, 47 tests) shows the logic offline.
2. `npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6 --without-memory` returns only the generic "reverted" message.
3. The same command without the flag recalls the stored memory for wallet `0x336a…` on contract `0x8ea5…` and returns the earlier retry `0x389a…` with a copy-ready next action: the revert reason, then the calldata words to re-encode. No gas hint: that failure used 78% of its gas limit.
4. `memories.json` lists the 14 Walrus Mainnet writes (12 EVM, 2 Sui) (job id + blob id + text). Each blob resolves at `https://walruscan.com/mainnet/blob/<blob_id>`; the content is SEAL-encrypted, so Walruscan shows that the blob exists, not its text.

## What the demo used (all real Mainnet data, no fixtures)

- `scripts/discover.ts` scanned recent blocks with Tatum `eth_getBlockReceipts` on Base (151 blocks), Ethereum (41), and Polygon (101), looking for real `fail → later success` sequences from the same wallet to the same contract. `scripts/pick.ts` then chose 12 pairs on distinct contracts (8 Base, 2 Ethereum, 2 Polygon). That pick predates the wallet classifier; the tags were added afterwards from the same data. 9 of those wallets failed **again** later with a similar error, so step 4 runs on real repeat failures. Candidate lists and picks are in `fixtures/`.
- **14 Walrus Mainnet memories** (12 EVM, 2 Sui), all from real pairs. Each write was confirmed by `waitForRememberJob` (`blob_id` recorded in `memories.json`).
- Honest caveat: most wallets that fail and retry within minutes on-chain are bots (swap routers, MEV, relayers), so many of the "changes" are fresh quotes, deadlines, or a higher gas price. Clew reports exactly what differed. It doesn't claim to know why.

## Watcher

`npm run watch -- <chain>` turns Clew from replayed history into live catches. It polls Tatum for every new block, keeps the failed receipts whose wallet and contract already have a memory, runs recall on each, and prints the prior successful path.

```bash
npm run watch -- base                      # from the current head; Ctrl-C to stop, rerun to resume
npm run watch -- base --store ledger       # recall from memories.json: needs only TATUM_API_KEY
npm run watch -- base --from 53160000 --blocks 300 --verbose
npm run watch -- base --record fixtures/watch-recorded.json   # capture the RPC traffic for replay tests
```

- **Rate limit:** one header plus one `eth_getBlockReceipts` call per block (about 1 request per second on Base). All calls go through the 360 ms throttle, and a 429 backs off and retries.
- **Resume:** the cursor (`.clew/watch-<chain>.json`, git-ignored) is saved after every block, so a restart continues where it stopped.
- **Reorgs:** the watcher keeps the last 12 block hashes. If a new block's parent hash doesn't match, it rewinds one block and rescans. A failure that appears again on the new chain is not reported twice.
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

No live catch has been recorded yet. The watcher (EVM chains) only reports failures from the 12 remembered EVM wallet+contract pairs, so a catch needs one of those wallets to fail again while it runs.

## Live demo

`npm run live-demo` produces a fresh, guaranteed example on Base Mainnet instead of relying on someone else's history. It uses Base's canonical WETH (`0x4200000000000000000000000000000000000006`, the WETH9 predeploy), whose `withdraw(wad)` reverts when `wad` exceeds the caller's balance:

| Step | Transaction | Expected |
|---|---|---|
| setup (only if WETH balance < 1 gwei) | `deposit()` with 1 gwei of ETH | success |
| failure | `withdraw(balance + 1 gwei)` | revert |
| retry | `withdraw(1 gwei)` | success |
| memory | diff the pair, write to Walrus (`remember` + `waitForRememberJob`) | stored |
| next failure | `withdraw(balance + 2 gwei)` | revert, then recall without and with memory |

Recall should answer the second failure with "re-encode calldata: arg word 0 = 0x3b9aca00" (1 gwei) and the retry as the template tx. The run stops at the first transaction whose status isn't the expected one. Every call goes through Tatum (`eth_sendRawTransaction`, receipts, traces).

**Safe setup**
1. Create a new throwaway key used for nothing else (for example `cast wallet new`, or `node -e "console.log(require('viem/accounts').generatePrivateKey())"`). Never use a wallet that holds real funds.
2. Send it a few cents of ETH on Base. Each run sends 3 or 4 transactions of 25k to 45k gas. The script refuses to start if the maximum L2 fee for the run exceeds 0.0003 ETH, and Base adds a small L1 data fee per transaction.
3. Put the key in `.env` as `DEMO_PRIVATE_KEY` (`.env` is git-ignored). It is read from the environment, used only to sign, and never printed or logged; output shows the derived address only.

```bash
npm run live-demo -- --dry-run --address 0xYourBurner   # eth_call simulation of every step, prints what would be sent; sends nothing
npm run live-demo                                       # real run: needs DEMO_PRIVATE_KEY, TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID
```

Output format (real run):
```
LIVE DEMO base wallet <address> (key from DEMO_PRIVATE_KEY, not shown): <wei> wei ETH, <wei> wei WETH
[setup] deposit 1000000000 wei as WETH: tx <hash> status 0x1 block <n> gasUsed <n>
[failure] withdraw <wad> wei (balance <wad>): tx <hash> status 0x0 block <n> gasUsed <n>
[retry] withdraw 1000000000 wei: tx <hash> status 0x1 block <n> gasUsed <n>
[memory] STORED job=<id> blob=<id>
[next-failure] withdraw <wad> wei (balance <wad>): tx <hash> status 0x0 block <n> gasUsed <n>
  WITHOUT memory: Tx <hash> on base reverted (0x2e1a7d4d:reverted). No prior successful path on record ...
  WITH memory: prior success <retry hash> (block <n>, blob <id>)
  NEXT ACTION
    ...
```
`tests/live.test.ts` runs the same flow offline against a fake Base chain with WETH9 behaviour, signing with Anvil's public dev key, and checks that the key never appears in the output. A real run has not been made yet.

## Sui (verified on Mainnet, 2026-10-31)

`src/sui.ts` runs the same loop on Sui through Tatum's Sui gateway. Note: that gateway serves **GraphQL only** (`POST https://sui-mainnet.gateway.tatum.io/graphql`, `x-api-key`, one operation per request), not `sui_*` JSON-RPC. A first JSON-RPC version failed with HTTP 404 on a real run and was replaced.

**What was verified on Sui Mainnet (2026-10-31, project keys):**
- `npm run sui:check`: `SUI GATEWAY OK`. GraphQL reachable at checkpoint 340173364, 50 programmable transactions decoded (2 FAILURE), single-transaction query passed, and the retry search found a later SUCCESS.
- Two real memories written to Walrus Mainnet (`memories.json`):

| Failed | Retry | Error | Change | Wallet tag |
|---|---|---|---|---|
| `GXwW6feR…48Vj` | `ByGXz3iX…U6JV`, 441 checkpoints later | `moveabort:errors::err_amount_out_slippage_check_failed:1` on `0xde5d…9640::router` | gas price 3,410 → 17,038 MIST, budget 6,410,000 → 20,038,000; pure inputs identical | unclassified (no nonce on Sui; retried about 106 s later) |
| `FzUf8HxE…oDYp` | `EthYTxV1…rTtw`, 3 checkpoints later | `moveabort:order_info::assert_execution:5` on `0xcaf6…ec3a::balance_manager` | gas budget only | bot-like (retried within about a second) |

- Recall on a real later failure: `npm run sui -- recall 6mDBLQjL4Ld48683HjpZnV4xBQEZB5ymohxzxNaYxcvM` returned WITH MEMORY, prior success `ByGXz3iX…U6JV`, with the reason line "used 3411613 of 6410000 gas, not out of gas" (so no gas hint).

The slippage pair is the useful one: a slippage abort on the router, then a later success from the same sender through the same router, and recall answered a real later failure from that sender. The `balance_manager` pair is weaker: only the gas budget changed, and the wallet retried within about a second, so it is almost certainly a bot. Neither wallet is claimed to be a person. Both memories were written before the input wording was tightened: their "inputs identical" means the Pure inputs were identical; object inputs are not compared. New memories say "pure inputs identical" and how many inputs are Pure.

| EVM concept | Sui equivalent |
|---|---|
| wallet | sender |
| contract | the called `package::module` that matches the abort location (else one in the same package, else the last Move call) |
| block | checkpoint |
| calldata words | `Pure` inputs (BCS bytes, shown as hex); object inputs are not compared |
| revert reason | `executionError`: `moveabort:<module>::<function>:<abortCode>`, where module and function are where the abort happened, which can differ from the functions the transaction called |

- **Retry search:** one server-side filter, `transactions(filter: { sentAddress, function: "<package>::<module>", afterCheckpoint })`, paged with `first` and `after`. The first later `SUCCESS` that calls the same module is the retry. The `function` filter matches functions the transaction *called*, so filtering on the abort location returns nothing when that function was not a command.
- **Gas gate:** Sui reports out-of-gas as "Insufficient Gas"; it maps to `out-of-gas`, so the gate applies unchanged.
- **Memories:** the same tags, recall path (`recallFor`) and rate limit as EVM memories.

```bash
npm run sui:check [-- --record sui-run.json]      # GraphQL reachable, ~50 programmable txs decoded, a later retry from the same sender
npm run sui -- record <failedDigest> [okDigest] --dry-run
npm run sui -- recall <failedDigest> --store ledger
```

`sui:check` prints PASS or FAIL per step with the server's exact error, then `SUI GATEWAY OK` or `SUI GATEWAY NOT USABLE`. It looks at failures about 10 minutes old, so their retries can already exist. `--record` saves every request and response, so a real run can become a test fixture.

All queries validate against Sui's published GraphQL schema (`crates/sui-indexer-alt-graphql/schema.graphql`). Tests parse two real responses recorded through Tatum on 2026-10-31 (`fixtures/sui-recorded-2026-10-31.json`); command lists, sender history and the record/recall flow are synthetic and labelled. The real recall above is kept in `fixtures/sui-recall-2026-10-31.json`, and the site shows it. Checkpoint time for latency (about 0.24 s) is measured from two Suiscan timestamps.

## Wallet classifier

Most wallets that fail and retry within minutes are bots, so Clew labels each one with a transparent heuristic (`src/classify.ts`). Any one signal makes a wallet **bot-like**:

| Signal | Threshold |
|---|---|
| Lifetime nonce (transactions sent before the failure) | >= 10,000 |
| Retry latency | <= 6 s |
| Other transactions between failure and retry | >= 3 within 60 s |
| Calls to the same contract in the discovery scan window | >= 5, at >= 30 per hour |

No signal makes it **human-like**, which only means no automation signal was seen. It never means "a person": a slow, low-volume bot passes, and a power user running a script fails. Latency comes from block timestamps when the transactions are loaded live (`pick`), or from block count times average block time when only the memory text is available (`classify`, marked `~`). The repeat-call signal needs discovery data; the scan size per chain for the original candidates is in `fixtures/scans.json`.

Current tags for the 14 memories (`npm run classify`): 12 bot-like, 1 human-like, 1 unclassified (Sui `GXwW…`: Sui has no account nonce, so only retry latency can be checked, and a wallet with no signal is left unclassified rather than called human-like). The human-like one is Ethereum `0xd55c…` (`Expired`: 65 prior transactions, retried about 48 s later, 4 calls in about 8 minutes). `pick` ranks human-like wallets with a real repeat failure first, so the headline example comes from a human-like wallet when one is available.

## Limits

- Tatum free plan: 3 req/s, so calls are serialized with a 360 ms gap and retried on 429. `debug_traceTransaction` with `callTracer` worked on Base, Ethereum, and Polygon on the free plan.
- Recall is semantic. Clew always applies a strict tag filter afterwards (chain + contract + wallet + similar error), so it never borrows another wallet's path.
- Idempotency comes from the local `memories.json` ledger plus memwal `idempotencyKey` = `chain:failedTx:successTx`. Reruns don't write duplicates.
