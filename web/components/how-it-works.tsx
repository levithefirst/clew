import { Reveal } from "@/components/reveal";
import { DATA } from "@/lib/data";

const STEPS = [
  {
    n: "01",
    title: "Failure",
    body: "Clew pulls the receipt through Tatum RPC (eth_getTransactionReceipt). Status 0x0 confirms the revert; the reason is decoded from a trace, or an eth_call replay, falling back to the function selector.",
    tag: "Tatum RPC",
    detail: "contract · wallet · error signature",
  },
  {
    n: "02",
    title: "Successful retry",
    body: "When the same wallet lands a successful call to the same contract minutes later, Clew diffs it against the failure: gas used and limit, gas price, nonce, function, each calldata word, and writes that path to Walrus Memory on Mainnet.",
    tag: "Walrus Memory · remember",
    detail: `namespace "${DATA.stats.namespace}" · waitForRememberJob`,
  },
  {
    n: "03",
    title: "Next failure",
    body: "Same wallet, same contract, similar error: Clew recalls the memory and returns the retry that worked: the specific tx, what changed, and the next action, instead of a dead-end revert message.",
    tag: "Walrus Memory · recall",
    detail: "prior success → next action",
  },
] as const;

function Connector() {
  // Thread linking the three steps (desktop). Knots mark each step; the last one is the payoff.
  return (
    <svg aria-hidden viewBox="0 0 1000 40" preserveAspectRatio="none" className="absolute inset-x-0 top-[22px] hidden h-10 w-full lg:block" fill="none">
      <path d="M22 20 C 120 2 250 38 362 20 S 590 2 703 20 S 900 38 1000 20" stroke="var(--line-strong)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d="M703 20 S 900 38 1000 20" stroke="var(--brand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <Reveal className="max-w-[40rem]">
          <p className="eyebrow">How it works</p>
          <h2 id="how-h" className="mt-3 text-[1.875rem] font-[620] leading-[1.15] tracking-[-0.03em] text-ink sm:text-title">
            One loop. Failure, the retry that worked, and the next failure that doesn’t start from zero.
          </h2>
        </Reveal>

        <div className="relative mt-14">
          <Connector />
          <ol className="relative grid gap-5 lg:grid-cols-3 lg:gap-6">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.n} delay={i * 90} className="relative flex flex-col">
                <div className="mb-5 hidden h-[44px] items-center lg:flex">
                  <span className={`relative grid size-[44px] place-items-center rounded-full border bg-canvas ${i === 2 ? "border-brand/60" : "border-line-strong"}`}>
                    <span className={`size-2.5 rounded-full ${i === 2 ? "bg-brand" : i === 0 ? "bg-fail" : "bg-ok"}`} />
                  </span>
                </div>
                <div className={`card flex flex-1 flex-col p-6 sm:p-7 ${i === 2 ? "ring-1 ring-brand/25" : ""}`}>
                  <div className="flex items-center gap-3">
                    <span className="num font-mono text-small text-ink-4">{s.n}</span>
                    <span className={`size-1.5 rounded-full lg:hidden ${i === 2 ? "bg-brand" : i === 0 ? "bg-fail" : "bg-ok"}`} aria-hidden />
                  </div>
                  <h3 className="mt-3 text-[1.25rem] font-[600] tracking-[-0.015em] text-ink">{s.title}</h3>
                  <p className="mb-6 mt-2.5 text-body-sm text-ink-3 text-pretty">{s.body}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-4">
                    <span className={`rounded-md px-2 py-0.5 text-label font-[560] ${i === 0 ? "bg-fill text-ink-2" : "bg-brand-soft text-brand"}`}>{s.tag}</span>
                    <span className="font-mono text-label text-ink-4">{s.detail}</span>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>

        <Reveal className="mt-10 grid gap-4 text-body-sm text-ink-3 sm:grid-cols-2">
          <p className="text-pretty">
            <span className="font-[560] text-ink-2">Tatum is load-bearing.</span> Every receipt, transaction, block and revert reason comes from Tatum RPC gateways for Base, Ethereum and Polygon. No receipt, no memory.
          </p>
          <p className="text-pretty">
            <span className="font-[560] text-ink-2">Walrus is load-bearing.</span> The path that worked lives only in Walrus Memory (MemWal, relayer.memory.walrus.xyz). Empty namespace in, generic revert out.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
