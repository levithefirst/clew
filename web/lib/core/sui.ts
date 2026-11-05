// GENERATED from src/sui.ts by web/scripts/sync-core.mjs. Do not edit here; edit src/ and run `npm run sync-core` in web/.
// Sui adapter: the same loop (failure -> successful retry -> memory -> recall) on Sui Mainnet through Tatum's Sui
// gateway, which serves GraphQL only (POST /graphql, one operation per request). Mapping onto the EVM loop:
//   wallet   = sender
//   contract = the called package::module that best matches the abort location (see primaryCall)
//   block    = checkpoint
//   calldata = Pure inputs (BCS bytes, shown as hex); object inputs are not compared
//   revert   = executionError: moveabort:<module>::<function>:<abortCode>, where module/function are where it aborted,
//              which can differ from the functions the transaction called.
// Status: verified on Sui Mainnet on 2026-10-31 (sui:check passed, two memories written, one real recall returned
// the prior path). Field names follow Sui's GraphQL schema (crates/sui-indexer-alt-graphql/schema.graphql).
import { graphql } from "./tatum.ts";
import { isOutOfGas, memoryKey, recallFor, type FailureLike } from "./clew.ts";
import { walrus, type MemoryStore } from "./memory.ts";

export const SUI = "sui";

/** Every field the adapter reads. Shared by single-transaction and list queries so sui:check verifies them all. */
export const TX_FIELDS = `
fragment TxFields on Transaction {
  digest
  sender { address }
  gasInput { gasBudget gasPrice }
  effects {
    status
    checkpoint { sequenceNumber }
    executionError { abortCode message instructionOffset module { name package { address } } function { name } }
    gasEffects { gasSummary { computationCost storageCost storageRebate } }
  }
  kind {
    __typename
    ... on ProgrammableTransaction {
      commands(first: 20) { nodes { __typename ... on MoveCallCommand { function { name module { name package { address } } } } } }
      inputs(first: 20) { nodes { __typename ... on Pure { bytes } } }
    }
  }
}`;

const TX_QUERY = `query ($digest: String!) { transaction(digest: $digest) { ...TxFields } }\n${TX_FIELDS}`;
const LIST_QUERY = `query ($first: Int, $last: Int, $after: String, $filter: TransactionFilter) {
  transactions(first: $first, last: $last, after: $after, filter: $filter) { pageInfo { hasNextPage endCursor } nodes { ...TxFields } }
}\n${TX_FIELDS}`;

export interface SuiCall { package: string; module: string; function: string }

export interface SuiAttempt extends FailureLike {
  status: "success" | "failure";
  checkpoint: number;
  /** Gas budget and price set by the sender; gasUsed is computation + storage - rebate, in MIST. */
  gasLimit: number;
  gasUsed: number;
  gasPrice: number;
  calls: SuiCall[];
  /** Inputs in order: Pure values as hex BCS bytes, others by their GraphQL type name. */
  inputs: string[];
  abort?: SuiCall & { code: string };
}

type Raw = any;
const n = (v: unknown) => Number(v ?? 0);
const lc = (s: unknown) => String(s ?? "").toLowerCase();
const modulePath = (c: { package: string; module: string }) => `${c.package}::${c.module}`;

/**
 * The call that identifies "the same contract" for retries: the called module where the abort happened, else a
 * called module in the abort's package, else the last Move call. Without a command list, the abort location itself.
 */
export function primaryCall(calls: SuiCall[], abort?: SuiCall): SuiCall | undefined {
  if (abort) return calls.find((c) => modulePath(c) === modulePath(abort)) ?? calls.find((c) => c.package === abort.package) ?? calls.at(-1) ?? abort;
  return calls.at(-1);
}

export function suiErrorSignature(abort: (SuiCall & { code: string }) | undefined, message: string | undefined, fallbackFn: string): string {
  if (abort) return `moveabort:${abort.module}::${abort.function}:${abort.code}`;
  if (/insufficient ?gas|out of gas/i.test(message ?? "")) return `out-of-gas:${fallbackFn}`; // Sui reports "Insufficient Gas"
  return message ? `sui:${message.toLowerCase().replace(/0x[0-9a-f]+/g, "0x_").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)}` : `${fallbackFn}:failed`;
}

export function toSuiAttempt(raw: Raw): SuiAttempt {
  const fx = raw.effects ?? {};
  const err = fx.executionError;
  const calls: SuiCall[] = (raw.kind?.commands?.nodes ?? [])
    .filter((c: Raw) => c.__typename === "MoveCallCommand" && c.function)
    .map((c: Raw) => ({ package: lc(c.function.module.package.address), module: c.function.module.name, function: c.function.name }));
  const abort = err?.module && err?.function
    ? { package: lc(err.module.package?.address), module: err.module.name, function: err.function.name, code: String(err.abortCode ?? "") }
    : undefined;
  const main = primaryCall(calls, abort);
  const g = fx.gasEffects?.gasSummary ?? {};
  const a: SuiAttempt = {
    chain: SUI, hash: raw.digest, wallet: lc(raw.sender?.address),
    contract: main ? modulePath(main) : lc(raw.kind?.__typename), selector: main?.function ?? "none",
    status: fx.status === "SUCCESS" ? "success" : "failure", checkpoint: n(fx.checkpoint?.sequenceNumber),
    gasLimit: n(raw.gasInput?.gasBudget), gasPrice: n(raw.gasInput?.gasPrice),
    gasUsed: n(g.computationCost) + n(g.storageCost) - n(g.storageRebate),
    calls, abort,
    inputs: (raw.kind?.inputs?.nodes ?? []).map((i: Raw) => (i.__typename === "Pure" && i.bytes ? "0x" + Buffer.from(i.bytes, "base64").toString("hex") : i.__typename)),
  };
  if (a.status === "failure") {
    a.errorSig = suiErrorSignature(abort, err?.message, a.selector);
    a.errorDetail = err?.message ?? "failed, no execution error";
  }
  return a;
}

export async function loadSuiAttempt(digest: string): Promise<SuiAttempt> {
  const data = await graphql(TX_QUERY, { digest });
  if (!data?.transaction) throw new Error(`sui tx ${digest} not found`);
  return toSuiAttempt(data.transaction);
}

/** One page of transactions. `last` reads the newest end of the range; `first` + `after` page forward. */
export async function listSuiTransactions(vars: { first?: number; last?: number; after?: string | null; filter?: Record<string, unknown> }) {
  const data = await graphql(LIST_QUERY, vars);
  const page = data?.transactions;
  return { attempts: (page?.nodes ?? []).map(toSuiAttempt) as SuiAttempt[], hasNextPage: Boolean(page?.pageInfo?.hasNextPage), endCursor: page?.pageInfo?.endCursor ?? null };
}

/**
 * The sender's first SUCCESS that calls the same package::module after the failure, within `windowCheckpoints`.
 * One server-side filter (sender + module + from the failure's checkpoint on), paged oldest-first; transactions in
 * the failure's own checkpoint count only once the failure itself has been passed.
 */
export async function findSuiRetry(f: SuiAttempt, windowCheckpoints = 3_000, maxPages = 5): Promise<string | null> {
  const filter = { sentAddress: f.wallet, function: f.contract, afterCheckpoint: Math.max(0, f.checkpoint - 1) };
  let after: string | null = null, passed = false;
  for (let page = 0; page < maxPages; page++) {
    const res = await listSuiTransactions({ first: 50, after, filter });
    for (const a of res.attempts) {
      if (a.checkpoint - f.checkpoint > windowCheckpoints) return null;
      if (a.hash === f.hash || a.checkpoint > f.checkpoint) passed = true;
      if (a.hash !== f.hash && passed && a.status === "success" && a.calls.some((c) => modulePath(c) === f.contract)) return a.hash;
    }
    if (!res.hasNextPage) break;
    after = res.endCursor;
  }
  return null;
}

const clip = (v: string) => (v.length > 24 ? `${v.slice(0, 12)}…${v.slice(-6)}` : v);

/**
 * Only Pure inputs carry comparable values (their BCS bytes); object inputs are known only by type, so they are not
 * compared and the memory says so instead of claiming the inputs were identical.
 */
const isPure = (v: string | undefined) => v?.startsWith("0x") ?? false;

export function suiMemoryText(f: SuiAttempt, s: SuiAttempt): string {
  const pure = f.inputs.filter(isPure).length;
  const changed = f.inputs.map((v, i) => ({ i, from: v, to: s.inputs[i] })).filter((x) => isPure(x.from) && x.from !== x.to);
  const sameCalls = f.calls.map((c) => `${modulePath(c)}::${c.function}`).join(",") === s.calls.map((c) => `${modulePath(c)}::${c.function}`).join(",");
  const oog = isOutOfGas(f.errorSig, f.gasUsed, f.gasLimit);
  const detail = (f.errorDetail ?? "").slice(0, 120);
  const changes = [
    `gas used was ${s.gasUsed} vs ${f.gasUsed} on failure`, `gas limit ${s.gasLimit} vs ${f.gasLimit}`, `gas price ${s.gasPrice} vs ${f.gasPrice} MIST`,
    sameCalls ? `same ${f.calls.length} Move call(s)` : `Move calls ${f.calls.map((c) => `${c.module}::${c.function}`).join(",") || "none"} -> ${s.calls.map((c) => `${c.module}::${c.function}`).join(",") || "none"}`,
    `inputs ${f.inputs.length} -> ${s.inputs.length}, ${pure} Pure (object inputs not compared)`,
    changed.length ? `${changed.length} pure input(s) changed (` + changed.slice(0, 3).map((c) => `input ${c.i} ${clip(c.from)} -> ${clip(c.to ?? "∅")}`).join(", ") + ")" : "pure inputs identical",
  ].join("; ");
  const next = [
    oog ? `out of gas: retry used gas limit ${s.gasLimit} (failed with limit ${f.gasLimit}, retry used ${s.gasUsed}); consider gas limit >= ${s.gasLimit}` : `reason: ${detail} (used ${f.gasUsed} of ${f.gasLimit} gas, not out of gas)`,
    ...(changed.length ? [`change inputs: ` + changed.slice(0, 3).map((c) => `input ${c.i} = ${clip(c.to ?? "∅")} (was ${clip(c.from)})`).join("; ")] : []),
    `template tx ${s.hash}`,
  ].join("; ");
  return `CLEW chain=${SUI} contract=${f.contract} wallet=${f.wallet} error=${f.errorSig} selector=${f.selector} failed_tx=${f.hash} success_tx=${s.hash} success_block=${s.checkpoint}. ` +
    `Contract ${f.contract} on ${SUI} failed with error ${f.errorSig} (${detail}) for wallet ${f.wallet}. ` +
    `Successful retry in tx ${s.hash} at block ${s.checkpoint}, ${s.checkpoint - f.checkpoint} blocks later. Change: ${changes}. NEXT_ACTION: ${next}`;
}

export async function recordSuiRetry(failed: string, success: string, store: MemoryStore = walrus) {
  const f = await loadSuiAttempt(failed), s = await loadSuiAttempt(success);
  if (f.status !== "failure") throw new Error(`${failed} succeeded, not a failure`);
  if (s.status !== "success") throw new Error(`${success} is not a success`);
  if (s.wallet !== f.wallet || !s.calls.some((c) => modulePath(c) === f.contract)) throw new Error("retry must be the same sender calling the same package::module");
  if (s.checkpoint < f.checkpoint) throw new Error("retry must come after the failure");
  const text = suiMemoryText(f, s);
  return { failure: f, success: s, text, ...(await store.remember(text, memoryKey(SUI, f.hash, s.hash))) };
}

export async function onSuiFailure(digest: string, opts: { store?: MemoryStore; namespace?: string } = {}) {
  const f = await loadSuiAttempt(digest);
  if (f.status !== "failure") throw new Error(`${digest} succeeded, not a failure`);
  return recallFor(f, opts);
}
