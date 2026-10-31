# Clew: remembering the retry that worked

*Tatum × Walrus Total Recall hackathon. Live: https://clew-eight.vercel.app*

## The problem

A transaction reverts. The wallet tells you "execution reverted", maybe with a reason string. You tweak something, resubmit, and it goes through. A week later the same wallet hits the same contract with the same error, and you start from zero again, because nothing kept track of what actually fixed it last time.

## What Clew does

Clew handles one loop: **failure → successful retry → next failure**.

1. **A transaction fails.** Clew reads the receipt and decodes the revert.
2. **The same wallet retries the same contract and succeeds.** Clew diffs the two attempts (calldata words, function selector, value, gas limit, gas price, nonce) and writes what changed to Walrus Memory.
3. **The next time that wallet fails on that contract with a similar error**, Clew recalls the memory and returns the prior successful transaction plus a concrete next action. With no memory, it can only say "reverted".

## How Tatum is used

All chain reads go through Tatum gateways: JSON-RPC for Base, Ethereum and Polygon, and GraphQL for Sui (details below).

- `eth_getTransactionReceipt` gives the status: `0x0` is a failure, `0x1` a success. Clew only treats `0x0` as a failure and only accepts a `0x1` tx as the retry.
- `eth_getTransactionByHash` gives calldata, gas limit, value and nonce. `eth_getBlockByNumber` gives the timestamp.
- **Revert decoding:** `debug_traceTransaction` with `callTracer`, falling back to an `eth_call` replay at `block - 1`. Clew decodes `Error(string)` (`0x08c379a0`), `Panic(uint256)` (`0x4e487b71`) and custom error selectors, then normalizes them into an error signature such as `revert:too_little_received`.
- `eth_getBlockReceipts` finds the successful retry from the same wallet to the same contract after the failure.

**Sui.** Tatum's Sui gateway serves GraphQL, not JSON-RPC (`POST https://sui-mainnet.gateway.tatum.io/graphql`; our first JSON-RPC attempt got HTTP 404). One query returns everything Clew needs per transaction: the sender, gas budget and price, the status, the checkpoint, the Move calls, the inputs, and `executionError`, which names the module, function and abort code where the transaction aborted. That becomes the error signature, for example `moveabort:errors::err_amount_out_slippage_check_failed:1`. The retry is found with one filtered query: same sender, same `package::module`, after the failure's checkpoint.

## How Walrus Memory is used

Memories go to the Walrus Memory **Mainnet** relayer (`https://relayer.memory.walrus.xyz`) in namespace `clew`, through `@mysten-incubation/memwal`:

- **Write:** `memwal.remember(text, { idempotencyKey: "chain:failedTx:successTx" })`, then `waitForRememberJob(job_id)` until the job returns a `blob_id`. Nothing counts as stored until that confirmation.
- **Read:** `memwal.recall(query)` with a query built from the new failure's chain, contract, wallet, error and selector. Recall is semantic, so Clew then applies a strict filter: exact chain + contract + wallet, and a similar error signature. It never borrows another wallet's path.

The memory text is plain and factual, tags first:

```
CLEW chain=base contract=0x8ea5… wallet=0x336a… error=revert:too_little_received selector=0x708909ad
failed_tx=0x15f0… success_tx=0x389a… success_block=53152834. … Change: … NEXT_ACTION: …
```

There are **14 real Mainnet memories** in namespace `clew`, from 14 real fail → success pairs on 14 distinct contracts (8 Base, 2 Ethereum, 2 Polygon, 2 Sui). Job and blob ids are in `memories.json`. Each blob resolves on Walruscan Mainnet, but its content is SEAL-encrypted, so the explorer proves the write happened without exposing the memory text.

## How the memory changed the outcome

A real Base failure: tx `0xd72b…4bb6` from wallet `0x336a…811d` to contract `0x8ea5…ac50`, reverted with **"Too little received"**.

**Without memory** (empty namespace), Clew returns:

> Tx 0xd72b…4bb6 on base reverted (revert:too_little_received). No prior successful path on record for this wallet+contract. Check params and retry.

**With memory**, recall finds the earlier pair from the same wallet (failed `0x15f0…c153`, succeeded 6 blocks later in `0x389a…0d03`) and returns:

```
Prior successful retry (template): 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03
- Failure reason: Too little received (not out of gas).
- Re-encode calldata like the retry:
    arg word 4 = 0x40345a5d65e9884189 (was 0x4034297ede533478d4)
    arg word 15 = 0x6ae07583… (was 0x6ae07577…)
    arg word 16 = 0x5a772e…40345a5d65 (was 0x5a772e…4034297ede)
    +1 more word differs; copy it from the template tx
```

The first answer gives you nothing to act on. The second gives you a known-good transaction to copy and the exact calldata words that differed. On the site, the same block has a **Copy suggestion** button that puts the full values on the clipboard.

## How it learned over time

Clew's memory grows one confirmed pair at a time, and each pair changes what it says next.

1. **First pass.** Discovery scanned recent Base, Ethereum and Polygon blocks through Tatum and found real wallets that failed and then succeeded on the same contract. Twelve of those pairs became Walrus Mainnet memories, each confirmed by `waitForRememberJob`.
2. **Repeat failures.** Nine of those twelve wallets failed again later with a similar error. Recall has been run on Mainnet for three of them so far (all on Base), and for each the answer changed from "reverted" to the path that worked, as in the Base example above. The demo script now recalls all nine on its next run.
3. **Correcting itself without rewriting history.** Reviewing the stored memories showed two weaknesses. Some memories gave a gas hint when the failure had not run out of gas, and one stored six full 32-byte calldata words. Walrus memories are never edited. Instead, recall now applies a gas gate when it reads a memory, and a corrected memory is written as a new revision that supersedes the old one in the ledger.
4. **Knowing who it learned from.** A wallet classifier now tags every memory bot-like, human-like or (on Sui, which has no account nonce) unclassified, so the examples Clew leads with are the ones a person is most likely to recognise.
5. **A second kind of chain.** On Sui, Clew read a slippage abort (`err_amount_out_slippage_check_failed`) on a DEX router through Tatum's GraphQL gateway, found the same sender's later success through the same router 441 checkpoints on, and wrote it to Walrus. When that sender failed again (`6mDBLQjL…xcvM`), recall returned the earlier success as the template and the failure reason ("used 3411613 of 6410000 gas, not out of gas"), so no gas hint, even though the retry had raised the gas price about fivefold. A second Sui memory is weaker: only the gas budget changed and the wallet retried within about a second, so it is almost certainly a bot.
6. **Next: learning live.** A watcher (`npm run watch`) follows new blocks and answers fresh failures from remembered wallets as they happen. A scripted live demo on Base creates a fresh failure, retry, memory and recall on demand. Both are built and tested offline; neither has been run against Mainnet yet.

## Honest caveat

Most wallets that fail and then succeed on the same contract within minutes are bots: routers, MEV searchers, relayers. Clew now says so per wallet. A small, documented heuristic tags each one bot-like or human-like from public behaviour: lifetime nonce, how fast the retry landed, other transactions in between, and how often the wallet hit the same contract. Of the 14 stored memories, 12 are bot-like (nonces up to 2.8 million, retries within seconds, up to 55 calls to one contract in about 5 minutes). One, on Ethereum, shows no automation signal. One, on Sui, is unclassified: Sui has no account nonce, so only retry latency can be checked, and that is not enough to rule automation out. "Human-like" only means no signal was seen, never that a person is confirmed. So in the real data the change is often just a fresh quote, a new deadline, or a higher gas price, not a clever human fix. Clew doesn't claim to know *why* the retry worked. It reports exactly what differed, and it only gives a gas hint when the failed attempt actually ran out of gas. None of the 14 stored failures did (the highest used 78% of its limit), so for all of them Clew shows the revert reason instead, even where the retry happened to raise the gas limit or bid a higher price. It always hands back the prior successful transaction as a template. That part is useful whether the fix was a new quote or a new bid.

## Try it

See [`DEMO.md`](DEMO.md) for the 2 to 3 minute demo script. Core is TypeScript in `src/`, with offline tests (`npm test`).
