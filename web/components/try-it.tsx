"use client";
import { useRef, useState } from "react";
import { Reveal } from "@/components/reveal";
import { Hash } from "@/components/hash";
import { NextAction } from "@/components/next-action";
import { DATA, CHAIN_LABEL, txUrl, addrUrl, blobUrl, explorerName, nextActionOf, blockWord, type Chain } from "@/lib/data";
import { explainError, summarizeChange } from "@/lib/core/reasons";
import type { Answer } from "@/lib/core/explain";
import type { NextAction as Action } from "@/lib/advice";
import { short } from "@/lib/utils";

/** An Answer as the page renders it: the live one from the server, or a recorded one built from the site data. */
type Memory = NonNullable<Answer["memory"]>;
type ViewAnswer = Omit<Answer, "memory"> & { memory: null | (Omit<Memory, "nextAction" | "suggestion"> & { nextAction: Action }) };
type Done = { answer: ViewAnswer; recorded: boolean };
type State = { phase: "idle" } | { phase: "loading" } | { phase: "done"; done: Done } | { phase: "error"; message: string };

interface Example { chain: Chain; hash: string; label: string; featured: boolean }

const label = (c: Chain, detail: string | null, err: string) => `${CHAIN_LABEL[c]}: ${(detail ?? err).replace(/^Error in .*$/, "Move abort").slice(0, 26)}`;
const FEATURED = (() => {
  const f = DATA.stats.featured;
  const m = f && DATA.memories.find((x) => x.key === f.memory_key);
  return f && m ? { f, m } : null;
})();

/** Real repeat failures from the Mainnet runs, the featured non-bot one first. */
const EXAMPLES: Example[] = (() => {
  const out: Example[] = [];
  if (FEATURED) out.push({ chain: FEATURED.f.chain, hash: FEATURED.f.failure_tx, label: label(FEATURED.f.chain, FEATURED.m.error_detail, FEATURED.m.error), featured: true });
  for (const r of DATA.recalls) {
    if (out.some((e) => e.hash === r.failure_tx)) continue;
    const m = DATA.memories.find((x) => x.key === r.memory_key)!;
    out.push({ chain: r.chain, hash: r.failure_tx, label: label(r.chain, m.error_detail, r.error), featured: false });
  }
  return out;
})();

/** The recorded run for an example, shown (and labelled) only when the live lookup can't run. */
function recordedFor(hash: string): Done | null {
  const r = DATA.recalls.find((x) => x.failure_tx === hash);
  const m = r && DATA.memories.find((x) => x.key === r.memory_key);
  const action = m && nextActionOf(m);
  if (!r || !m || !action) return null;
  return {
    recorded: true,
    answer: {
      chain: r.chain, hash: r.failure_tx,
      failure: { wallet: m.wallet, contract: m.contract, errorSig: m.error, errorDetail: m.error_detail ?? "", block: 0, gasUsed: 0, gasLimit: 0 },
      reason: explainError(m.error, m.error_detail ?? undefined),
      without: r.without_memory ?? `Tx ${short(r.failure_tx, 10, 6)} on ${r.chain} reverted (${m.error}). No prior successful path on record for this wallet+contract. Check params and retry.`,
      memory: { successTx: r.with_memory.prior_success, successBlock: r.with_memory.block, blobId: r.with_memory.blob_id, changed: summarizeChange(r.with_memory.change), nextAction: action },
    },
  };
}

async function check(hash: string): Promise<{ ok: boolean; answer?: Answer; code?: string; message?: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 75_000);
  try {
    const res = await fetch("/api/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: hash }), signal: ctl.signal });
    return await res.json().catch(() => ({ ok: false, message: "Unexpected response." }));
  } finally {
    clearTimeout(timer);
  }
}

export function TryIt({ heading = "h2" }: { heading?: "h1" | "h2" }) {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const run = useRef(0);
  const Heading = heading;

  async function go(value: string) {
    const hash = value.trim();
    if (!hash) return;
    const id = ++run.current;
    setState({ phase: "loading" });
    let message = "Couldn't reach Clew. Check your connection and try again.";
    try {
      const json = await check(hash);
      if (id !== run.current) return;
      if (json.ok && json.answer) return setState({ phase: "done", done: { answer: json.answer, recorded: false } });
      message = json.message ?? message;
      // The live path is switched off or down: an example still has a recorded run, labelled as one.
      if (json.code === "unconfigured" || json.code === "upstream") {
        const rec = recordedFor(hash);
        if (rec) return setState({ phase: "done", done: rec });
      }
    } catch {
      if (id !== run.current) return;
      const rec = recordedFor(hash);
      if (rec) return setState({ phase: "done", done: rec });
    }
    setState({ phase: "error", message });
  }

  const busy = state.phase === "loading";
  const { bot_like, memories } = DATA.stats;
  return (
    <section id="try" aria-labelledby="try-h" className="scroll-mt-20">
      <div className="mx-auto max-w-[72rem] px-5 py-16 sm:px-8 sm:py-20 lg:px-12">
        <Reveal className="max-w-[42rem]">
          <p className="eyebrow">Try it</p>
          <Heading id="try-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
            Paste a failed transaction. See what Clew says with and without its memory.
          </Heading>
          <p className="mt-4 text-body text-ink-3 text-pretty">
            Clew reads the receipt through Tatum, then asks Walrus Memory what this wallet did the last time the same contract failed. Base, Ethereum, Polygon and Sui.
          </p>
        </Reveal>

        <Reveal className="mt-8 max-w-[48rem]">
          <form onSubmit={(e) => { e.preventDefault(); void go(input); }} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="tx-input" className="sr-only">Failed transaction hash</label>
            <input
              id="tx-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x… or a Sui digest"
              autoComplete="off"
              spellCheck={false}
              className="h-12 min-w-0 flex-1 rounded-xl border border-line-strong bg-raised px-4 font-mono text-[0.8125rem] text-ink placeholder:text-ink-4 focus:border-brand"
            />
            <button type="submit" disabled={busy || !input.trim()} className="inline-flex h-12 cursor-pointer items-center justify-center rounded-xl bg-brand-fill px-6 text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Checking…" : "Compare"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-small text-ink-4">No hash handy? Try a real failure:</span>
            {EXAMPLES.map((e) => (
              <button
                key={e.hash}
                type="button"
                disabled={busy}
                onClick={() => { setInput(e.hash); void go(e.hash); }}
                className="cursor-pointer rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-small text-ink-2 hover:bg-fill-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {e.label}
                {e.featured && <span className="ml-1.5 text-label text-brand">featured</span>}
              </button>
            ))}
          </div>

          {FEATURED && (
            <p className="mt-4 text-small text-ink-3 text-pretty">
              <span className="font-[580] text-ink-2">Featured:</span> a {CHAIN_LABEL[FEATURED.f.chain]} wallet ({short(FEATURED.m.wallet, 6, 4)}) with no automation signal ({FEATURED.m.wallet_class.reasons[0].replace(/^no automation signal: /, "")}). Its retry changed {FEATURED.m.diff.argsChanged === 1 ? "one calldata word" : `${FEATURED.m.diff.argsChanged} calldata words`}, not just gas.
            </p>
          )}

          <p className="mt-4 text-label text-ink-4 text-pretty">
            Honest note: most fast fail-and-retry wallets in the current set are bots ({bot_like} of the {memories} remembered wallets are bot-like by Clew’s heuristic), so these examples show the mechanism, not typical users. Clew only remembers a wallet’s own earlier fix.
          </p>
        </Reveal>

        <div aria-live="polite" className="mt-8">
          {state.phase === "loading" && (
            <p className="card px-5 py-5 text-body-sm text-ink-3">Reading the receipt through Tatum, then asking Walrus Memory. This takes a few seconds.</p>
          )}
          {state.phase === "error" && (
            <p role="alert" className="rounded-lg border border-fail/30 bg-fail-soft px-4 py-3 text-body-sm text-ink-2">{state.message}</p>
          )}
          {state.phase === "done" && <Compare done={state.done} />}
        </div>
      </div>
    </section>
  );
}

function Compare({ done }: { done: Done }) {
  const { answer: a, recorded } = done;
  const chain = a.chain as Chain;
  const exp = explorerName[chain];
  const m = a.memory;
  return (
    <div className="grid gap-4">
      <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-small text-ink-4 sm:px-7">
        <span className="rounded-md bg-fill px-2 py-0.5 text-label font-[560] text-ink-2">{CHAIN_LABEL[chain]}</span>
        <span className="flex items-center gap-1.5">failed tx <Hash value={a.hash} href={txUrl(chain, a.hash)} label="failed transaction" linkLabel={exp} /></span>
        <span className="flex items-center gap-1.5">wallet <Hash value={a.failure.wallet} href={addrUrl(chain, a.failure.wallet)} label="wallet" linkLabel={exp} /></span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Memory off: what Clew can say with nothing remembered */}
        <div className="card flex flex-col px-5 py-6 sm:px-7">
          <p className="text-body-sm font-[580] text-ink-3">Memory off</p>
          <p className="mt-4 break-words rounded-lg border border-dashed bg-fill/50 px-4 py-3.5 font-mono text-[0.8125rem] leading-relaxed text-ink-3">{a.without}</p>
          <p className="eyebrow mt-5">Reason</p>
          <p className="mt-2 text-body-sm text-ink-2 text-pretty">{a.reason.text}</p>
          <p className="mt-2 break-words font-mono text-label text-ink-4">
            {a.failure.errorSig}{a.failure.errorDetail && a.failure.errorDetail !== a.failure.errorSig ? ` · ${a.failure.errorDetail.slice(0, 90)}` : ""}
          </p>
          {!a.reason.known && <p className="mt-2 text-label text-ink-4">Clew can’t translate this error on its own, so it shows what the contract said.</p>}
          <p className="mt-auto pt-5 text-label text-ink-4">That is all there is to act on.</p>
        </div>

        {/* Memory on: the remembered retry */}
        <div className="card flex flex-col border-brand/40 bg-brand-soft/50 px-5 py-6 sm:px-7">
          <p className="text-body-sm font-[580] text-ink">Memory on</p>
          {m ? (
            <>
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink">
                <span className="font-[580]">Retry that worked</span>
                <Hash value={m.successTx} href={txUrl(chain, m.successTx)} label="retry that worked" linkLabel={exp} className="text-ink" />
                {m.successBlock > 0 && <span className="num text-label text-ink-4">{blockWord(chain)} {m.successBlock.toLocaleString("en-US")}</span>}
              </p>
              <p className="mt-3 text-small text-ink-2 text-pretty">
                <span className="font-[580] text-ink">What changed:</span>{" "}
                {m.changed.changed.length ? m.changed.changed.join(", ") : "nothing in the call itself"}.
                {m.changed.alsoDiffered.length > 0 && (
                  <span className="text-ink-4"> Also differed, and not shown as a cause: {m.changed.alsoDiffered.join(", ")}.</span>
                )}
              </p>
              <NextAction action={m.nextAction} className="mt-4" />
              <p className="mt-4 flex flex-wrap items-center gap-x-2 text-label text-ink-4">
                Walrus blob id
                <Hash value={m.blobId} href={blobUrl(m.blobId)} label="Walrus blob" linkLabel="Walruscan" head={10} tail={6} />
              </p>
              <p className="mt-1 text-label text-ink-4">The blob is encrypted: Walruscan shows it exists, not its text.</p>
            </>
          ) : (
            <>
              <p className="mt-4 text-body-sm text-ink-2 text-pretty">No memory exists for this wallet on this contract, so memory on finds nothing either and the two sides match.</p>
              <p className="mt-3 text-small text-ink-3 text-pretty">Clew learns from a repeat: it needs an earlier failure and the retry that fixed it from the same wallet.</p>
            </>
          )}
        </div>
      </div>

      <p className="text-label text-ink-4">
        {recorded
          ? "Recorded run from the Mainnet demo (live lookup unavailable right now)."
          : "Live run: the receipt was read through Tatum and both columns came from Walrus Memory just now."}
      </p>
    </div>
  );
}
