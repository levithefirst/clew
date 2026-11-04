import { GitHubIcon } from "@/components/brand-icons";
import { Hash } from "@/components/hash";
import { HERO, CHAIN_LABEL, txUrl, blobUrl, explorerName, nextActionOf } from "@/lib/data";
import { adviceLines } from "@/lib/advice";
import { SITE } from "@/lib/site";
import { short } from "@/lib/utils";

function HeroThread() {
  // A single strand that knots once (the failure) and runs on to the right (the path that worked).
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 560"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-70 dark:opacity-60"
      fill="none"
    >
      <defs>
        <linearGradient id="hero-thread" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--mark-lo)" stopOpacity="0.2" />
          <stop offset="0.55" stopColor="var(--mark-lo)" />
          <stop offset="1" stopColor="var(--mark-hi)" />
        </linearGradient>
      </defs>
      <path
        d="M-40 548 C 220 548 430 540 560 505 S 700 420 655 468 S 610 528 700 524 S 930 500 1010 390 S 1110 150 1260 110"
        stroke="url(#hero-thread)"
        strokeOpacity="0.75"
        strokeWidth="1.5"
        strokeLinecap="round"
        pathLength={1}
        className="thread-draw"
      />
    </svg>
  );
}

export function Hero() {
  const { recall, memory } = HERO;
  const action = nextActionOf(memory);
  const lines = action ? adviceLines(action, 3) : [];
  return (
    <section className="relative isolate overflow-hidden">
      <HeroThread />
      <div className="mx-auto grid max-w-[72rem] gap-14 px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 lg:px-12 lg:pb-28 lg:pt-20">
        <div>
          <h1 className="rise-2 text-[2.625rem] leading-[1.02] text-balance text-ink sm:text-[3.5rem] lg:text-display">
            Stop guessing why it reverted. <span className="text-brand">Clew remembers what worked.</span>
          </h1>
          <p className="rise-3 mt-6 max-w-[34rem] text-lead text-ink-3 text-pretty">
            The next time the same contract fails with a similar error, Clew surfaces the exact retry that succeeded before (the calldata change, the gas, the nonce) instead of a generic <span className="whitespace-nowrap font-mono text-[0.95em] text-ink-2">“transaction reverted”</span>.
          </p>
          <div className="rise-4 mt-9 flex flex-wrap items-center gap-3">
            <a href="#try" className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-fill px-5 text-body-sm font-[580] text-on-brand hover:bg-brand-fill-hover">
              Try it on a failed transaction
            </a>
            <a href={SITE.repo} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line-strong bg-raised px-5 text-body-sm font-[540] text-ink-2 hover:bg-fill-hover hover:text-ink">
              <GitHubIcon className="size-4" /> View the code
            </a>
          </div>
        </div>

        {/* Before / after, straight from the demo run */}
        <figure className="rise-4 card relative overflow-hidden" aria-label="Same failure, without and with Clew">
          <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-3.5 text-small text-ink-3">
            <span className="font-[560] text-ink-2">New failure</span>
            <span className="text-ink-4">{CHAIN_LABEL[recall.chain]}</span>
            <Hash value={recall.failure_tx} href={txUrl(recall.chain, recall.failure_tx)} label="failed transaction" linkLabel={explorerName[recall.chain]} />
            <span className="ml-auto rounded-md bg-fail-soft px-2 py-0.5 font-mono text-label text-fail">{memory.error_detail}</span>
          </figcaption>

          <div className="px-5 py-5">
            <p className="eyebrow">Without Clew</p>
            <p className="mt-2.5 rounded-lg border border-dashed bg-fill/60 px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink-3">
              Tx reverted <span className="text-ink-4">({recall.error})</span>
              <br />
              <span className="text-ink-4">No prior successful path on record. Check params and retry.</span>
            </p>
          </div>

          <div className="relative border-t bg-brand-soft/60 px-5 py-5">
            <p className="eyebrow !text-brand">With Clew</p>
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-ink">
              <span className="font-[580]">Retry that worked</span>
              <Hash value={recall.with_memory.prior_success} href={txUrl(recall.chain, recall.with_memory.prior_success)} label="successful retry" linkLabel={explorerName[recall.chain]} className="text-ink" />
              <span className="num text-small text-ink-4">block {recall.with_memory.block.toLocaleString("en-US")}</span>
            </p>
            <ul className="mt-3 space-y-1.5 font-mono text-[0.8125rem] text-ink-2">
              {lines.map((l) => (
                <li key={l} className="flex gap-2">
                  <span className="text-brand" aria-hidden>→</span>
                  <span className="min-w-0 break-words">{l}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 text-label text-ink-4">
              Recalled from encrypted Walrus blob
              <a href={blobUrl(recall.with_memory.blob_id)} target="_blank" rel="noreferrer" className="font-mono text-ink-3 hover:text-brand" title={recall.with_memory.blob_id}>
                {short(recall.with_memory.blob_id, 8, 4)} ↗
              </a>
            </p>
          </div>
        </figure>
      </div>
    </section>
  );
}
