// Tag every memory's wallet as bot-like or human-like (src/classify.ts) from data already on disk:
// nonces and retry latency from the memory text, call counts from discovery candidates. No network.
// Writes fixtures/wallet-classes.json keyed by ledger key; memories.json stays a record of Walrus writes only.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { classifyWallet, type WalletClass } from "../src/classify.ts";
import { readLedger } from "../src/memory.ts";

const scans: Record<string, number> = JSON.parse(readFileSync("fixtures/scans.json", "utf8"));
const candidates = (chain: string): any[] => {
  const f = `fixtures/candidates-${chain}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
};

const out: Record<string, WalletClass & { wallet: string }> = {};
for (const [key, m] of Object.entries(readLedger())) {
  const [chain, failed] = key.split(":");
  const nonce = m.text.match(/nonce (\d+) -> (\d+)/), later = m.text.match(/, (\d+) blocks? later/);
  if (!later) throw new Error(`${key}: memory text has no retry latency`);
  if (!nonce && chain !== "sui") throw new Error(`${key}: memory text has no nonce`);
  const c = candidates(chain).find((x) => x.fail === failed);
  const cls = classifyWallet({
    chain, nonce: nonce ? Number(nonce[1]) : undefined, retryNonce: nonce ? Number(nonce[2]) : undefined, retryBlocks: Number(later[1]),
    calls: c?.total, fails: c?.fails, scanBlocks: c?.scanBlocks ?? scans[chain],
  });
  out[key] = { wallet: m.text.match(/wallet=(0x[0-9a-f]+)/)![1], ...cls };
  console.log(`${chain.padEnd(8)} ${failed.slice(0, 12)} ${cls.label.padEnd(10)} ${cls.reasons.join("; ")}`);
}
writeFileSync("fixtures/wallet-classes.json", JSON.stringify(out, null, 2) + "\n");
const count = (l: WalletClass["label"]) => Object.values(out).filter((c) => c.label === l).length;
console.log(`${Object.keys(out).length} memories: ${count("human-like")} human-like, ${count("bot-like")} bot-like, ${count("unclassified")} unclassified`);
