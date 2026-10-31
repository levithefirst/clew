// Derives web/data/clew.json from the core's real artifacts (../memories.json, ../demo-output.txt, ../fixtures/pairs.json).
// Run once with `npm run data`; the output is committed so the web app is self-contained. No network, no secrets.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const memories = JSON.parse(readFileSync(join(root, "memories.json"), "utf8"));
const pairs = JSON.parse(readFileSync(join(root, "fixtures", "pairs.json"), "utf8"));
const demo = readFileSync(join(root, "demo-output.txt"), "utf8");
const classes = JSON.parse(readFileSync(join(root, "fixtures", "wallet-classes.json"), "utf8"));

// Display copy only: early runs joined clauses with " \u2014 "; the core now prints ". Check ..." and "; ".
// Memory `text` stays verbatim as stored on Walrus.
const undash = (s) => s?.replace(/ \u2014 check/g, ". Check").replace(/ \u2014 /g, "; ") ?? null;

const kv = (text, key) => text.match(new RegExp(`\\b${key}=(\\S+)`))?.[1] ?? null;
const num = (s) => (s == null ? null : Number(s));

function parseChange(change) {
  const gasUsed = change.match(/gas used was (\d+) vs (\d+) on failure/);
  const gasLimit = change.match(/gas limit (\d+) vs (\d+)/);
  const nonce = change.match(/nonce (\d+) -> (\d+)/);
  const same = change.match(/same function (0x[0-9a-f]+)/);
  const fn = change.match(/function (0x[0-9a-f]+) -> (0x[0-9a-f]+)/);
  const count = change.match(/(\d+) arg word\(s\) changed/);
  const argsBlock = change.match(/changed \((.*)\)\s*$/s)?.[1] ?? "";
  const args = [...argsBlock.matchAll(/arg (\d+) (\S+) -> (\S+?)(?=,|$)/g)].map((m) => ({ index: Number(m[1]), from: m[2], to: m[3] }));
  return {
    gasUsed: gasUsed && { failed: num(gasUsed[2]), success: num(gasUsed[1]) },
    gasLimit: gasLimit && { failed: num(gasLimit[2]), success: num(gasLimit[1]) },
    nonce: nonce && { failed: num(nonce[1]), success: num(nonce[2]) },
    selector: same ? { failed: same[1], success: same[1] } : fn ? { failed: fn[1], success: fn[2] } : null,
    argsChanged: count ? Number(count[1]) : args.length,
    args,
  };
}

// A corrected rewrite (rev=N, ledger key suffix :rN) replaces the entry it supersedes on the site;
// the superseded memory stays on Walrus and in memories.json.
const superseded = new Set(Object.values(memories).map((m) => m.supersedes).filter(Boolean));
const out = Object.entries(memories).filter(([key]) => !superseded.has(key)).map(([key, m]) => {
  const t = m.text;
  const chain = kv(t, "chain");
  const failed_tx = kv(t, "failed_tx");
  const pair = pairs.find((p) => p.fail === failed_tx) ?? {};
  const change = t.match(/Change: (.*?)\. NEXT_ACTION:/s)?.[1] ?? "";
  return {
    key,
    rev: num(kv(t, "rev")) ?? 1,
    supersedes: m.supersedes ?? null,
    chain,
    contract: kv(t, "contract"),
    wallet: kv(t, "wallet"),
    error: kv(t, "error"),
    error_detail: t.match(/failed with error \S+ \((.*?)\) for wallet/)?.[1] ?? null,
    selector: kv(t, "selector"),
    failed_tx,
    success_tx: kv(t, "success_tx"),
    success_block: num(kv(t, "success_block")),
    blocks_later: num(t.match(/, (\d+) blocks? later/)?.[1]),
    next_failure: pair.nextFailure ?? null,
    wallet_class: classes[key] ? { label: classes[key].label, reasons: classes[key].reasons } : null,
    job_id: m.job_id,
    blob_id: m.blob_id,
    namespace: m.namespace,
    written_at: m.written_at,
    diff: parseChange(change),
    next_action: undash(t.match(/NEXT_ACTION: (.*)$/s)?.[1]?.trim()),
    text: t,
  };
});

// Recall results from the demo run (section [4]).
const recalls = [];
const re = /new failure (\w+) (0x[0-9a-f]+)\n\s+error (\S+)\n\s+WITHOUT memory: (.*)\n\s+WITH memory\s+: prior success (0x[0-9a-f]+) \(block (\d+), blob (\S+)\)\n\s+change: (.*)\n\s+NEXT ACTION: (.*)/g;
for (const m of demo.matchAll(re)) {
  recalls.push({
    chain: m[1], failure_tx: m[2], error: m[3], without_memory: undash(m[4].trim()),
    with_memory: { prior_success: m[5], block: Number(m[6]), blob_id: m[7], change: m[8].trim(), next_action: undash(m[9].trim()) },
    memory_key: out.find((o) => o.success_tx === m[5])?.key ?? null,
  });
}
const cf = demo.match(/counterfactual: other wallet (0x[0-9a-f]+) failing on remembered contract (0x[0-9a-f]+)\n\s+-> (.*)/);
const counterfactual = cf && { wallet: cf[1], contract: cf[2], result: undash(cf[3].trim()) };

const chains = [...new Set(out.map((o) => o.chain))];
const stats = {
  memories: out.length,
  chains: chains.length,
  chain_names: chains,
  per_chain: Object.fromEntries(chains.map((c) => [c, out.filter((o) => o.chain === c).length])),
  distinct_contracts: new Set(out.map((o) => `${o.chain}:${o.contract}`)).size,
  recalls: recalls.length,
  human_like: out.filter((o) => o.wallet_class?.label === "human-like").length,
  namespace: [...new Set(out.map((o) => o.namespace))].join(","),
  relayer: "https://relayer.memory.walrus.xyz",
};

for (const r of recalls) if (!r.memory_key) throw new Error(`recall ${r.failure_tx} has no matching memory`);
for (const o of out) if (!o.wallet_class) throw new Error(`${o.key} has no wallet class: run npm run classify`);
// Headline preference: human-like wallets first (stable otherwise). The site's hero uses recalls[0].
const isHuman = (key) => classes[key]?.label === "human-like";
recalls.sort((a, b) => Number(isHuman(b.memory_key)) - Number(isHuman(a.memory_key)));
writeFileSync(join(root, "web", "data", "clew.json"), JSON.stringify({ generated_from: ["memories.json", "demo-output.txt", "fixtures/pairs.json", "fixtures/wallet-classes.json"], stats, memories: out, recalls, counterfactual }, null, 2) + "\n");
console.log(stats, recalls.length, !!counterfactual);
