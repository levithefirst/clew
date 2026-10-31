# Clew: demo video script (2 to 3 minutes)

The hackathon asks for a 2 to 3 minute video. This is the order, the commands and what each one prints. Everything shown is real Mainnet data. Segments marked **after the first real run** depend on output that does not exist yet: record them only once the command has actually been run, and paste its real output here.

## Setup (once, off camera)

```bash
npm install
cp .env.example .env        # TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID (+ DEMO_PRIVATE_KEY for the live segment)
set -a; . ./.env; set +a
```

## 0:00 to 0:15 The problem (site)

Open https://clew-eight.vercel.app. One line: "A transaction reverts. Next time the same wallet hits the same contract, Clew hands back the retry that worked instead of 'reverted'."

## 0:15 to 0:30 The logic, offline (about 1 s, no keys)

```bash
npm test
```

Expected: `# pass 31`, `# fail 0`. The suite covers revert decoding, the gas gate, the bounded memory format, the wallet classifier, the watcher (reorg + resume on a fixture stream), the live demo against a fake Base chain, and the Sui adapter (real responses recorded on 2026-10-31 plus labelled synthetic history).

## 0:30 to 1:05 The same failure, without and with memory (a few seconds each)

```bash
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6 --without-memory
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
```

Without memory (empty namespace):

```
FAILURE  base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
         wallet 0x336a079d7b894f6b6356674b3ad668bffdd5811d -> contract 0x8ea5ad2a58c1dae75394b1e8636e6518eb6dac50, status 0x0, block …
         error revert:too_little_received (Too little received)

WITHOUT MEMORY
  Tx 0xd72b…4bb6 on base reverted (revert:too_little_received). No prior successful path on record for this wallet+contract. Check params and retry.
```

With memory (Tatum read, Walrus recall in namespace `clew`, strict wallet + contract + error filter):

```
WITH MEMORY  (Walrus blob B57Lqac7DaDkXiXwNGHJML0S5Fo1EGOm9CMHmcOJOQc)
  prior failure 0x15f0e33c6bcaae91577346de3efac3680848b1158407ee77dbc6d743361ac153
  prior success 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03 (block 53152834)

NEXT ACTION
  Prior successful retry (template): 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03
  - Failure reason: Too little received (used <gasUsed> of <gasLimit> gas, not out of gas).
  - Re-encode calldata like the retry:
      arg word 4 = 0x40345a5d65e9884189 (was 0x4034297ede533478d4)
      arg word 15 = 0x6ae0758300000000000000000000000000000000000000000000000000000000 (was 0x6ae0757700000000000000000000000000000000000000000000000000000000)
      arg word 16 = 0x5a772e0000000000000000000000000000000000000000000000040345a5d65 (was 0x5a772e000000000000000000000000000000000000000000000004034297ede)
      +1 more word differs; copy it from the template tx
```

`<gasUsed>` and `<gasLimit>` are read live from the new failure `0xd72b…4bb6`: fill them in from the first real run. Say on camera: the retry also bid a higher gas price, but this failure did not run out of gas, so Clew shows the revert reason, not a gas hint.

## 1:05 to 1:25 Proof (site, explorers, Walrus)

- https://clew-eight.vercel.app/#same-failure: the same two answers side by side. Click **Copy suggestion**.
- Basescan: failure [`0xd72b…4bb6`](https://basescan.org/tx/0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6), prior success [`0x389a…0d03`](https://basescan.org/tx/0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03).
- Walrus: blob [`B57Lqac7…JOQc`](https://walruscan.com/mainnet/blob/B57Lqac7DaDkXiXwNGHJML0S5Fo1EGOm9CMHmcOJOQc) on Walruscan Mainnet. The page proves the blob exists; its content is SEAL-encrypted, so the explorer cannot show the memory text. The readable text and all 12 job and blob ids are in `memories.json`.

## 1:25 to 1:45 Honesty: who is retrying? (offline, instant)

```bash
npm run classify
```

Real output (last three lines shown):

```
sui      FzUf8HxE3yeT bot-like   retried ~1s after failing
sui      GXwW6feRx386 unclassified no account nonce on sui, so only retry latency was checked: retried ~106s after failing
14 memories: 1 human-like, 12 bot-like, 1 unclassified
```

Say: most real fail-and-retry wallets are bots, and Clew labels each one with the numbers behind the label. The one human-like wallet is on Ethereum (65 prior transactions, retried about 48 s later). Sui has no account nonce, so a Sui wallet with no signal stays unclassified. "Human-like" means no automation signal, never a confirmed person.

## 1:45 to 2:30 A fresh failure, answered on another chain

**Sui (real, run on 2026-10-31).** A later slippage abort from a Sui sender whose earlier fail and retry are in memory:

```bash
npm run sui -- recall 6mDBLQjL4Ld48683HjpZnV4xBQEZB5ymohxzxNaYxcvM
```

Reported result: `WITH MEMORY`, prior success `ByGXz3iXES3NHEAbXzZmfNuKmHZVQkuak9mGGag4U6JV` (Walrus blob `qNi52wSg…7eUs`), with the reason line "used 3411613 of 6410000 gas, not out of gas". Paste the full terminal output here when recording. Say: Tatum serves Sui through GraphQL, not JSON-RPC; same loop, same Walrus memory, same recall. That wallet is not classified as human: Sui has no nonce to check.

Or, once it has real output, one of these (after the first real run):

1. **Live demo** on Base with a burner wallet (about 1 minute, cents of gas):
   ```bash
   npm run live-demo
   ```
   Shows the deliberate failure, the corrected retry, the Walrus write, then a second failure answered by recall ("re-encode calldata: arg word 0 = 0x3b9aca00"). Paste the real output here after the run.
2. **Human-like recall** on Ethereum, the repeat failure of the `0xd55c…` pair (seconds):
   ```bash
   npm run check -- ethereum 0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade
   ```
   Paste the real output here after the run.

## 2:30 to 2:45 Close

"Tatum reads every receipt and revert. Walrus Memory keeps what worked. The next failure starts from the path that worked last time." Show the repo.

## Talking points

- Tatum: `eth_getTransactionReceipt` status `0x0`/`0x1`, `debug_traceTransaction` revert decoding (`Error(string)`, `Panic`, custom selectors), `eth_getBlockReceipts` for retries and the watcher.
- Walrus: `memwal.remember` + `waitForRememberJob` on the Mainnet relayer, namespace `clew`; `memwal.recall` plus a strict tag filter. Memories are never rewritten: corrections are new revisions.
- Sui: Tatum's Sui gateway is GraphQL (`/graphql`), not JSON-RPC. `npm run sui:check` passed on Mainnet; two Sui memories are on Walrus; one real recall passed.
- Gas gate: gas hints appear only for out-of-gas failures. None of the 14 stored failures ran out of gas.
- Not shown, because not verified yet: the watcher's live catches and the Base live demo. See the README for their status.
