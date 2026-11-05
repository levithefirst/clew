"use client";
import { Check, Copy } from "lucide-react";
import { clip, formatNextAction, type Evidence as Ev, type NextAction as Action } from "@/lib/advice";
import { cn } from "@/lib/utils";
import { useCopy } from "@/lib/use-copy";

/** Copy-ready next action: the failure reason, then what to change. Gas appears only for out-of-gas failures. */
export function NextAction({ action: a, className }: { action: Action; className?: string }) {
  const text = formatNextAction(a);
  const n = (x: string | number) => Number(x).toLocaleString("en-US");
  const [copied, copy] = useCopy();
  return (
    <div className={cn("overflow-hidden rounded-xl border border-line-strong bg-raised", className)}>
      <div className="flex items-center gap-3 border-b px-3.5 py-2">
        <span className="eyebrow !text-brand">Next action</span>
        <button
          type="button"
          onClick={() => void copy(text)}
          className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-fill px-2.5 text-label font-[580] text-on-brand hover:bg-brand-fill-hover"
        >
          {copied === "ok" ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied === "ok" ? "Copied" : copied === "err" ? "Copy failed" : "Copy suggestion"}
        </button>
        <span aria-live="polite" className="sr-only">{copied === "ok" ? "Suggestion copied" : copied === "err" ? "Copy failed" : ""}</span>
      </div>
      <ul className="space-y-2.5 px-3.5 py-3 text-small text-ink-2">
        {a.evidence && <Evidence e={a.evidence} />}
        {a.reason && (
          <Step>
            Failure reason: <span className="text-ink">{a.reason}</span>
          </Step>
        )}
        {a.callInstead && (
          <Step>call <code className="font-mono text-ink">{a.callInstead.to}</code> instead of <code className="font-mono">{a.callInstead.from}</code></Step>
        )}
        {a.value && <Step>send value <span className="num font-mono text-ink">{n(a.value.to)}</span> wei <span className="text-ink-4">(failed with {n(a.value.from)})</span></Step>}
        {a.calldata.length > 0 && (
          <Step>
            Re-encode calldata like the retry
            <ul className="mt-1.5 space-y-1 font-mono text-[0.75rem]">
              {a.calldata.map((c) => (
                <li key={c.index} className="flex flex-wrap gap-x-2">
                  <span className="text-ink-4">word {c.index}</span>
                  <span className="text-ink" title={c.to}>{clip(c.to)}</span>
                  <span className="text-ink-4 line-through decoration-fail/50" title={c.from}>{clip(c.from)}</span>
                </li>
              ))}
              {a.moreWords > 0 && <li className="text-ink-4">+{a.moreWords} more from the template tx</li>}
            </ul>
          </Step>
        )}
        {a.inputs && a.inputs.length > 0 && (
          <Step>
            Change the transaction inputs like the retry
            <ul className="mt-1.5 space-y-1 font-mono text-[0.75rem]">
              {a.inputs.map((i) => (
                <li key={i.index} className="flex flex-wrap gap-x-2">
                  <span className="text-ink-4">input {i.index}</span>
                  <span className="text-ink" title={i.to}>{clip(i.to)}</span>
                  <span className="text-ink-4 line-through decoration-fail/50" title={i.from}>{clip(i.from)}</span>
                </li>
              ))}
            </ul>
          </Step>
        )}
        {a.resubmit && <Step>Same calldata and gas; the retry landed {a.resubmit} later. Resubmitting may be enough.</Step>}
        {a.gasLimit && (
          <Step>
            Out of gas at <span className="num font-mono text-ink">{n(a.gasLimit.failed)}</span>; the retry used a limit of <span className="num font-mono text-ink">{n(a.gasLimit.floor)}</span>. Consider ≥ that.
          </Step>
        )}
      </ul>
      <p className="border-t px-3.5 py-2 text-label text-ink-4">Copy includes the full values and the template tx.</p>
    </div>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-brand" aria-hidden>→</span>
      <div className="min-w-0 break-words">{children}</div>
    </li>
  );
}

/** What repeated across the earlier retries that succeeded after this same error, most frequent first. */
function Evidence({ e }: { e: Ev }) {
  const of = (count: number) => `${count} of ${e.total}`;
  if (!e.repeated) {
    return <Step>{e.total} earlier retries succeeded after this same error and no single change repeated across them. Showing the most recent.</Step>;
  }
  const [top, ...rest] = e.ranked;
  return (
    <>
      <Step>
        Most consistent change: <span className="font-[580] text-ink">{top.label}</span>, in <span className="num font-mono text-ink">{of(top.count)}</span> earlier retries that succeeded after this same error.
      </Step>
      {rest.filter((r) => r.count >= 2).map((r) => (
        <Step key={r.label}>Also seen: {r.label}, in <span className="num font-mono">{of(r.count)}</span>.</Step>
      ))}
      {e.alsoDiffered.length > 0 && (
        <li className="pl-5 text-label text-ink-4">
          Also differed, not shown as a cause: {e.alsoDiffered.map((r) => `${r.label} (${of(r.count)})`).join("; ")}.
        </li>
      )}
    </>
  );
}
