"use client";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Hash } from "@/components/hash";
import { DATA, CHAIN_LABEL, txUrl, addrUrl, blobUrl, explorerName, nextActionOf, blockWord, type Memory } from "@/lib/data";
import { clip } from "@/lib/advice";
import { NextAction } from "@/components/next-action";
import { WalletTag } from "@/components/wallet-tag";
import { cn, fmt, short } from "@/lib/utils";

const RECALLED = new Map(DATA.recalls.map((r) => [r.memory_key, r]));
// Demo recalls first, then the rest in file order.
const ORDERED: Memory[] = [
  ...DATA.memories.filter((m) => RECALLED.has(m.key)),
  ...DATA.memories.filter((m) => !RECALLED.has(m.key)),
];

function errLabel(m: Memory) {
  const d = m.error_detail ?? m.error;
  return d.length > 44 ? d.slice(0, 42) + "…" : d;
}

function Row({ label, failed, success, mono = true }: { label: string; failed: React.ReactNode; success: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_1fr] items-baseline gap-3 border-t py-2.5 text-small sm:grid-cols-[8rem_1fr_1fr]">
      <dt className="text-ink-4">{label}</dt>
      <dd className={cn("min-w-0 truncate text-ink-3", mono && "num font-mono")}>{failed}</dd>
      <dd className={cn("min-w-0 truncate text-ink", mono && "num font-mono")}>{success}</dd>
    </div>
  );
}

export function Example() {
  const [key, setKey] = useState(ORDERED[0].key);
  const m = useMemo(() => DATA.memories.find((x) => x.key === key)!, [key]);
  const recall = RECALLED.get(m.key);
  const d = m.diff;
  const exp = explorerName[m.chain];
  const moreArgs = d.argsChanged - d.args.length;
  const action = nextActionOf(m);

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
      {/* Picker */}
      <div className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="eyebrow mb-3 px-1">{DATA.stats.memories} memories · pick one</p>
        <div role="listbox" aria-label="Mainnet memories" className="card relative flex gap-1 overflow-x-auto p-1.5 lg:max-h-[42rem] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
          {ORDERED.map((x) => {
            const on = x.key === key;
            const r = RECALLED.has(x.key);
            return (
              <button
                key={x.key}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => setKey(x.key)}
                className={cn(
                  "group flex w-[13.5rem] shrink-0 cursor-pointer flex-col gap-1 rounded-xl px-3 py-2.5 text-left lg:w-auto",
                  on ? "bg-fill-hover" : "hover:bg-fill",
                )}
              >
                <span className="flex items-center gap-2 text-label">
                  <span className={cn("font-[560]", on ? "text-ink-2" : "text-ink-3")}>{CHAIN_LABEL[x.chain]}</span>
                  <span className="font-mono text-ink-4">{short(x.contract, 6, 4)}</span>
                  {r && <span className="ml-auto rounded-full bg-brand-soft px-1.5 py-px text-[0.6875rem] font-[560] text-brand">recalled</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn("min-w-0 truncate text-small", on ? "text-ink" : "text-ink-2")}>{errLabel(x)}</span>
                  {x.wallet_class.label === "human-like" && <WalletTag cls={x.wallet_class} className="ml-auto shrink-0" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail */}
      <article className="card min-w-0 overflow-hidden" aria-live="polite">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4 sm:px-7">
          <span className="rounded-md bg-fill px-2 py-0.5 text-label font-[560] text-ink-2">{CHAIN_LABEL[m.chain]}</span>
          <span className="flex items-center gap-1.5 text-small text-ink-4">
            contract <Hash value={m.contract} href={addrUrl(m.chain, m.contract)} label="contract" linkLabel={exp} />
          </span>
          <span className="flex items-center gap-1.5 text-small text-ink-4">
            wallet <Hash value={m.wallet} href={addrUrl(m.chain, m.wallet)} label="wallet" linkLabel={exp} />
            <WalletTag cls={m.wallet_class} />
          </span>
        </header>

        <div className="px-5 py-6 sm:px-7">
          <p className="mb-5 text-label text-ink-4">
            {m.wallet_class.label === "unclassified" ? "Wallet unclassified" : `Wallet looks ${m.wallet_class.label}`} (heuristic): {m.wallet_class.reasons.join("; ")}.
          </p>
          <p className="eyebrow">Error</p>
          <p className="mt-2 break-words font-mono text-body-sm text-fail">{m.error_detail ?? m.error}</p>
          <p className="mt-1 break-all font-mono text-label text-ink-4">signature {m.error}</p>

          {/* Failure vs retry that worked */}
          <dl className="mt-7">
            <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-3 pb-2 text-label sm:grid-cols-[8rem_1fr_1fr]">
              <span />
              <span className="flex items-center gap-1.5 font-[560] text-fail"><span className="size-1.5 rounded-full bg-fail" aria-hidden />Failed</span>
              <span className="flex items-center gap-1.5 font-[560] text-ok"><span className="size-1.5 rounded-full bg-ok" aria-hidden />Retry that worked</span>
            </div>
            <Row
              label="Transaction"
              mono={false}
              failed={<Hash value={m.failed_tx} href={txUrl(m.chain, m.failed_tx)} label="failed transaction" linkLabel={exp} head={6} tail={4} />}
              success={<Hash value={m.success_tx} href={txUrl(m.chain, m.success_tx)} label="successful retry" linkLabel={exp} head={6} tail={4} className="text-ink" />}
            />
            <Row label="Gas used" failed={fmt(d.gasUsed?.failed)} success={fmt(d.gasUsed?.success)} />
            <Row label="Gas limit" failed={fmt(d.gasLimit?.failed)} success={fmt(d.gasLimit?.success)} />
            {d.nonce && <Row label="Nonce" failed={fmt(d.nonce.failed)} success={fmt(d.nonce.success)} />}
            <Row label="Function" failed={d.selector?.failed ?? m.selector} success={d.selector?.success ?? m.selector} />
            <Row label="Landed" failed={m.chain === "sui" ? "FAILURE" : "status 0x0"} success={m.blocks_later != null ? `${m.blocks_later} ${blockWord(m.chain)}s later` : "n/a"} mono={false} />
          </dl>

          {d.args.length > 0 && (
            <div className="mt-6">
              <p className="eyebrow">Calldata words changed · {d.argsChanged}</p>
              <ul className="mt-2.5 divide-y rounded-xl border bg-fill/50">
                {d.args.map((a) => (
                  <li key={a.index} className="grid grid-cols-[3.5rem_1fr] items-center gap-2 px-3.5 py-2 font-mono text-[0.75rem] sm:grid-cols-[3.5rem_1fr_auto_1fr]">
                    <span className="text-ink-4">arg {a.index}</span>
                    <span className="truncate text-ink-3 line-through decoration-fail/50" title={a.from}>{clip(a.from, 24)}</span>
                    <span className="hidden text-ink-4 sm:block" aria-hidden>→</span>
                    <span className="col-start-2 truncate text-ink sm:col-start-auto" title={a.to}>{clip(a.to, 24)}</span>
                  </li>
                ))}
                {moreArgs > 0 && <li className="px-3.5 py-2 text-label text-ink-4">+{moreArgs} more word{moreArgs === 1 ? "" : "s"} differ (summarised in the memory)</li>}
              </ul>
            </div>
          )}
        </div>

        {/* Memory → recall */}
        <div className="grid border-t md:grid-cols-2">
          <div className="border-b px-5 py-6 sm:px-7 md:border-b-0 md:border-r">
            <p className="eyebrow">Without memory</p>
            <p className="mt-3 rounded-lg border border-dashed bg-fill/50 px-3.5 py-3 font-mono text-[0.78rem] leading-relaxed text-ink-3 break-words">
              {recall?.without_memory ?? `Tx ${short(recall?.failure_tx ?? m.failed_tx, 10, 6)} on ${m.chain} reverted (${m.error}). No prior successful path on record for this wallet+contract. Check params and retry.`}
            </p>
            {recall ? (
              <p className="mt-3 flex flex-wrap items-center gap-1.5 text-label text-ink-4">
                Repeat failure <Hash value={recall.failure_tx} href={txUrl(m.chain, recall.failure_tx)} label="repeat failure" linkLabel={exp} />
                {!recall.without_memory && <span>(generic message shown; the empty-namespace run was not made for this failure)</span>}
              </p>
            ) : (
              <p className="mt-3 text-label text-ink-4">The generic message Clew returns with an empty namespace.</p>
            )}
          </div>
          <div className="bg-brand-soft/50 px-5 py-6 sm:px-7">
            <p className="eyebrow !text-brand">With memory</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink">
              <span className="font-[580]">Prior success</span>
              <Hash value={m.success_tx} href={txUrl(m.chain, m.success_tx)} label="prior success" linkLabel={exp} className="text-ink" />
              {m.success_block && <span className="num text-label text-ink-4">{blockWord(m.chain)} {m.success_block.toLocaleString("en-US")}</span>}
            </p>
            {action && <NextAction action={action} className="mt-3" />}
            <p className="mt-4 text-label text-ink-4">
              {recall
                ? `Returned by recall: ${recall.source}.`
                : m.next_failure
                  ? `Stored on Walrus. This wallet failed again (tx ${short(m.next_failure, 6, 4)}); recall has not been run on that failure yet.`
                  : "Stored on Walrus; returned on this pair’s next matching failure. No repeat failure was observed for it in the demo window."}
            </p>
          </div>
        </div>

        {/* Provenance */}
        <details className="group border-t">
          <summary className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-small text-ink-4 hover:bg-fill/60 sm:px-7">
            <span className="flex items-center gap-1.5">
              Walrus blob
              <a href={blobUrl(m.blob_id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={m.blob_id} className="font-mono text-ink-3 hover:text-brand">
                {short(m.blob_id, 8, 4)} ↗
              </a>
            </span>
            <span className="hidden sm:inline">job <span className="font-mono text-ink-3">{short(m.job_id, 8, 4)}</span></span>
            <span>namespace <span className="font-mono text-ink-3">{m.namespace}</span></span>
            <span className="ml-auto flex items-center gap-1 text-ink-3">
              Memory text <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
            </span>
          </summary>
          <div className="px-5 pb-6 sm:px-7">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border bg-fill/60 p-4 font-mono text-[0.72rem] leading-relaxed text-ink-3">{m.text}</pre>
            <p className="mt-2 text-label text-ink-4">
              Written {new Date(m.written_at).toUTCString().replace(" GMT", " UTC")} · job {m.job_id}. Shown from Clew’s local ledger: the blob on Walrus is SEAL-encrypted, so Walruscan confirms it exists but cannot display this text.
            </p>
          </div>
        </details>
      </article>
    </div>
  );
}
