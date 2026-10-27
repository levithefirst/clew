"use client";
import { useState } from "react";
import { Check, Copy, ArrowUpRight } from "lucide-react";
import { cn, short } from "@/lib/utils";

/** Truncated hash with copy + external link. Full value is in title/aria for screen readers. */
export function Hash({ value, href, label, head = 6, tail = 4, className, linkLabel }: {
  value: string;
  href?: string;
  label?: string;
  head?: number;
  tail?: number;
  className?: string;
  linkLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable: ignore */
    }
  };
  return (
    <span className={cn("relative inline-flex min-w-0 items-center gap-1 font-mono text-[0.8125rem] text-ink-2", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={`${value}, open in ${linkLabel ?? "explorer"}`} className="group inline-flex items-center gap-0.5 rounded hover:text-brand">
          <span className="truncate">{short(value, head, tail)}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-ink-4 group-hover:text-brand" aria-hidden />
          <span className="sr-only">{label ?? value} (opens {linkLabel ?? "explorer"})</span>
        </a>
      ) : (
        <span title={value} className="truncate">{short(value, head, tail)}</span>
      )}
      <button type="button" onClick={copy} aria-label={`Copy ${label ?? "value"}`} title="Copy" className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-ink-4 hover:bg-fill-hover hover:text-ink">
        {copied ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      <span aria-live="polite" className="sr-only">{copied ? "Copied" : ""}</span>
    </span>
  );
}
