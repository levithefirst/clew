import { Reveal } from "@/components/reveal";
import { Example } from "@/components/example";
import { DATA, CHAIN_LABEL } from "@/lib/data";

export function ExampleSection() {
  const s = DATA.stats;
  const stats = [
    { v: s.memories, l: "Mainnet memories on Walrus" },
    { v: s.chains, l: s.chain_names.map((c) => `${CHAIN_LABEL[c]} ${s.per_chain[c]}`).join(" · ") },
    { v: s.distinct_contracts, l: "distinct contracts, one memory each" },
    { v: s.recalls, l: "repeat failures → prior path recalled" },
  ];
  return (
    <section id="example" aria-labelledby="example-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <Reveal className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-[42rem]">
            <p className="eyebrow">Real example</p>
            <h2 id="example-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
              Real failures, the retries that fixed them, and what recall returned.
            </h2>
            <p className="mt-4 text-body text-ink-3 text-pretty">
              Every pair below is a real on-chain failure and the same wallet’s successful retry to the same contract, read through Tatum and written to Walrus Memory on Mainnet. Nothing is seeded or mocked.
            </p>
          </div>
        </Reveal>

        <Reveal as="div" className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-line lg:grid-cols-4">
          {stats.map((x) => (
            <div key={x.l} className="bg-canvas px-5 py-5">
              <p className="num text-[2rem] font-[620] leading-none tracking-[-0.03em] text-brand">{x.v}</p>
              <p className="mt-2 text-small text-ink-3">{x.l}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="mt-10">
          <Example />
        </Reveal>

        <p className="mt-6 max-w-[48rem] text-small text-ink-4 text-pretty">
          Honest note: most wallets that fail and retry within minutes are bots. By Clew’s heuristic, {s.bot_like} of these {s.memories} wallets are bot-like (huge nonce counts, retries within seconds, dozens of calls to one contract in a few minutes), {s.human_like} shows no automation signal, and {s.memories - s.bot_like - s.human_like} on Sui is unclassified because Sui has no account nonce to check, so “what changed” is often a fresh quote rather than a human fix. Each wallet tag lists its reasons. Clew shows a gas hint only when the failed attempt actually ran out of gas; otherwise it shows the revert reason. Clew records what actually differed and lets you decide.
        </p>
      </div>
    </section>
  );
}
