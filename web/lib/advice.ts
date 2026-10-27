// Turn the stored NEXT_ACTION string into short, readable lines (pure string parsing of real data).
export function adviceLines(nextAction: string, max = 4): string[] {
  const parts = nextAction
    .split(/;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^template tx/.test(s));
  const out: string[] = [];
  for (const p of parts) {
    const reenc = p.match(/^(?:re-encode calldata: )?arg word (\d+) = (\S+) \(was (\S+)\)/);
    if (reenc) {
      out.push(`re-encode arg ${reenc[1]} → ${clip(reenc[2])}`);
      continue;
    }
    const gp = p.match(/bid gas price >= (\d+) wei \(failed at (\d+)\)/);
    if (gp) {
      out.push(`bid gas price ≥ ${Number(gp[1]).toLocaleString("en-US")} wei (failed at ${Number(gp[2]).toLocaleString("en-US")})`);
      continue;
    }
    const gl = p.match(/raise gas limit to >= (\d+)/);
    if (gl) {
      out.push(`raise gas limit to ≥ ${Number(gl[1]).toLocaleString("en-US")}`);
      continue;
    }
    const fn = p.match(/call (0x[0-9a-f]+) instead of (0x[0-9a-f]+)/);
    if (fn) {
      out.push(`call ${fn[1]} instead of ${fn[2]}`);
      continue;
    }
    const more = p.match(/\+(\d+) more words differ/);
    if (more) {
      out.push(`+${more[1]} more calldata word${more[1] === "1" ? "" : "s"} — rebuild params like the retry`);
      continue;
    }
    out.push(p.replace(/ — rebuild params like tx \S+/, ""));
  }
  return out.slice(0, max);
}

export function clip(hex: string, n = 20) {
  if (hex.includes("…")) return hex;
  const t = hex.replace(/^0x/, "");
  return t.length > n ? `0x${t.slice(0, 10)}…${t.slice(-6)}` : hex;
}
