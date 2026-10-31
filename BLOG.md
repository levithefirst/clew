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

All chain reads go through Tatum RPC gateways (Base, Ethereum, Polygon in the demo).

- `eth_getTransactionReceipt` gives the status: `0x0` is a failure, `0x1` a success. Clew only treats `0x0` as a failure and only accepts a `0x1` tx as the retry.
- `eth_getTransactionByHash` gives calldata, gas limit, value and nonce. `eth_getBlockByNumber` gives the timestamp.
- **Revert decoding:** `debug_traceTransaction` with `callTracer`, falling back to an `eth_call` replay at `block - 1`. Clew decodes `Error(string)` (`0x08c379a0`), `Panic(uint256)` (`0x4e487b71`) and custom error selectors, then normalizes them into an error signature such as `revert:too_little_received`.
- `eth_getBlockReceipts` finds the successful retry from the same wallet to the same contract after the failure.

## How Walrus Memory is used

Memories go to the Walrus Memory **Mainnet** relayer (`https://relayer.memory.walrus.xyz`) in namespace `clew`, through `@mysten-incubation/memwal`:

- **Write:** `memwal.remember(text, { idempotencyKey: "chain:failedTx:successTx" })`, then `waitForRememberJob(job_id)` until the job returns a `blob_id`. Nothing counts as stored until that confirmation.
- **Read:** `memwal.recall(query)` with a query built from the new failure's chain, contract, wallet, error and selector. Recall is semantic, so Clew then applies a strict filter: exact chain + contract + wallet, and a similar error signature. It never borrows another wallet's path.

The memory text is plain and factual, tags first:

```
CLEW chain=base contract=0x8ea5… wallet=0x336a… error=revert:too_little_received selector=0x708909ad
failed_tx=0x15f0… success_tx=0x389a… success_block=53152834. … Change: … NEXT_ACTION: …
```

There are **12 real Mainnet memories** in namespace `clew`, from 12 real fail → success pairs on 12 distinct contracts (8 Base, 2 Ethereum, 2 Polygon). Job and blob ids are in `memories.json`.

## How the memory changed the outcome

A real Base failure: tx `0xd72b…4bb6` from wallet `0x336a…811d` to contract `0x8ea5…ac50`, reverted with **"Too little received"**.

**Without memory** (empty namespace), Clew returns:

> Tx 0xd72b…4bb6 on base reverted (revert:too_little_received). No prior successful path on record for this wallet+contract. Check params and retry.

**With memory**, recall finds the earlier pair from the same wallet (failed `0x15f0…c153`, succeeded 6 blocks later in `0x389a…0d03`) and returns:

```
Prior successful retry (template): 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03
- Re-encode calldata like the retry:
    arg word 4 = 0x40345a5d65e9884189 (was 0x4034297ede533478d4)
    arg word 15 = 0x6ae07583… (was 0x6ae07577…)
    arg word 16 = 0x5a772e…40345a5d65 (was 0x5a772e…4034297ede)
    +1 more word differs; copy it from the template tx
- Gas price: the retry bid 9532143 wei (failed at 5916993). Consider bidding >= 9532143 wei.
  Gas differed between the attempts; that does not prove it caused the revert.
```

The first answer gives you nothing to act on. The second gives you a known-good transaction to copy and the exact calldata words that differed. On the site, the same block has a **Copy suggestion** button that puts the full values on the clipboard.

## Honest caveat

Most wallets that fail and then succeed on the same contract within minutes are bots: routers, MEV searchers, relayers. So in the real data the change is often just a fresh quote, a new deadline, or a higher gas price, not a clever human fix. Clew doesn't claim to know *why* the retry worked. It reports exactly what differed, labels gas as "what the retry did" rather than the cause, and always hands back the prior successful transaction as a template. That part is useful whether the fix was a new quote or a new bid.

## Try it

See [`DEMO.md`](DEMO.md) for the two-minute walkthrough. Core is TypeScript in `src/`, with offline tests (`npm test`).
