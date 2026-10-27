"use client";
import { useEffect, useRef, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { LogOut, UserRound } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { AuthButtons } from "@/components/auth-buttons";
import { cn } from "@/lib/utils";

type Status = { google: boolean; github: boolean };

/** Desktop header slot: sign-in buttons when signed out, avatar dropdown (Account, Sign out) when signed in. */
export function UserMenu({ auth, className }: { auth: Status; className?: string }) {
  const { data, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (status === "loading") return <span className={cn("size-8 rounded-full bg-fill", className)} aria-hidden />;
  if (status !== "authenticated") return <AuthButtons status={auth} className={className} />;

  const u = data.user;
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex cursor-pointer items-center rounded-full p-0.5 hover:ring-2 hover:ring-brand/40"
      >
        <Avatar src={u?.image} name={u?.name ?? u?.email} />
      </button>
      {open && (
        <div role="menu" className="card rise absolute right-0 top-11 z-50 w-64 overflow-hidden p-1.5">
          <div className="px-3 py-2.5">
            <p className="truncate text-small font-[580] text-ink">{u?.name ?? "Signed in"}</p>
            {u?.email && <p className="truncate text-label text-ink-4">{u.email}</p>}
          </div>
          <div className="my-1 h-px bg-line" />
          <a role="menuitem" href="/account" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-small text-ink-2 hover:bg-fill-hover hover:text-ink">
            <UserRound className="size-4 text-ink-4" aria-hidden /> Account
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={() => void signOut({ redirectTo: "/" })}
            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-small text-ink-2 hover:bg-fill-hover hover:text-ink"
          >
            <LogOut className="size-4 text-ink-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Mobile menu slot: full-width buttons, or the signed-in identity with Account / Sign out. */
export function MobileUserMenu({ auth, onNavigate }: { auth: Status; onNavigate?: () => void }) {
  const { data, status } = useSession();
  if (status === "loading") return null;
  if (status !== "authenticated") return <AuthButtons status={auth} size="lg" className="mt-5 flex-col items-stretch [&>button]:w-full" />;
  const u = data.user;
  return (
    <div className="mt-5">
      <div className="flex items-center gap-3">
        <Avatar src={u?.image} name={u?.name ?? u?.email} className="size-10" />
        <div className="min-w-0">
          <p className="truncate text-body-sm font-[580] text-ink">{u?.name ?? "Signed in"}</p>
          {u?.email && <p className="truncate text-small text-ink-4">{u.email}</p>}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href="/account" onClick={onNavigate} className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-fill text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover">
          Account
        </a>
        <button type="button" onClick={() => void signOut({ redirectTo: "/" })} className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line-strong bg-raised text-body-sm font-[540] text-ink-2 hover:bg-fill-hover">
          Sign out
        </button>
      </div>
    </div>
  );
}
