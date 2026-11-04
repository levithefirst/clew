"use client";
import { useRef, useState } from "react";
import { Reveal } from "@/components/reveal";
import { Hash } from "@/components/hash";
import { NextAction } from "@/components/next-action";
import { DATA, CHAIN_LABEL, txUrl, addrUrl, blobUrl, explorerName, nextActionOf, blockWord, type Chain } from "@/lib/data";
import { explainError } from "@/lib/core/reasons";
import type { Answer } from "@/lib/core/explain";
import type { NextAction as Action } from "@/lib/advice";
import { cn, short } from "@/lib/utils";

type Taught = { chain: string; failedTx: string; successTx: string; blobId: string; alreadyStored: boolean };
/** An Answer as the page renders it: the live one from the server, or a recorded one built from the site data. */
type Memory = NonNullable<Answer["memory"]>;
type ViewAnswer = Omit<Answer, "memory"> & { memory: null | (Omit<Memory, "nextAction" | "suggestion"> & { nextAction: Action }) };
type Done = { answer: ViewAnswer; canTeach: boolean; recorded: boolean };
type State = { phase: "idle" } | { phase: "loading" } | { phase: "done"; done: Done } | { phase: "error"; message: string };

interface Example { chain: Chain; hash: string; label: string; human: boolean }

/** Real repeat failures from the Mainnet runs: the ones Clew has recalled, plus the one human-like wallet. */
const EXAMPLES: Example[] = (() => {
  const label = (c: Chain, detail: string | null, err: string) => `${CHAIN_LABEL[c]}: ${(detail ?? err).replace(/^Error in .*$/, "Move abort").slice(0, 26)}`;
  const out: Example[] = DATA.recalls.map((r) => {
    const m = DATA.memories.find((x) => x.key === r.memory_key)!;
    return { chain: r.chain, hash: r.failure_tx, label: label(r.chain, m.error_detail, r.error), human: false };
  });
  const human = DATA.memories.find((m) => m.wallet_class.label === "human-like" && m.next_failure);
  if (human?.next_failure && !out.some((e) => e.hash === human.next_failure)) {
    out.push({ chain: human.chain, hash: human.next_failure, label: label(human.chain, human.error_detail, human.error), human: true });
  }
  return out;
})();

/** The recorded run for an example, shown (and labelled) only when the live lookup can't run. */
function recordedFor(hash: string): Done | null {
  const r = DATA.recalls.find((x) => x.failure_tx === hash);
  const m = r && DATA.memories.find((x) => x.key === r.memory_key);
  const action = m && nextActionOf(m);
  if (!r || !m || !action) return null;
  const reason = explainError(m.error, m.error_detail ?? undefined);
  return {
    recorded: true, canTeach: false,
    answer: {
      chain: r.chain, hash: r.failure_tx,
      failure: { wallet: m.wallet, contract: m.contract, errorSig: m.error, errorDetail: m.error_detail ?? "", block: 0, gasUsed: 0, gasLimit: 0 },
      reason,
      without: r.without_memory ?? `Tx ${short(r.failure_tx, 10, 6)} on ${r.chain} reverted (${m.error}). No prior successful path on record for this wallet+contract. Check params and retry.`,
      memory: { successTx: r.with_memory.prior_success, successBlock: r.with_memory.block, blobId: r.with_memory.blob_id, nextAction: action },
    },
  };
}

async function post<T>(url: string, body: unknown): Promise<{ status: number; json: T }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 75_000);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    return { status: res.status, json: (await res.json().catch(() => ({ ok: false, message: "Unexpected response." }))) as T };
  } finally {
    clearTimeout(timer);
  }
}

export function TryIt() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  const run = useRef(0);

  async function check(value: string) {
    const hash = value.trim();
    if (!hash) return;
    const id = ++run.current;
    setState({ phase: "loading" });
    let message = "Couldn't reach Clew. Check your connection and try again.";
    try {
      const { json } = await post<{ ok: boolean; answer?: Answer; canTeach?: boolean; code?: string; message?: string }>("/api/check", { input: hash });
      if (id !== run.current) return;
      if (json.ok && json.answer) return setState({ phase: "done", done: { answer: json.answer, canTeach: Boolean(json.canTeach), recorded: false } });
      message = json.message ?? message;
      // The live path is down or switched off: an example still has a recorded run, labelled as one.
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
  return (
    <section id="try" aria-labelledby="try-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-20 sm:px-8 sm:py-24 lg:px-12">
        <Reveal className="max-w-[42rem]">
          <p className="eyebrow">Try it</p>
          <h2 id="try-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
            Paste a failed transaction. Clew says what happened and what worked last time.
          </h2>
          <p className="mt-4 text-body text-ink-3 text-pretty">
            It reads the receipt through Tatum, then asks Walrus Memory what this wallet did the last time the same contract failed. Base, Ethereum, Polygon and Sui.
          </p>
        </Reveal>

        <Reveal className="mt-8 max-w-[48rem]">
          <form onSubmit={(e) => { e.preventDefault(); void check(input); }} className="flex flex-col gap-2 sm:flex-row">
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
              {busy ? "Checking…" : "Check"}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-small text-ink-4">Or try a real one:</span>
            {EXAMPLES.map((e) => (
              <button
                key={e.hash}
                type="button"
                disabled={busy}
                onClick={() => { setInput(e.hash); void check(e.hash); }}
                className="cursor-pointer rounded-lg border border-line-strong bg-raised px-3 py-1.5 text-small text-ink-2 hover:bg-fill-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {e.label}
                {e.human && <span className="ml-1.5 text-label text-ink-4">human-like wallet</span>}
              </button>
            ))}
          </div>
        </Reveal>

        <div aria-live="polite" className="mt-8">
          {state.phase === "loading" && (
            <p className="card px-5 py-5 text-body-sm text-ink-3">Reading the receipt through Tatum, then asking Walrus Memory. This takes a few seconds.</p>
          )}
          {state.phase === "error" && (
            <p role="alert" className="rounded-lg border border-fail/30 bg-fail-soft px-4 py-3 text-body-sm text-ink-2">{state.message}</p>
          )}
          {state.phase === "done" && <AnswerView done={state.done} />}
        </div>
      </div>
    </section>
  );
}

function AnswerView({ done }: { done: Done }) {
  const { answer: a, recorded } = done;
  const chain = a.chain as Chain;
  const exp = explorerName[chain];
  return (
    <div className="grid gap-4">
      <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-small text-ink-4 sm:px-7">
        <span className="rounded-md bg-fill px-2 py-0.5 text-label font-[560] text-ink-2">{CHAIN_LABEL[chain]}</span>
        <span className="flex items-center gap-1.5">failed tx <Hash value={a.hash} href={txUrl(chain, a.hash)} label="failed transaction" linkLabel={exp} /></span>
        <span className="flex items-center gap-1.5">wallet <Hash value={a.failure.wallet} href={addrUrl(chain, a.failure.wallet)} label="wallet" linkLabel={exp} /></span>
      </div>

      <div className="card px-5 py-5 sm:px-7">
        <p className="eyebrow">What happened</p>
        <p className="mt-2 text-body text-ink text-pretty">{a.reason.text}</p>
        <p className="mt-2 break-words font-mono text-label text-ink-4">
          {a.failure.errorSig}{a.failure.errorDetail && a.failure.errorDetail !== a.failure.errorSig ? ` · ${a.failure.errorDetail.slice(0, 90)}` : ""}
        </p>
        {!a.reason.known && <p className="mt-2 text-label text-ink-4">Clew can't translate this error on its own, so it shows what the contract said.</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card flex flex-col px-5 py-6 sm:px-7">
          <p className="text-body-sm font-[580] text-ink-3">Without memory</p>
          <p className="mt-4 break-words rounded-lg border border-dashed bg-fill/50 px-4 py-3.5 font-mono text-[0.8125rem] leading-relaxed text-ink-3">{a.without}</p>
          <p className="mt-auto pt-4 text-label text-ink-4">What Clew says when nothing is remembered. Nothing to act on.</p>
        </div>

        <div className="card flex flex-col border-brand/40 bg-brand-soft/50 px-5 py-6 sm:px-7">
          <p className="text-body-sm font-[580] text-ink">With memory</p>
          {a.memory ? (
            <>
              <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink">
                <span className="font-[580]">Prior successful retry</span>
                <Hash value={a.memory.successTx} href={txUrl(chain, a.memory.successTx)} label="prior successful retry" linkLabel={exp} className="text-ink" />
                {a.memory.successBlock > 0 && <span className="num text-label text-ink-4">{blockWord(chain)} {a.memory.successBlock.toLocaleString("en-US")}</span>}
              </p>
              <NextAction action={a.memory.nextAction} className="mt-4" />
              <p className="mt-4 flex flex-wrap items-center gap-x-2 text-label text-ink-4">
                Recalled from encrypted Walrus blob
                <a href={blobUrl(a.memory.blobId)} target="_blank" rel="noreferrer" className="font-mono text-ink-3 hover:text-brand" title={a.memory.blobId}>{short(a.memory.blobId, 8, 4)} ↗</a>
              </p>
            </>
          ) : (
            <>
              <p className="mt-4 text-body-sm text-ink-2 text-pretty">Clew has no memory for this wallet on this contract yet, so it can't say more than the left side.</p>
              <p className="mt-3 text-small text-ink-3 text-pretty">Clew learns from a repeat: once it has seen a failure and the transaction that fixed it, the next similar failure from the same wallet gets that path.</p>
              {done.canTeach && <Teach failed={a.hash} chain={a.chain} />}
            </>
          )}
        </div>
      </div>

      <p className="text-label text-ink-4">
        {recorded
          ? "Recorded run from the Mainnet demo (live lookup unavailable right now)."
          : "Live run: the receipt was read through Tatum and both answers came from Walrus Memory just now."}
      </p>
    </div>
  );
}

/** Appears only when the server has teaching switched on. Writes one memory, after the pair is verified on chain. */
function Teach({ failed, chain }: { failed: string; chain: string }) {
  const [fix, setFix] = useState("");
  const [s, setS] = useState<{ phase: "idle" } | { phase: "saving" } | { phase: "done"; taught: Taught } | { phase: "error"; message: string }>({ phase: "idle" });

  async function save() {
    setS({ phase: "saving" });
    try {
      const { json } = await post<{ ok: boolean; taught?: Taught; message?: string }>("/api/teach", { failed, success: fix, chain: chain === "sui" ? undefined : chain });
      setS(json.ok && json.taught ? { phase: "done", taught: json.taught } : { phase: "error", message: json.message ?? "That didn't work. Try again." });
    } catch {
      setS({ phase: "error", message: "Couldn't reach Clew. Try again." });
    }
  }

  if (s.phase === "done") {
    return (
      <p role="status" className="mt-4 rounded-lg border border-brand/40 bg-raised px-4 py-3 text-small text-ink-2 text-pretty">
        {s.taught.alreadyStored ? "Clew already remembered this fix." : "Remembered."} Next time this wallet fails on this contract, Clew will show it.{" "}
        <a href={blobUrl(s.taught.blobId)} target="_blank" rel="noreferrer" className="font-mono text-ink-3 hover:text-brand">{short(s.taught.blobId, 8, 4)} ↗</a>
      </p>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (fix.trim()) void save(); }} className="mt-4">
      <label htmlFor="fix-input" className="text-small font-[560] text-ink-2">Know the transaction that fixed it?</label>
      <p className="mt-1 text-label text-ink-4">Paste it. Clew checks on chain that it is the same wallet and contract, a success, after this failure. It stores public chain data only, and a Walrus memory can't be deleted.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input id="fix-input" value={fix} onChange={(e) => setFix(e.target.value)} placeholder="Hash of the retry that worked" autoComplete="off" spellCheck={false}
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 font-mono text-[0.75rem] text-ink placeholder:text-ink-4 focus:border-brand" />
        <button type="submit" disabled={s.phase === "saving" || !fix.trim()} className={cn("inline-flex h-10 cursor-pointer items-center justify-center rounded-lg bg-brand-fill px-4 text-small font-[580] text-on-brand hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:opacity-50")}>
          {s.phase === "saving" ? "Saving…" : "Remember this fix"}
        </button>
      </div>
      {s.phase === "error" && <p role="alert" className="mt-2 text-small text-fail">{s.message}</p>}
    </form>
  );
}
