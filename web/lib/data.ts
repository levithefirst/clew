import raw from "@/data/clew.json";
import { gateGasHints, parseNextAction, type NextAction } from "@/lib/advice";

// Everything here is derived from the core's real artifacts (memories.json, demo-output.txt, fixtures/pairs.json)
// by scripts/build-data.mjs. Nothing is fabricated or fetched at runtime.

export type Chain = "base" | "ethereum" | "polygon" | "sui";
export type Pair = { failed: number; success: number } | null;
export interface Memory {
  key: string;
  chain: Chain;
  contract: string;
  wallet: string;
  error: string;
  error_detail: string | null;
  selector: string;
  failed_tx: string;
  success_tx: string;
  success_block: number | null;
  blocks_later: number | null;
  next_failure: string | null;
  job_id: string;
  blob_id: string;
  namespace: string;
  written_at: string;
  diff: {
    gasUsed: Pair;
    gasLimit: Pair;
    nonce: Pair;
    selector: { failed: string; success: string } | null;
    argsChanged: number;
    args: { index: number; from: string; to: string }[];
  };
  next_action: string | null;
  text: string;
  /** Heuristic from src/classify.ts. "human-like" means no automation signal was seen, not a verified person. */
  wallet_class: { label: "bot-like" | "human-like" | "unclassified"; reasons: string[] };
  rev: number;
  supersedes: string | null;
}
export interface Recall {
  chain: Chain;
  failure_tx: string;
  error: string;
  /** null when only the with-memory recall was run for this failure. */
  without_memory: string | null;
  with_memory: { prior_success: string; block: number; blob_id: string; change: string; next_action: string };
  memory_key: string;
  /** Which real run produced this recall. */
  source: string;
}

export const DATA = raw as unknown as {
  stats: {
    memories: number;
    chains: number;
    chain_names: Chain[];
    per_chain: Record<Chain, number>;
    distinct_contracts: number;
    recalls: number;
    human_like: number;
    bot_like: number;
    namespace: string;
    relayer: string;
  };
  memories: Memory[];
  recalls: Recall[];
  counterfactual: { wallet: string; contract: string; result: string } | null;
};

export const CHAIN_LABEL: Record<Chain, string> = { base: "Base", ethereum: "Ethereum", polygon: "Polygon", sui: "Sui" };

const EXPLORER: Record<Chain, string> = {
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
  polygon: "https://polygonscan.com",
  sui: "https://suiscan.xyz/mainnet",
};
export const explorerName: Record<Chain, string> = { base: "Basescan", ethereum: "Etherscan", polygon: "Polygonscan", sui: "Suiscan" };
export const txUrl = (c: Chain, h: string) => `${EXPLORER[c]}/tx/${h}`;
/** Sui: a "contract" is package::module, linked as the package object; a wallet is an account. */
export const addrUrl = (c: Chain, a: string) =>
  c === "sui" ? `${EXPLORER[c]}/${a.includes("::") ? `object/${a.split("::")[0]}` : `account/${a}`}` : `${EXPLORER[c]}/address/${a}`;
/** Sui counts checkpoints, not blocks. */
export const blockWord = (c: Chain) => (c === "sui" ? "checkpoint" : "block");
/** Walruscan Mainnet blob page. Clew memories are SEAL-encrypted: the page proves the blob exists, not its text. */
export const blobUrl = (id: string) => `https://walruscan.com/mainnet/blob/${id}`;

/** The headline example: the first demo recall (build-data puts human-like wallets first). */
export const HERO = (() => {
  const r = DATA.recalls[0];
  const m = DATA.memories.find((x) => x.key === r.memory_key)!;
  return { recall: r, memory: m };
})();

/** A memory's next action as recall returns it: parsed from the stored text, with the out-of-gas gate applied. */
export function nextActionOf(m: Memory): NextAction | null {
  if (!m.next_action) return null;
  return gateGasHints(parseNextAction(m.next_action), {
    errorSig: m.error,
    errorDetail: m.error_detail,
    gasUsed: m.diff.gasUsed?.failed,
    gasLimit: m.diff.gasLimit?.failed,
  });
}
