// The website's API routes need the core (Tatum reads, Walrus recall, the Try it logic). Vercel builds web/ with its
// own `npm install` and nothing above it, so the core cannot be imported from ../src. This vendors the modules into
// web/lib/core/, byte for byte below a header. tests/core-sync.test.ts fails if the copies drift.
//   node web/scripts/sync-core.mjs           rewrite web/lib/core/
//   node web/scripts/sync-core.mjs --check   exit 1 if anything is out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FILES = ["tatum", "memory", "clew", "sui", "reasons", "explain", "agent", "measure"];
const target = (name) => join(root, "web", "lib", "core", `${name}.ts`);
export const expected = (name) =>
  `// GENERATED from src/${name}.ts by web/scripts/sync-core.mjs. Do not edit here; edit src/ and run \`npm run sync-core\` in web/.\n` +
  readFileSync(join(root, "src", `${name}.ts`), "utf8");

export function stale() {
  return FILES.filter((n) => !existsSync(target(n)) || readFileSync(target(n), "utf8") !== expected(n));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const bad = stale();
    if (bad.length) { console.error(`out of date: ${bad.join(", ")}. Run: npm run sync-core (in web/)`); process.exit(1); }
    console.log("web/lib/core is up to date");
  } else {
    mkdirSync(join(root, "web", "lib", "core"), { recursive: true });
    for (const n of FILES) writeFileSync(target(n), expected(n));
    console.log(`vendored ${FILES.join(", ")} into web/lib/core/`);
  }
}
