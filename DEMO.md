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

Expected: `# pass 47`, `# fail 0`. The suite covers revert decoding, the gas gate, the bounded memory format, the wallet classifier, the watcher (reorg + resume on a fixture stream), the live demo against a fake Base chain, and the Sui adapter (real responses recorded on 2026-10-31 plus labelled synthetic history).

## 0:30 to 1:05 The featured failure, without and with memory (a few seconds each)

The featured example is the one non-bot pair: Ethereum wallet `0xaffa7d95ea5984a18e1b4d6f38c1175bdb18a793`, 65 prior transactions, no automation signal. Its first failure `0xd55c…8a20` (`Expired`) was fixed by `0x5393…7565` four blocks later, and the only thing that changed was one calldata word, a deadline moved 60 seconds forward. It then failed the same way again (`0x5004…2ade`).

```bash
npm run check -- ethereum 0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade --without-memory
npm run check -- ethereum 0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade
```

Without memory (empty namespace), as printed by the real run (`npm run demo`, 2026-11-05):

```
Tx 0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade on ethereum reverted (revert:expired). No prior successful path on record for this wallet+contract. Check params and retry.
```

With memory (Tatum read, Walrus recall in namespace `clew`, strict wallet + contract + error filter), same run:

```
prior success 0x539321141eb96164edb752ec9217abfe86352a85cba891e3cde7998858dd7565 (block 26283279, blob 7YJ-W7r8MebwQr51bJB_g2p7TUJNNSzPXJhjIThjKG4)
change: gas used was 172053 vs 33669 on failure; gas limit 500000 vs 500000; nonce 65 -> 66; same function 0x3593564c; calldata 1 arg word(s) changed (arg 2 0x6ae074b2 -> 0x6ae074ee)
| Prior successful retry (template): 0x539321141eb96164edb752ec9217abfe86352a85cba891e3cde7998858dd7565
| - Failure reason: Expired (used 33681 of 500000 gas, not out of gas).
| - Re-encode calldata like the retry:
|     arg word 2 = 0x6ae074ee (was 0x6ae074b2)
```

Say on camera: no gas hint, because the failure used 7% of its gas limit; only the deadline word changed. `npm run check` prints the same facts under its own headings; run it once before recording and paste its output here.

## 1:05 to 1:25 Proof (site, explorers, Walrus)

- https://clew-eight.vercel.app/try: the featured failure is the first button; click it for the two columns side by side, then **Copy suggestion**.
- Etherscan: failure [`0xd55c…8a20`](https://etherscan.io/tx/0xd55c0f54b9b10b56cf83ec4c919224adca39c5ffd825486129f95c4f850b8a20), the retry that worked [`0x5393…7565`](https://etherscan.io/tx/0x539321141eb96164edb752ec9217abfe86352a85cba891e3cde7998858dd7565), the later failure [`0x5004…2ade`](https://etherscan.io/tx/0x5004b20f2851805165a8f7b8ffab993185820680e3a5278f26acc0c9a0a22ade).
- Walrus: blob [`7YJ-W7r8…jKG4`](https://walruscan.com/mainnet/blob/7YJ-W7r8MebwQr51bJB_g2p7TUJNNSzPXJhjIThjKG4) on Walruscan Mainnet. The page proves the blob exists; its content is SEAL-encrypted, so the explorer cannot show the memory text. The readable text and all job and blob ids are in `memories.json`.
- The Base bot example is still there for contrast: `0xd72b…4bb6` returns `0x389a…0d03` (blob `B57Lqac7…`), from a wallet with 58,508 prior transactions.

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

Not run yet, so not shown: `npm run live-demo` (a Base burner wallet). Add it to this segment only after it has produced real output.

## 2:30 to 2:45 Close

"Tatum reads every receipt and revert. Walrus Memory keeps what worked. The next failure starts from the path that worked last time." Show the repo.

## Talking points

- Tatum: `eth_getTransactionReceipt` status `0x0`/`0x1`, `debug_traceTransaction` revert decoding (`Error(string)`, `Panic`, custom selectors), `eth_getBlockReceipts` for retries and the watcher.
- Walrus: `memwal.remember` + `waitForRememberJob` on the Mainnet relayer, namespace `clew`; `memwal.recall` plus a strict tag filter. Memories are never rewritten: corrections are new revisions.
- Sui: Tatum's Sui gateway is GraphQL (`/graphql`), not JSON-RPC. `npm run sui:check` passed on Mainnet; two Sui memories are on Walrus; one real recall passed.
- Gas gate: gas hints appear only for out-of-gas failures. None of the 14 stored failures ran out of gas.
- Not shown, because not verified yet: the watcher's live catches and the Base live demo. See the README for their status.
