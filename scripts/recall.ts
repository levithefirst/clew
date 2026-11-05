// The /v1/recall logic from the command line (same code the endpoint runs). LIVE: needs TATUM_API_KEY, MEMWAL_KEY,
// MEMWAL_ACCOUNT_ID; a Sui digest also needs CLEW_SUI_LIVE=1.
//   npm run recall -- base 0xd72b…
import { agentRecall } from "../src/agent.ts";

const [chain, failedTxHash] = process.argv.slice(2);
if (!chain || !failedTxHash) { console.error("usage: npm run recall -- <chain> <failedTxHash>"); process.exit(2); }
console.log(JSON.stringify(await agentRecall({ chain, failedTxHash }), null, 2));
