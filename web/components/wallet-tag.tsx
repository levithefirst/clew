import type { Memory } from "@/lib/data";
import { cn } from "@/lib/utils";

/** Heuristic wallet label with its reasons on hover. "human-like" means no automation signal; "unclassified" means too few signals to say (Sui has no nonce). */
export function WalletTag({ cls, className }: { cls: Memory["wallet_class"]; className?: string }) {
  const human = cls.label === "human-like";
  const unknown = cls.label === "unclassified";
  return (
    <span
      title={`${cls.label} (heuristic): ${cls.reasons.join("; ")}`}
      className={cn("rounded-md px-1.5 py-px text-[0.6875rem] font-[560]", human ? "bg-ok-soft text-ok" : unknown ? "border border-dashed text-ink-4" : "bg-fill text-ink-3", className)}
    >
      {cls.label}
    </span>
  );
}
