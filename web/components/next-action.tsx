"use client";
import { Check, Copy } from "lucide-react";
import { clip, formatNextAction, type NextAction as Action } from "@/lib/advice";
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
