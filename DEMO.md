# Clew: two-minute demo

All data is real Mainnet. No discovery scan is needed; the 12 memories are already on Walrus.

## Setup (once)

```bash
npm install
cp .env.example .env        # fill in TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID
set -a; . ./.env; set +a
```

## 1. Offline logic check (~1 s, no keys)

```bash
npm test
```

Expected: `# pass 5`, `# fail 0`. Covers revert decoding, error signatures, the diff, the recall loop with an in-memory store, and parsing the real stored Base memory into a next action.

## 2. The failure, without memory (a few seconds)

```bash
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6 --without-memory
```

Reads the failure through Tatum, then recalls from an empty namespace. Expected:

```
FAILURE  base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
         wallet 0x336a079d7b894f6b6356674b3ad668bffdd5811d -> contract 0x8ea5ad2a58c1dae75394b1e8636e6518eb6dac50, status 0x0, block …
         error revert:too_little_received (Too little received)

WITHOUT MEMORY
  Tx 0xd72b…4bb6 on base reverted (revert:too_little_received). No prior successful path on record for this wallet+contract. Check params and retry.
```

## 3. The same failure, with memory (a few seconds)

```bash
npm run check -- base 0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6
```

Reads the failure through Tatum, recalls from Walrus namespace `clew`, and applies the strict wallet + contract + error filter. Expected (after the same FAILURE header):

```
WITH MEMORY  (Walrus blob B57Lqac7DaDkXiXwNGHJML0S5Fo1EGOm9CMHmcOJOQc)
  prior failure 0x15f0e33c6bcaae91577346de3efac3680848b1158407ee77dbc6d743361ac153
  prior success 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03 (block 53152834)

NEXT ACTION
  Prior successful retry (template): 0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03
  - Re-encode calldata like the retry:
      arg word 4 = 0x40345a5d65e9884189 (was 0x4034297ede533478d4)
      arg word 15 = 0x6ae0758300000000000000000000000000000000000000000000000000000000 (was 0x6ae0757700000000000000000000000000000000000000000000000000000000)
      arg word 16 = 0x5a772e0000000000000000000000000000000000000000000000040345a5d65 (was 0x5a772e000000000000000000000000000000000000000000000004034297ede)
      +1 more word differs; copy it from the template tx
  - Gas price: the retry bid 9532143 wei (failed at 5916993). Consider bidding >= 9532143 wei.
    Gas differed between the attempts; that does not prove it caused the revert.
```

Add `--json` to either command for the raw result (includes the structured `nextAction`).

## 4. Site and on-chain proof (30 s)

- https://clew-eight.vercel.app/#same-failure shows the same two answers side by side, with a **Copy suggestion** button.
- Basescan: failure [`0xd72b…4bb6`](https://basescan.org/tx/0xd72b632220fb7e79d8fb671a0109b791a12c6ccc3f9604b52507f6a994864bb6), prior success [`0x389a…0d03`](https://basescan.org/tx/0x389a50464dd391c3d851a5b4977e00cac3367cc1a55605e8d6d413bf1a150d03).
- Walrus: blob [`B57Lqac7…JOQc`](https://walruscan.com/mainnet/blob/B57Lqac7DaDkXiXwNGHJML0S5Fo1EGOm9CMHmcOJOQc). All 12 job and blob ids are in `memories.json`.

## Talking points

- Tatum: `eth_getTransactionReceipt` status `0x0`/`0x1`; `debug_traceTransaction` revert decoding (`Error(string)`, `Panic`, custom selectors).
- Walrus: `memwal.remember` + `waitForRememberJob` on the Mainnet relayer, namespace `clew`; `memwal.recall` + strict tag filter.
- Honest caveat: most real fail/retry pairs are bots, so the change is often a fresh quote or a higher gas bid. Clew reports what differed and returns the prior successful tx; it does not claim causality.
