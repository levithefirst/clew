// Discovery only: scan recent blocks via Tatum eth_getBlockReceipts for real
// fail -> later success (same from -> same to) sequences. Writes fixtures/candidates-<chain>.json.
import { writeFileSync, mkdirSync } from "node:fs";
import { blockNumber, getBlockReceipts } from "../src/tatum.ts";

const chain = process.argv[2] ?? "base";
const span = Number(process.argv[3] ?? 150);
const window = Number(process.argv[4] ?? 300); // blocks (~10 min on 2s chains)

const head = (await blockNumber(chain)) - 5;
const seq = new Map<string, { hash: string; block: number; ok: boolean; gasUsed: number }[]>();
for (let b = head - span; b <= head; b++) {
  const rs = (await getBlockReceipts(chain, b)) ?? [];
  for (const r of rs) {
    if (!r.to) continue;
    const k = `${r.from.toLowerCase()}|${r.to.toLowerCase()}`;
    if (!seq.has(k)) seq.set(k, []);
    seq.get(k)!.push({ hash: r.transactionHash, block: b, ok: r.status === "0x1", gasUsed: parseInt(r.gasUsed, 16) });
  }
  if ((b - head + span) % 25 === 0) process.stderr.write(`${chain} block ${b} keys=${seq.size}\n`);
}
const out: any[] = [];
for (const [k, list] of seq) {
  const i = list.findIndex((x) => !x.ok);
  if (i < 0) continue;
  const fail = list[i];
  const succ = list.slice(i + 1).find((x) => x.ok && x.block - fail.block <= window && x.block > fail.block);
  if (!succ) continue;
  const fails = list.filter((x) => !x.ok).length;
  const later = list.filter((x) => !x.ok && x.block > succ.block).map((x) => x.hash);
  const [wallet, contract] = k.split("|");
  out.push({ chain, wallet, contract, fail: fail.hash, failBlock: fail.block, success: succ.hash, successBlock: succ.block, fails, laterFails: later.slice(0, 3), total: list.length });
}
out.sort((a, b) => b.laterFails.length - a.laterFails.length);
mkdirSync("fixtures", { recursive: true });
writeFileSync(`fixtures/candidates-${chain}.json`, JSON.stringify(out, null, 2));
console.log(`${chain}: scanned ${span + 1} blocks, ${out.length} fail->success candidates, ${out.filter((x) => x.laterFails.length).length} with a later failure`);
