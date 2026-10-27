"use client";
import { Check, Copy } from "lucide-react";
import { GitHubIcon } from "@/components/brand-icons";
import { useSession } from "next-auth/react";
import { AuthButtons } from "@/components/auth-buttons";
import { Mark } from "@/components/logo";
import { SITE } from "@/lib/site";
import { HERO } from "@/lib/data";
import { useCopy } from "@/lib/use-copy";

// Display lines (with a wrapped hash) and the exact text that Copy puts on the clipboard.
const H = HERO.recall.failure_tx;
const SNIPPET: { cmd: string; note?: string; cont?: boolean }[] = [
  { cmd: "git clone https://github.com/levithefirst/clew" },
  { cmd: "cd clew && npm install" },
  { cmd: "cp .env.example .env", note: "# MEMWAL_KEY, MEMWAL_ACCOUNT_ID, TATUM_API_KEY" },
  { cmd: `npm run check -- ${HERO.recall.chain} \\` },
  { cmd: `  ${H}`, cont: true },
];
const CLIPBOARD = [
  "git clone https://github.com/levithefirst/clew",
  "cd clew && npm install",
  "cp .env.example .env",
  `npm run check -- ${HERO.recall.chain} ${H}`,
].join("\n");

export function Cta({ auth }: { auth: { google: boolean; github: boolean } }) {
  const [copied, copy] = useCopy(1400);
  const signedIn = useSession().status === "authenticated";
  return (
    <section aria-labelledby="cta-h" className="border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <div className="card relative overflow-hidden">
          <div className="relative grid gap-12 p-7 sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:p-14">
            <div>
              <Mark className="size-10 text-ink" />
              <h2 id="cta-h" className="mt-6 text-[1.875rem] leading-[1.12] text-ink text-balance sm:text-title">
                The next revert should come with directions.
              </h2>
              <p className="mt-4 max-w-[30rem] text-body text-ink-3 text-pretty">
                Run the recall on a real Base failure in under two minutes. Same contract, similar error, and Clew hands back the path that worked.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={SITE.repo} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-fill px-5 text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover">
                  <GitHubIcon className="size-4" /> Get the code
                </a>
              </div>
              <div className="mt-6 border-t pt-6">
                {signedIn ? (
                  <a href="/account" className="text-small font-[540] text-ink-3 hover:text-brand">You’re signed in. Go to your account →</a>
                ) : (
                  <>
                    <p className="mb-3 text-small text-ink-4">Or sign in (optional)</p>
                    <AuthButtons status={auth} size="lg" className="flex-wrap" />
                  </>
                )}
              </div>
            </div>

            <div className="min-w-0 overflow-hidden rounded-xl border bg-canvas">
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                <span className="text-label text-ink-4">Run it locally</span>
                <button type="button" onClick={() => void copy(CLIPBOARD)} aria-label="Copy commands" className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-label text-ink-3 hover:bg-fill-hover hover:text-ink">
                  {copied === "ok" ? <Check className="size-3.5 text-ok" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                  {copied === "ok" ? "Copied" : copied === "err" ? "Copy failed" : "Copy"}
                </button>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-[0.78rem] leading-[1.9] text-ink-2">
                {SNIPPET.map((l) => (
                  <span key={l.cmd} className={l.cont ? "block whitespace-pre-wrap break-all pl-4" : "block whitespace-pre"}>
                    <span className="select-none text-brand">{l.cont ? "" : "$ "}</span>
                    {l.cont ? l.cmd.trimStart() : l.cmd}
                    {l.note && <span className="block select-none pl-4 text-ink-4">{l.note}</span>}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
