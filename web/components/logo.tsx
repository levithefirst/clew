import { cn } from "@/lib/utils";

/** Clew mark: a wound ball of thread with one strand trailing out — the path back. */
export function Mark({ className, animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} aria-hidden className={cn("size-6", className)}>
      <g stroke="currentColor">
        <circle cx="12.5" cy="12.5" r="9.5" />
        <path d="M4.2 8.6C9.6 9.4 14.6 13.4 16.4 21.2" />
        <path d="M8.2 4C13.8 5.6 18.4 10 20 16.8" />
      </g>
      <path d="M19.2 18.6c1.6 5.4 4.6 9.2 10.6 8.4" stroke="var(--brand)" pathLength={1} className={animated ? "thread-draw" : undefined} />
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
