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

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-h" className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[72rem] px-5 py-24 sm:px-8 sm:py-28 lg:px-12">
        <Reveal className="max-w-[40rem]">
          <p className="eyebrow">How it works</p>
          <h2 id="how-h" className="mt-3 text-[1.875rem] leading-[1.15] text-ink sm:text-title">
            One loop. Failure, the retry that worked, and the next failure that doesn’t start from zero.
          </h2>
        </Reveal>

        <ol className="mt-12 border-t">
          {STEPS.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * 90} className="grid gap-x-10 gap-y-3 border-b py-8 md:grid-cols-[13rem_1fr]">
              <div className="flex items-baseline gap-3 md:flex-col md:gap-1.5">
                <span className={`num font-mono text-small ${i === 2 ? "text-brand" : "text-ink-4"}`}>{s.n}</span>
                <h3 className="text-[1.25rem] font-[600] tracking-[-0.015em] text-ink">{s.title}</h3>
              </div>
              <div className="min-w-0">
                <p className="max-w-[44rem] text-body-sm text-ink-3 text-pretty">{s.body}</p>
                <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className={`rounded-md px-2 py-0.5 text-label font-[560] ${i === 0 ? "bg-fill text-ink-2" : "bg-brand-soft text-brand"}`}>{s.tag}</span>
                  <span className="font-mono text-label text-ink-4">{s.detail}</span>
                </p>
              </div>
            </Reveal>
          ))}
        </ol>

        <Reveal className="mt-10 grid gap-4 text-body-sm text-ink-3 sm:grid-cols-2">
          <p className="text-pretty">
            <span className="font-[560] text-ink-2">Tatum is load-bearing.</span> Every receipt, transaction, block and revert reason comes from Tatum gateways: JSON-RPC for Base, Ethereum and Polygon, GraphQL for Sui. No receipt, no memory.
          </p>
          <p className="text-pretty">
            <span className="font-[560] text-ink-2">Walrus is load-bearing.</span> The path that worked lives only in Walrus Memory (MemWal, relayer.memory.walrus.xyz). Empty namespace in, generic revert out.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
