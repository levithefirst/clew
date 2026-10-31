// CLI: npm run live-demo [-- --dry-run] [--address 0x...]
//   Real run (needs DEMO_PRIVATE_KEY, TATUM_API_KEY, MEMWAL_KEY, MEMWAL_ACCOUNT_ID): sends the failure, the retry and the
//   next failure on Base Mainnet, writes the memory to Walrus, prints recall without and with memory.
//   --dry-run: simulates every step with eth_call and prints what would be sent. Needs TATUM_API_KEY plus either
//   DEMO_PRIVATE_KEY (only to derive the address) or --address. Sends nothing, writes nothing.
// The private key is read from the environment only, never printed or logged; only the derived address is shown.
import { privateKeyToAccount } from "viem/accounts";
import { rpc as tatum } from "../src/tatum.ts";
import { walrus } from "../src/memory.ts";
import { dryRun, runLive, type Rpc, type Signer } from "../src/live.ts";

const args = process.argv.slice(2);
const at = args.indexOf("--address");
const rpc: Rpc = (method, params) => tatum("base", method, params);

function signerFromEnv(): Signer | null {
  const raw = process.env.DEMO_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("DEMO_PRIVATE_KEY is not a 32-byte hex key (value not shown)");
  const account = privateKeyToAccount(key);
  return {
    address: account.address,
    sign: (tx) => account.signTransaction({ type: "eip1559", ...tx, to: tx.to as `0x${string}`, data: tx.data as `0x${string}` }),
  };
}

try {
  const signer = signerFromEnv();
  if (args.includes("--dry-run")) {
    const address = at >= 0 ? args[at + 1] : signer?.address;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("dry run needs --address 0x... or DEMO_PRIVATE_KEY");
    await dryRun(rpc, address, console.log);
  } else {
    if (!signer) throw new Error("DEMO_PRIVATE_KEY is not set (use --dry-run to simulate without it)");
    await runLive({ rpc, signer, store: walrus, log: console.log });
  }
} catch (e: any) {
  console.error(`live-demo: ${e.message}`);
  process.exit(1);
}
