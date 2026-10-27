"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Clew mark: a wound ball of thread with one strand trailing out, the path back.
 * Ribbon tone runs champagne highlight → shadow (--mark-hi → --mark-lo); the strand carries the accent.
 */
export function Mark({ className, animated = false }: { className?: string; animated?: boolean }) {
  const id = useId().replace(/:/g, "");
  const g = `clew-${id}`;
  return (
    <svg viewBox="0 0 32 32" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} aria-hidden className={cn("size-6", className)}>
      <defs>
        <linearGradient id={g} x1="4" y1="3" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mark-hi)" />
          <stop offset="1" stopColor="var(--mark-lo)" />
        </linearGradient>
        <linearGradient id={`${g}-t`} x1="19" y1="18" x2="30" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mark-lo)" />
          <stop offset="1" stopColor="var(--mark-hi)" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${g})`}>
        <circle cx="12.5" cy="12.5" r="9.5" />
        <path d="M4.2 8.6C9.6 9.4 14.6 13.4 16.4 21.2" />
        <path d="M8.2 4C13.8 5.6 18.4 10 20 16.8" />
      </g>
      <path d="M19.2 18.6c1.6 5.4 4.6 9.2 10.6 8.4" stroke={`url(#${g}-t)`} pathLength={1} className={animated ? "thread-draw" : undefined} />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 text-ink", className)}>
      <Mark className="size-[26px]" />
      <span className="text-[1.0625rem] font-[620] tracking-[-0.02em]">clew</span>
    </span>
  );
}
