"use client";

import { useMemo, useState } from "react";
import { DATA, CHAIN_LABEL, txUrl, blobUrl, explorerName, type Chain, type Recall } from "@/lib/data";
import { short } from "@/lib/utils";

const REPLAYS = DATA.recalls.filter((r) => r.without_memory && r.chain !== "sui");
const DEFAULT_REPLAY = REPLAYS.find((r) => {
  const memory = DATA.memories.find((m) => m.key === r.memory_key);
  return memory?.wallet_class.label === "human-like";
}) ?? REPLAYS[0];

const CHAINS: Chain[] = ["base", "ethereum", "polygon"];

export function JudgeReplay() {
  const [chain, setChain] = useState<Chain>(DEFAULT_REPLAY.chain);
  const [hash, setHash] = useState(DEFAULT_REPLAY.failure_tx);
  const [result, setResult] = useState<Recall | null>(null);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const memory = useMemo(
    () => result ? DATA.memories.find((m) => m.key === result.memory_key) : undefined,
    [result],
  );

  function replay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const normalized = hash.trim().toLowerCase();
    const found = REPLAYS.find((r) => r.chain === chain && r.failure_tx.toLowerCase() === normalized);
    setResult(found ?? null);
    setMessage(found
      ? "Matched a recorded Mainnet failure. The two answers below are from Clew's captured run."
      : "No recorded replay matches this chain and transaction hash. This demo contains 9 repeat failures with an explicit memory-off comparison; it does not perform a live RPC lookup.");
  }

  function loadExample(nextChain: Chain) {
    const found = REPLAYS.find((r) => r.chain === nextChain);
    if (!found) return;
    setChain(nextChain);
    setHash(found.failure_tx);
    setResult(null);
    setMessage("");
    setSubmitted(false);
  }

  return (
    <section id="judge-replay" aria-labelledby="judge-replay-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <div className="max-w-[44rem]">
          <p className="eyebrow">Judge replay · Mainnet evidence</p>
          <h2 id="judge-replay-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
            Put in a failure. See what memory changes.
          </h2>
          <p className="mt-4 text-body text-ink-3 text-pretty">
            Enter a transaction hash from one of Clew's recorded repeat failures. Replay the same failure with an empty memory and with the confirmed Walrus memory. Nothing is signed or broadcast.
          </p>
        </div>

        <form onSubmit={replay} className="card mt-8 grid gap-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <label className="grid gap-2 text-small text-ink-3">
              Chain
              <select
                value={chain}
                onChange={(e) => {
                  setChain(e.target.value as Chain);
                  setResult(null);
                  setMessage("");
                  setSubmitted(false);
                }}
                className="h-11 rounded-lg border border-line-strong bg-canvas px-3 font-mono text-small text-ink"
              >
                {CHAINS.map((c) => <option key={c} value={c}>{CHAIN_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-2 text-small text-ink-3">
              Failed transaction hash
              <input
                value={hash}
                onChange={(e) => {
                  setHash(e.target.value);
                  setResult(null);
                  setMessage("");
                  setSubmitted(false);
                }}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                placeholder="0x…"
                className="h-11 min-w-0 rounded-lg border border-line-strong bg-canvas px-3 font-mono text-small text-ink placeholder:text-ink-4"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="inline-flex h-10 items-center rounded-lg bg-brand-fill px-4 text-small font-[580] text-on-brand hover:bg-brand-fill-hover">
              Replay failure
            </button>
            <span className="text-label text-ink-4">Quick examples:</span>
            {CHAINS.map((c) => (
              <button key={c} type="button" onClick={() => loadExample(c)} className="rounded-lg border border-line-strong px-3 py-2 text-label text-ink-3 hover:bg-fill-hover">
                {CHAIN_LABEL[c]}
              </button>
            ))}
          </div>
          {submitted && <p role="status" className="text-small text-ink-3">{message}</p>}
        </form>

        {result && memory && (
          <div className="mt-5 grid gap-4 md:grid-cols-2" aria-live="polite">
            <article className="card min-w-0 p-5 sm:p-6">
              <p className="eyebrow">Without memory</p>
              <p className="mt-3 break-words rounded-lg border border-dashed bg-fill/50 p-3 font-mono text-[0.78rem] leading-relaxed text-ink-3">
                {result.without_memory}
              </p>
              <p className="mt-4 text-label text-ink-4">Generic failure response. No previous successful path is available.</p>
            </article>

            <article className="card min-w-0 border-brand/40 bg-brand-soft/50 p-5 sm:p-6">
              <p className="eyebrow !text-brand">With Walrus memory</p>
              <p className="mt-3 text-small text-ink-3">Prior successful retry</p>
              <a href={txUrl(result.chain, result.with_memory.prior_success)} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-small text-ink underline decoration-line-strong underline-offset-4">
                {result.with_memory.prior_success}
              </a>
              <p className="mt-4 text-label text-ink-4">Next action returned by the recorded recall</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-canvas/70 p-3 font-mono text-[0.75rem] leading-relaxed text-ink">{result.with_memory.next_action}</pre>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-label text-ink-4">
                <a href={blobUrl(result.with_memory.blob_id)} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">Walrus Mainnet blob {short(result.with_memory.blob_id, 8, 4)}</a>
                <a href={txUrl(result.chain, result.failure_tx)} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-4 hover:text-ink">{explorerName[result.chain]} failure</a>
              </div>
            </article>
            <p className="text-label text-ink-4 md:col-span-2">
              Recorded replay from {result.source}. Wallet classification: {memory.wallet_class.label}. {memory.wallet_class.reasons.join("; ")}. The result is a historical Mainnet replay, not a live RPC request.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
