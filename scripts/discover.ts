// Discovery only: scan blocks via Tatum eth_getBlockReceipts for real fail -> later success sequences
// (same from -> same to). Results merge into fixtures/candidates-<chain>.json, so repeated runs over different
// ranges widen the pool instead of replacing it.
//   npx tsx scripts/discover.ts <chain> [span=150] [window=300] [--to <block>]
//   span    blocks to scan, ending at --to (default: head - 5)
//   window  max blocks between a failure and its successful retry
// Each candidate records the scanned range it came from (scanFrom, scanBlocks): the classifier's repeat-call
// signal uses it as the observation window.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { blockNumber, getBlockReceipts } from "../src/tatum.ts";

const args = process.argv.slice(2);
const toAt = args.indexOf("--to");
const [chain = "base", spanArg = "150", windowArg = "300"] = args.filter((a, i) => !a.startsWith("--") && (toAt < 0 || i !== toAt + 1));
const span = Number(spanArg), window = Number(windowArg);
const to = toAt < 0 ? (await blockNumber(chain)) - 5 : Number(args[toAt + 1]);
const from = to - span;

const seq = new Map<string, { hash: string; block: number; ok: boolean }[]>();
for (let b = from; b <= to; b++) {
  const rs = (await getBlockReceipts(chain, b)) ?? [];
  for (const r of rs) {
    if (!r.to) continue;
    const k = `${r.from.toLowerCase()}|${r.to.toLowerCase()}`;
    if (!seq.has(k)) seq.set(k, []);
    seq.get(k)!.push({ hash: r.transactionHash, block: b, ok: r.status === "0x1" });
  }
  if ((b - from) % 25 === 0) process.stderr.write(`${chain} block ${b} keys=${seq.size}\n`);
}

const found: any[] = [];
for (const [k, list] of seq) {
  const i = list.findIndex((x) => !x.ok);
  if (i < 0) continue;
  const fail = list[i];
  const succ = list.slice(i + 1).find((x) => x.ok && x.block > fail.block && x.block - fail.block <= window);
  if (!succ) continue;
  const [wallet, contract] = k.split("|");
  found.push({
    chain, wallet, contract, fail: fail.hash, failBlock: fail.block, success: succ.hash, successBlock: succ.block,
    fails: list.filter((x) => !x.ok).length, laterFails: list.filter((x) => !x.ok && x.block > succ.block).map((x) => x.hash).slice(0, 3),
    total: list.length, scanFrom: from, scanBlocks: span + 1,
  });
}

const file = `fixtures/candidates-${chain}.json`;
const known: any[] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
const seen = new Set(known.map((c) => c.fail));
const added = found.filter((c) => !seen.has(c.fail));
const merged = [...known, ...added].sort((a, b) => b.laterFails.length - a.laterFails.length);
mkdirSync("fixtures", { recursive: true });
writeFileSync(file, JSON.stringify(merged, null, 2) + "\n");
console.log(`${chain}: scanned blocks ${from}..${to}, ${found.length} fail->success candidates (${added.length} new), ` +
  `${found.filter((x) => x.laterFails.length).length} with a later failure; ${merged.length} candidates on file`);
