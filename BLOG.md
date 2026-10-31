# Clew: remembering the retry that worked

*Built for the Tatum x Walrus Memory "Total Recall" hackathon. Live: https://clew-eight.vercel.app. Code: https://github.com/levithefirst/clew*

## The problem

A transaction fails. Your wallet tells you "execution reverted", maybe with a short reason like "Expired". You change something, send it again, and it goes through. A week later the same wallet hits the same contract with the same error, and you start from zero, because nothing kept track of what actually worked last time.

Clew is a small memory for exactly that moment.

## What Clew does

Clew handles one loop: **failure, then a successful retry, then the next failure**.

1. **A transaction fails.** Clew reads the receipt and decodes the revert reason.
2. **The same wallet retries the same contract and succeeds.** Clew compares the two attempts (calldata words, function, value, gas limit, gas price, nonce) and writes what changed to Walrus Memory on Mainnet.
3. **The next time that wallet fails on that contract with a similar error**, Clew recalls the memory and hands back the earlier successful transaction plus a concrete next action. With no memory, all it can say is "reverted".

## The headline example: one value, one minute

This is a real Ethereum wallet. It failed a swap with **"Expired"** (`0x5004…2ade`).

**Without memory**, Clew can only say:

> Tx 0x5004…2ade on ethereum reverted (revert:expired). No prior successful path on record for this wallet+contract. Check params and retry.

**With memory**, Clew finds that the same wallet had failed on the same contract once before (`0xd55c…8a20`) and that its retry four blocks later worked (`0x5393…7565`). It returns:

```
Prior successful retry (template): 0x539321141eb96164edb752ec9217abfe86352a85cba891e3cde7998858dd7565
- Failure reason: Expired (used 33681 of 500000 gas, not out of gas).
- Re-encode calldata like the retry:
    arg word 2 = 0x6ae074ee (was 0x6ae074b2)
```

One value changed between the failure and the success. Read as a Unix timestamp, it moved forward by exactly 60 seconds, which fits an "Expired" error. Clew does not claim to know that; it only reports what was different and gives you a transaction you know worked. On the site, the same answer has a **Copy suggestion** button.

This is also the one wallet in the set that shows no sign of automation: 65 earlier transactions, and a retry about 48 seconds after the failure. More on that below.

## How Tatum is used

Every chain read goes through Tatum gateways: JSON-RPC for Base, Ethereum and Polygon, and GraphQL for Sui.

- `eth_getTransactionReceipt` gives the status: `0x0` is a failure, `0x1` a success. Clew only treats `0x0` as a failure and only accepts a `0x1` transaction as the retry.
- `eth_getTransactionByHash` gives calldata, gas limit, value and nonce. `eth_getBlockByNumber` gives the timestamp.
- **Revert decoding:** `debug_traceTransaction` with `callTracer`, falling back to an `eth_call` replay one block earlier. Clew decodes `Error(string)`, `Panic(uint256)` and custom error selectors, then turns them into an error signature such as `revert:expired`.
- `eth_getBlockReceipts` finds the successful retry from the same wallet to the same contract after the failure.

**Sui.** Tatum's Sui gateway serves GraphQL, not JSON-RPC. We learned that the hard way: our first JSON-RPC version got HTTP 404 on a real run, so we rebuilt the adapter on `POST https://sui-mainnet.gateway.tatum.io/graphql`. One query returns everything Clew needs per transaction: sender, gas budget and price, status, checkpoint, the Move calls, the inputs, and `executionError`, which names the module, function and abort code. That becomes the error signature, for example `moveabort:errors::err_amount_out_slippage_check_failed:1`. The retry is found with one filtered query: same sender, same `package::module`, after the failure's checkpoint. `npm run sui:check` passed on Mainnet on 2026-10-31.

## How Walrus Memory is used

Memories go to the Walrus Memory **Mainnet** relayer (`https://relayer.memory.walrus.xyz`) in namespace `clew`, through `@mysten-incubation/memwal`:

- **Write:** `memwal.remember(text, { idempotencyKey })`, then `waitForRememberJob(job_id)` until the job returns a `blob_id`. Nothing counts as stored until that confirmation.
- **Read:** `memwal.recall(query)` with a query built from the new failure's chain, contract, wallet, error and function. Recall is semantic, so Clew then applies a strict filter: exact chain, contract and wallet, plus a similar error. It never borrows another wallet's path. When a different wallet fails on a remembered contract, Clew stays with the generic answer.
- **No rewriting:** a stored memory is never edited. A correction is a new memory with `rev=2` that points to the one it replaces, and recall prefers the newest revision.

The memory text is plain and factual, tags first:

```
CLEW chain=ethereum contract=0xdbeb… wallet=0xaffa… error=revert:expired selector=0x3593564c
failed_tx=0xd55c… success_tx=0x5393… success_block=26283279. … Change: … NEXT_ACTION: …
```

Today there are **14 real Mainnet memories** in namespace `clew`, from 14 real fail and success pairs on 14 different contracts: 8 on Base, 2 on Ethereum, 2 on Polygon and 2 on Sui. One of them also has a corrected second version, so there are 15 Walrus writes in total. Every job id and blob id is in `memories.json`. Each blob opens on Walruscan Mainnet, but its content is encrypted, so the explorer proves the write happened without showing the memory text.

## A second example: Base

A Base swap failed with **"Too little received"** (`0xd72b…4bb6`). Without memory: reverted, check params. With memory, Clew returns the same wallet's earlier failure (`0x15f0…c153`), the retry that worked six blocks later (`0x389a…0d03`), the revert reason ("used 192148 of 246588 gas, not out of gas") and the calldata words to re-encode:

```
- Re-encode calldata like the retry:
    arg word 4 = 0x40345a5d65e9884189 (was 0x4034297ede533478d4)
    arg word 15 = 0x6ae0758300…000000 (was 0x6ae0757700…000000)
    arg word 16 = 0x5a772e0000…5a5d65 (was 0x5a772e0000…297ede)
    +1 more word differs; copy it from the template tx
```

This wallet is a bot (more than 58,000 earlier transactions), and this memory is the one Clew corrected. More on both below.

## How it learned over time

Clew's memory grows one confirmed pair at a time, and each pair changes what it says next.

1. **First pass.** Discovery scanned recent Base, Ethereum and Polygon blocks through Tatum and found real wallets that failed and then succeeded on the same contract. Twelve of those pairs became Walrus Mainnet memories, each confirmed by `waitForRememberJob`.
2. **Repeat failures.** Nine of those twelve wallets later failed again with a similar error. Recall answered all nine on Mainnet: six on Base, two on Ethereum, one on Polygon. Each answer changed from "reverted" to the path that worked. The other three wallets have not failed again yet.
3. **A second kind of chain.** On Sui, Clew read a slippage abort on a DEX router through Tatum's GraphQL gateway, found the same sender's success through the same router 441 checkpoints later, and wrote it to Walrus. When that sender failed again (`6mDBLQjL…xcvM`), recall returned the earlier success as the template, with the reason line "used 3411613 of 6410000 gas, not out of gas", so no gas hint, even though the retry had raised the gas price about fivefold. That makes **10 repeat failures answered from memory** across four chains. A second Sui memory is weaker: only the gas budget changed and the wallet retried within about a second, so it is almost certainly a bot.
4. **Correcting itself without rewriting history.** Reviewing the stored memories showed two weaknesses. Some told you to bid a higher gas price or raise the gas limit when the failure had not run out of gas, and the Base memory above stored six full 32-byte calldata words. Clew now gives a gas hint only when the failure really ran out of gas, and applies that rule again when it reads an old memory. The Base memory was then corrected properly: a new `rev=2` memory on Walrus that drops the gas price advice, clips the long words, and states the revert reason. The original stays on Walrus untouched; recall now answers with the corrected one.
5. **Knowing who it learned from.** A wallet classifier tags every memory bot-like, human-like or unclassified, so the example Clew leads with is the one a person is most likely to recognise.

## The honest part

Most wallets that fail and then succeed on the same contract within minutes are bots: routers, MEV searchers, relayers. Clew says so for each wallet, with the numbers behind the label: lifetime nonce, how fast the retry landed, other transactions in between, and how often the wallet hit the same contract.

Of the 14 memories, **12 are bot-like** (nonces up to 2.8 million, retries within seconds, up to 55 calls to one contract in about 5 minutes). **One, on Ethereum, is human-like**: the headline wallet above. **One, on Sui, is unclassified**: Sui has no account nonce, so only retry speed can be checked, and that is not enough to rule automation out. "Human-like" only means no automation signal was seen. It never means a person is confirmed.

So in this data, the change is often just a fresh quote, a new deadline, or a higher gas price, not a clever human fix. Clew does not claim to know *why* a retry worked. It reports exactly what differed, it gives a gas hint only when the failure actually ran out of gas (none of the 14 did; the highest used 78% of its limit), and it always hands back the earlier successful transaction as a template. That part is useful whether the fix was a new quote or a new bid.

What is not done yet, said plainly:

- **Live catches.** A watcher (`npm run watch`) follows new blocks and answers fresh failures from remembered wallets as they happen. It is built and tested on recorded data, but it has not caught a live failure on Mainnet yet. Every failure above had already happened when Clew answered it.
- **A scripted live demo.** A script that creates a fresh failure, retry, memory and recall on Base with a throwaway wallet is built and tested offline, but has not been run on Mainnet.

## Try it

- Site: https://clew-eight.vercel.app
- Code: https://github.com/levithefirst/clew. The core is TypeScript in `src/`, with 31 offline tests (`npm test`, under a second, no keys needed).
- `npm run check -- ethereum 0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade` reproduces the headline answer with a Tatum key and Walrus Memory credentials. Add `--without-memory` to see the answer Clew gives with an empty memory.
