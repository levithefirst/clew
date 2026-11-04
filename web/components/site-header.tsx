"use client";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu, MobileUserMenu } from "@/components/user-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#try", label: "Try it" },
  { href: "/#how", label: "How it works" },
  { href: "/#example", label: "Example" },
];

export function SiteHeader({ auth }: { auth: { google: boolean; github: boolean } }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <>
      {/* Zero-height anchor at the very top: "/#top" (logo links) scrolls to 0; a sticky element can't be a scroll target. */}
      <span id="top" aria-hidden className="block h-0" />
      <header
        className={cn("sticky top-0 z-50 w-full border-b bg-canvas transition-colors duration-200", (scrolled || open) && "border-line-strong")}
      >
        <div className="mx-auto flex h-14 w-full max-w-[72rem] items-center gap-8 px-5 sm:px-8 lg:px-12">
          <a href="/#top" aria-label="Clew home" className="flex shrink-0 items-center rounded-md">
            <Logo />
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="text-small font-[500] text-ink-3 hover:text-ink">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <span className="mx-1 hidden h-5 w-px bg-line-strong md:block" aria-hidden />
            <UserMenu auth={auth} className="hidden md:flex" />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-2 hover:bg-fill-hover md:hidden"
            >
              {open ? <X className="size-5" strokeWidth={1.75} /> : <Menu className="size-5" strokeWidth={1.75} />}
            </button>
          </div>
        </div>
        <div id="mobile-nav" hidden={!open} className="border-t md:hidden">
          <nav aria-label="Mobile" className="mx-auto flex max-w-[72rem] flex-col px-5 pb-5 pt-2 sm:px-8">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="border-b py-3.5 text-body font-[500] text-ink-2 hover:text-ink">
                {n.label}
              </a>
            ))}
            <MobileUserMenu auth={auth} onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      </header>
    </>
  );
}
