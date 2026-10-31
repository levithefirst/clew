import type { Memory } from "@/lib/data";
import { cn } from "@/lib/utils";

/** Heuristic wallet label with its reasons on hover. Never claims a wallet is a person: "human-like" means no automation signal. */
export function WalletTag({ cls, className }: { cls: Memory["wallet_class"]; className?: string }) {
  const human = cls.label === "human-like";
  return (
    <span
      title={`${cls.label} (heuristic): ${cls.reasons.join("; ")}`}
      className={cn("rounded-md px-1.5 py-px text-[0.6875rem] font-[560]", human ? "bg-ok-soft text-ok" : "bg-fill text-ink-3", className)}
    >
      {cls.label}
    </span>
  );
}
