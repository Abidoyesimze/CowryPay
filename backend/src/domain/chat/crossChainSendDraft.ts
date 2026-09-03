import { walletsRepo } from "../wallets/repository.js";
import { ledgerRepo } from "../ledger/repository.js";
import { isValidAddressForChain } from "../cryptoWithdrawals/addressValidation.js";
import { walletChainKeyFor } from "../cryptoWithdrawals/service.js";
import { computeCrossChainSendFeeSplit } from "../offramp/fee.js";
import { getTokenConfig } from "../wallets/chains.js";
import { getBridgeAdapter } from "../crossChainSend/bridge/index.js";
import { env } from "../../config/env.js";
import { formatAmount } from "../../utils/format.js";
import type { ParsedIntent } from "./schemas.js";

// Celo is the ONLY source now (Agents at Work hackathon narrowing — see
// crossChainSend/service.ts's own sourceChain guard), so the agent only
// ever needs to extract a DESTINATION chain from natural language, never
// ask the user to name where the funds currently are. Must stay in sync
// with liFiAdapter.ts's own SUPPORTED_CHAINS (minus "celo" itself, which
// isn't a valid destination for its own cross-chain send). Solana was
// dropped 2026-09-03 — confirmed live against LI.FI's own quote API that
// no route exists from Celo to Solana for USDC or USDT right now (a real
// bridge-liquidity gap, not a bug here); see liFiAdapter.ts's own comment.
export const DESTINATION_CHAINS = ["base", "optimism"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface CrossChainSendDraft {
  amount: string;
  toAddress: string;
  sourceChain: string;
  destinationChain: string;
  tokenSymbol: string;
}

export type CrossChainSendIntent = Extract<ParsedIntent, { kind: "crossChainSend" }>;

export type CrossChainSendResolution =
  | { ok: true; draft: CrossChainSendDraft; summary: string }
  | { ok: false; message: string };

// Mirrors cryptoWithdrawalDraft.ts's mergeCryptoWithdrawalDrafts — new
// non-empty values win, missing ones fall back to what's already known
// from an earlier message in the same multi-turn exchange.
//
// toAddress is the one field NOT carried forward unconditionally — real
// incident this closes: a draft that never resolves (e.g. stuck retrying
// a quote failure) can sit alive for days, since touchSession refreshes
// the idle timer on ANY later message without clearing it. If a later,
// unrelated request then names a genuinely different destinationChain
// without repeating the address, blindly reusing the OLD address (meant
// for a different chain) risks exactly the §9 "wrong destination is
// unrecoverable" failure this whole flow exists to prevent. Dropped (not
// carried over) whenever destinationChainHint is both present and
// actually different from what the stale draft had; a genuinely
// continuing conversation (same chain, still filling in the address) is
// unaffected.
export function mergeCrossChainSendDrafts(
  existing: CrossChainSendIntent,
  incoming: CrossChainSendIntent,
): CrossChainSendIntent {
  const destinationChanged =
    incoming.destinationChainHint != null &&
    existing.destinationChainHint != null &&
    incoming.destinationChainHint.toLowerCase() !== existing.destinationChainHint.toLowerCase();
  return {
    kind: "crossChainSend",
    action: "SEND_CROSS_CHAIN",
    amount: incoming.amount ?? existing.amount,
    toAddress: incoming.toAddress ?? (destinationChanged ? undefined : existing.toAddress),
    sourceChainHint: incoming.sourceChainHint ?? existing.sourceChainHint,
    destinationChainHint: incoming.destinationChainHint ?? existing.destinationChainHint,
    tokenHint: incoming.tokenHint ?? existing.tokenHint,
  };
}

// The one thing this must never do is trust a parsed address as final —
// same §9 boundary as cryptoWithdrawalDraft.ts (see its own comment on
// why). This only ever produces a DRAFT: the frontend shows it back to
// the user in full (both chains, the exact address, the fee, the
// estimate) for explicit review before they enter their PIN and the app
// calls the real, unchanged POST /cross-chain-sends endpoint directly —
// chat never calls it, and the PIN gate is unchanged even though the
// agent is now the one assembling this draft.
export async function resolveCrossChainSendIntent(
  userId: string,
  intent: CrossChainSendIntent,
): Promise<CrossChainSendResolution> {
  if (intent.amount == null || intent.amount <= 0) {
    return { ok: false, message: "How much USDC would you like to send?" };
  }
  // Same floor the real POST /cross-chain-sends endpoint enforces (see
  // env.ts's own comment) — checked here too so a too-small amount gets
  // caught on the first message of a multi-turn draft, not after the user
  // has already answered every other question.
  if (intent.amount < Number(env.crossChainSendMinAmountUsd)) {
    return {
      ok: false,
      message: `${intent.amount} is below the ${env.crossChainSendMinAmountUsd} ${env.defaultTokenSymbol} minimum for a cross-chain send — try a larger amount.`,
    };
  }
  if (!intent.toAddress) {
    return { ok: false, message: "What's the destination wallet address?" };
  }

  // Source is always Celo — if the user named a different chain as where
  // their funds currently are, that's simply wrong (nothing else holds a
  // balance), so it's called out rather than silently overridden.
  const sourceChain = "celo";
  if (intent.sourceChainHint && intent.sourceChainHint.toLowerCase() !== "celo") {
    return {
      ok: false,
      message: `Your balance is on Celo — cross-chain send always starts from there. Which chain would you like to send to: ${DESTINATION_CHAINS.map(capitalize).join(", ")}?`,
    };
  }

  const destinationChain = intent.destinationChainHint?.toLowerCase();
  if (destinationChain && !DESTINATION_CHAINS.includes(destinationChain)) {
    return {
      ok: false,
      message: `"${intent.destinationChainHint}" isn't a chain cross-chain send supports yet. Which one: ${DESTINATION_CHAINS.map(capitalize).join(", ")}?`,
    };
  }
  if (!destinationChain) {
    return { ok: false, message: `Which chain would you like it sent to: ${DESTINATION_CHAINS.map(capitalize).join(", ")}?` };
  }

  // Checked before anything else chain-specific — a pair the bridge layer
  // doesn't support yet should fail clean here, not partway through
  // balance/fee checks.
  const bridge = getBridgeAdapter(sourceChain, destinationChain);
  if (!bridge.supports(sourceChain, destinationChain)) {
    return {
      ok: false,
      message: `Sending from Celo to ${capitalize(destinationChain)} isn't supported yet.`,
    };
  }

  if (!isValidAddressForChain(destinationChain, intent.toAddress)) {
    return {
      ok: false,
      message: `"${intent.toAddress}" doesn't look like a valid ${capitalize(destinationChain)} address — double-check it and send it again.`,
    };
  }

  // Omitted means USDC, the only token that existed before USDT support.
  const tokenSymbol = intent.tokenHint?.toUpperCase() ?? env.defaultTokenSymbol;
  try {
    getTokenConfig(sourceChain, tokenSymbol);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }

  const wallet = await walletsRepo.findByUserIdAndChain(userId, walletChainKeyFor(sourceChain));
  if (!wallet) {
    return { ok: false, message: `You don't have a wallet on ${capitalize(sourceChain)} yet.` };
  }

  const amountStr = intent.amount.toString();
  const balances = await ledgerRepo.getBalancesForUser(userId);
  const balance = balances.find((b) => b.chain === sourceChain && b.tokenSymbol === tokenSymbol);
  if (!balance || Number(balance.availableBalance) < intent.amount) {
    // Postgres numeric columns come back full-precision — trimmed for a
    // user-facing message the same way every other balance display in
    // this codebase already does (see formatAmount's own comment).
    const available = formatAmount(balance?.availableBalance ?? "0");
    return {
      ok: false,
      message: `You only have ${available} ${tokenSymbol} available on ${capitalize(sourceChain)} — that's less than the ${amountStr} you asked to send.`,
    };
  }

  // Same split the real POST /cross-chain-sends endpoint computes — see
  // offramp/fee.ts's own comment on why this is a smaller, dedicated
  // floor rather than reusing computeCryptoWithdrawalFeeSplit. Shown here
  // up front so it's not a surprise at PIN-entry time. A null split means
  // the amount can't even cover the minimum fee.
  const split = computeCrossChainSendFeeSplit(amountStr);
  if (!split) {
    return {
      ok: false,
      message: `${amountStr} ${tokenSymbol} is too small to send cross-chain — it wouldn't cover the minimum ${env.crossChainSendMinFeeUsd} ${tokenSymbol} fee. Try a larger amount.`,
    };
  }

  // A quote failure here (RPC hiccup, route temporarily unavailable) is
  // shown as a retryable message, not a hard error — nothing's been
  // touched yet (no debit, no draft saved as final).
  let quote;
  try {
    quote = await bridge.quote({ sourceChain, destinationChain, tokenSymbol, amount: split.netAmount });
  } catch (err) {
    return {
      ok: false,
      message: `Couldn't get a quote for that route right now (${err instanceof Error ? err.message : String(err)}) — try again in a moment.`,
    };
  }

  const draft: CrossChainSendDraft = { amount: amountStr, toAddress: intent.toAddress, sourceChain, destinationChain, tokenSymbol };
  const etaMinutes = Math.max(1, Math.round(quote.estimatedSeconds / 60));

  return {
    ok: true,
    draft,
    summary: `Ready to send ${amountStr} ${tokenSymbol} from Celo to ${intent.toAddress} on ${capitalize(destinationChain)}. Fee: ${split.feeAmount} ${tokenSymbol} — you'll receive approximately ${quote.destinationAmount} ${tokenSymbol} (the exact amount can vary slightly on this route). Estimated time: ~${etaMinutes} minute${etaMinutes === 1 ? "" : "s"}. Double-check that address and chain carefully — crypto sent cross-chain to the wrong address can't be recovered. Confirm in the app to enter your PIN and complete it.`,
  };
}
