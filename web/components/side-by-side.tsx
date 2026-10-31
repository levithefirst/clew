import { Reveal } from "@/components/reveal";
import { Hash } from "@/components/hash";
import { NextAction } from "@/components/next-action";
import { WalletTag } from "@/components/wallet-tag";
import { HERO, CHAIN_LABEL, txUrl, addrUrl, blobUrl, explorerName, nextActionOf } from "@/lib/data";
import { short } from "@/lib/utils";

/** The same real Base failure, answered twice: empty namespace vs. the memory recalled from Walrus. */
export function SideBySide() {
  const { recall, memory } = HERO;
  const exp = explorerName[recall.chain];
  const action = nextActionOf(memory);
  return (
    <section id="same-failure" aria-labelledby="same-failure-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <Reveal className="max-w-[42rem]">
          <p className="eyebrow">Same failure, twice</p>
          <h2 id="same-failure-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
            Without memory, a shrug. With memory, the path that worked.
          </h2>
        </Reveal>

        <Reveal className="mt-8 card flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-small text-ink-4 sm:px-7">
          <span className="rounded-md bg-fill px-2 py-0.5 text-label font-[560] text-ink-2">{CHAIN_LABEL[recall.chain]}</span>
          <span className="flex items-center gap-1.5">
            failed tx <Hash value={recall.failure_tx} href={txUrl(recall.chain, recall.failure_tx)} label="failed transaction" linkLabel={exp} />
          </span>
          <span className="flex items-center gap-1.5">
            wallet <Hash value={memory.wallet} href={addrUrl(recall.chain, memory.wallet)} label="wallet" linkLabel={exp} />
            <WalletTag cls={memory.wallet_class} />
          </span>
          <span className="rounded-md bg-fail-soft px-2 py-0.5 font-mono text-label text-fail">{memory.error_detail}</span>
        </Reveal>

        <Reveal as="div" className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Without memory */}
          <div className="card flex flex-col px-5 py-6 sm:px-7">
            <p className="flex items-center gap-2 text-body-sm font-[580] text-ink-3">
              Without memory
            </p>
            <p className="mt-4 rounded-lg border border-dashed bg-fill/50 px-4 py-3.5 font-mono text-[0.8125rem] leading-relaxed text-ink-3 break-words">
              Tx {short(recall.failure_tx, 6, 4)} on {recall.chain} reverted ({recall.error}). No prior successful path on record for this wallet+contract. Check params and retry.
            </p>
            <p className="mt-auto pt-4 text-label text-ink-4">What Clew returns when the namespace is empty. Nothing to act on.</p>
          </div>

          {/* With memory */}
          <div className="card flex flex-col border-brand/40 bg-brand-soft/50 px-5 py-6 sm:px-7">
            <p className="flex items-center gap-2 text-body-sm font-[580] text-ink">
              With memory
            </p>
            <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink">
              <span className="font-[580]">Prior successful retry</span>
              <Hash value={recall.with_memory.prior_success} href={txUrl(recall.chain, recall.with_memory.prior_success)} label="prior successful retry" linkLabel={exp} className="text-ink" />
              <span className="num text-label text-ink-4">block {recall.with_memory.block.toLocaleString("en-US")}</span>
            </p>
            {action && <NextAction action={action} className="mt-4" />}
            <p className="mt-4 flex flex-wrap items-center gap-x-2 text-label text-ink-4">
              Recalled from encrypted Walrus blob
              <a href={blobUrl(recall.with_memory.blob_id)} target="_blank" rel="noreferrer" className="font-mono text-ink-3 hover:text-brand" title={recall.with_memory.blob_id}>
                {short(recall.with_memory.blob_id, 8, 4)} ↗
              </a>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
