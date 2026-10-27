"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Check, Copy, X } from "lucide-react";
import { HERO } from "@/lib/data";
import { WELCOMED_COOKIE } from "@/lib/site";
import { useCopy } from "@/lib/use-copy";

const CHECK = `npm run check -- ${HERO.recall.chain} ${HERO.recall.failure_tx}`;

/** First-visit welcome. Marks itself as seen on mount, so it shows once per browser. */
export function Welcome({ name }: { name?: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    document.cookie = `${WELCOMED_COOKIE}=1; path=/; max-age=31536000; samesite=lax; secure`;
  }, []);
  if (!shown) return null;
  return (
    <section aria-labelledby="welcome-h" className="rise relative mb-6 overflow-hidden rounded-2xl border border-brand/30 bg-brand-soft/60 px-5 py-6 sm:px-7">
      <button type="button" onClick={() => setShown(false)} aria-label="Dismiss welcome" className="absolute right-3 top-3 cursor-pointer rounded-md p-1 text-ink-4 hover:bg-fill-hover hover:text-ink">
        <X className="size-4" aria-hidden />
      </button>
      <p className="eyebrow !text-brand">Welcome{name ? `, ${name}` : ""}</p>
      <h2 id="welcome-h" className="mt-2 pr-6 text-[1.25rem] leading-snug text-ink">
        Next time a tx reverts, Clew hands you the retry that worked.
      </h2>
      <p className="mt-2 text-body-sm text-ink-3 text-pretty">
        Clew remembers each failure and the successful retry that followed, then hands that path back when the same contract fails again.
      </p>
      <a href="/#same-failure" className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-brand-fill px-5 text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover">
        See it on a real failure
      </a>
    </section>
  );
}

export function NextSteps() {
  const [copied, copy] = useCopy(1400);
  return (
    <section aria-labelledby="next-h" className="mt-6">
      <h2 id="next-h" className="eyebrow px-1">What you can do</h2>
      <ol className="card mt-3 divide-y">
        <li className="flex items-center gap-4 px-5 py-4 sm:px-7">
          <span className="num inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-label font-[600] text-brand">1</span>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-[560] text-ink">See the same failure with and without memory</p>
            <p className="text-small text-ink-4">A real Base revert, answered twice.</p>
          </div>
          <a href="/#same-failure" className="inline-flex h-9 shrink-0 items-center rounded-lg border border-line-strong px-3 text-small font-[540] text-ink-2 hover:bg-fill-hover hover:text-ink">
            Open
          </a>
        </li>
        <li className="flex gap-4 px-5 py-4 sm:px-7">
          <span className="num mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-label font-[600] text-brand">2</span>
          <div className="min-w-0 flex-1">
            <p className="text-body-sm font-[560] text-ink">Check a failed tx yourself</p>
            <p className="text-small text-ink-4">Swap in your own failed tx hash.</p>
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border bg-fill/60 py-1 pl-3 pr-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-ink-2" title={CHECK}>{CHECK}</code>
              <button type="button" onClick={() => void copy(CHECK)} aria-label={copied === "err" ? "Copy failed" : "Copy command"} title={copied === "err" ? "Copy failed" : "Copy"} className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-4 hover:bg-fill-hover hover:text-ink">
                {copied === "ok" ? <Check className="size-3.5 text-ok" aria-hidden /> : copied === "err" ? <X className="size-3.5 text-fail" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              </button>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ redirectTo: "/" })}
      className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-line-strong bg-raised px-3.5 text-small font-[540] text-ink-2 hover:bg-fill-hover hover:text-ink"
    >
      Sign out
    </button>
  );
}
