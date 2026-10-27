"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { X } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "@/components/brand-icons";
import { cn } from "@/lib/utils";

type Provider = "google" | "github";
type Status = Record<Provider, boolean>;

const META: Record<Provider, { label: string; Icon: typeof GoogleIcon; env: string }> = {
  google: { label: "Google", Icon: GoogleIcon, env: "AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET" },
  github: { label: "GitHub", Icon: GitHubIcon, env: "AUTH_GITHUB_ID / AUTH_GITHUB_SECRET" },
};

/** Sign-in buttons wired to Auth.js. If a provider isn't configured, show a quiet notice instead of erroring. */
export function AuthButtons({ status, size = "sm", className }: { status: Status; size?: "sm" | "lg"; className?: string }) {
  const [notice, setNotice] = useState<Provider | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const go = useCallback(
    (p: Provider) => {
      if (status[p]) {
        void signIn(p);
        return;
      }
      setNotice(p);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), 5200);
    },
    [status],
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  const btn =
    size === "lg"
      ? "h-11 gap-2.5 rounded-xl px-5 text-body-sm"
      : "h-9 gap-2 rounded-lg px-3 text-small";

  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        {(Object.keys(META) as Provider[]).map((p) => {
          const { label, Icon } = META[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => go(p)}
              className={cn(
                "inline-flex cursor-pointer items-center justify-center whitespace-nowrap border border-line-strong bg-raised font-[530] text-ink-2 hover:bg-fill-hover hover:text-ink",
                btn,
              )}
            >
              <Icon className={size === "lg" ? "size-[18px]" : "size-4"} />
              <span>
                <span className={size === "sm" ? "hidden xl:inline" : undefined}>Continue with </span>
                {label}
              </span>
            </button>
          );
        })}
      </div>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
        {notice && (
          <div role="status" className="card rise pointer-events-auto flex max-w-md items-start gap-3 px-4 py-3 text-small">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
            <p className="text-ink-2">
              <span className="font-[560] text-ink">{META[notice].label} sign-in isn’t configured yet.</span>{" "}
              <span className="text-ink-3">
                Set <code className="font-mono text-[0.75rem]">AUTH_SECRET</code> and <code className="font-mono text-[0.75rem]">{META[notice].env}</code> in{" "}
                <code className="font-mono text-[0.75rem]">web/.env.local</code>. The demo needs no account.
              </span>
            </p>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="-mr-1 cursor-pointer rounded p-0.5 text-ink-4 hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
