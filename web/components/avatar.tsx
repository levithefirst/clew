/* eslint-disable @next/next/no-img-element -- provider avatars are tiny and remote; next/image would need per-host config */
import { cn } from "@/lib/utils";

export function Avatar({ src, name, className }: { src?: string | null; name?: string | null; className?: string }) {
  const initials = (name ?? "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span className={cn("relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-label font-[600] text-brand ring-1 ring-line-strong", className)}>
      {initials}
      {src && <img src={src} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover" />}
    </span>
  );
}
