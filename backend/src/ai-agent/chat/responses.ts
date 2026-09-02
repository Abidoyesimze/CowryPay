import type { CrossChainSend, CrossChainSendState, Deposit, DepositState, LedgerBalance, Send, SendState, Wallet } from "../../types.js";
import { formatAmount } from "../../utils/format.js";
import { DESTINATION_CHAINS } from "../../domain/chat/crossChainSendDraft.js";
import { DEPOSIT_CHAINS } from "./intent.js";

// "Celo, Base, and Optimism" / "Celo or Base" / "Celo" — grammatically
// correct regardless of how many chains are in the list, so removing (or
// adding) one is just an edit to DEPOSIT_CHAINS, never prose anywhere
// else. conjunction is "and" for "these all share X" framing (buildChainsMessage)
// vs "or" for "pick one of these" framing (buildHelpMessage) — same list,
// different grammar depending on which claim is being made about it.
export function formatChainList(chains: readonly string[], conjunction: "and" | "or" = "and"): string {
  const names = chains.map(capitalize);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ${conjunction} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, ${conjunction} ${names[names.length - 1]}`;
}

// Celo-only deposits now (Agents at Work hackathon narrowing) — no more
// "which chain do you want to deposit to" disambiguation.
export function buildWelcomeMessage(): string {
  return [
    "Welcome to CowryPay! 👋",
    "",
    `Say "I want to deposit" whenever you're ready to fund your account — I'll get you your Celo address.`,
    "",
    `Ask me things like "what's my balance" or say "help" to see what I can do.`,
  ].join("\n");
}

// `chain` defaults to wallet.chain (always Celo now), kept as a param so a
// caller that already knows the answer doesn't need a second lookup.
export function buildAddressMessage(wallet: Wallet, chain?: string): string {
  return [
    "Your CowryPay deposit address:",
    `${wallet.address} (${capitalize(chain ?? wallet.chain)})`,
    "",
    "Send USDC here — deposits are usually credited within moments of confirming on-chain.",
  ].join("\n");
}

// Celo is the only deposit chain now — no per-chain disambiguation left to
// describe (that used to differ for Stellar's shared/memo'd address vs.
// Solana's own separate one; both are gone).
export function buildChainsMessage(wallet: Wallet): string {
  return `You can deposit USDC on Celo: ${wallet.address}.`;
}

// Answers "which chains does cross-chain send support" — deliberately
// separate from buildChainsMessage (that one describes the DEPOSIT chain,
// a different question that happens to use the same trigger word
// "chains"; see intent.ts's CROSS_CHAIN_RE split). DESTINATION_CHAINS is
// crossChainSendDraft.ts's own single source of truth — same chains it
// asks about mid-flow, so this list can't drift from what actually works.
// Source is always Celo now, so this only ever lists destinations.
export function buildCrossChainSendChainsMessage(): string {
  return `Cross-chain send moves USDC from your Celo balance to ${formatChainList(DESTINATION_CHAINS)}. Just say something like "send 10 USDC to Base" (or to someone else's address) and I'll take it from there.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Balance is tracked per (token, chain) — grouped back down to one line per
// token here, same as before per-chain balances existed, unless a token
// actually has funds on more than one chain (breaks out per-chain only
// then, since USDC on one chain isn't spendable on another).
export function buildBalanceMessage(balances: LedgerBalance[]): string {
  if (balances.length === 0) {
    return `💰 Balance:\nNo balance yet — send USDC to your deposit address to get started.`;
  }

  // Always shows the chain, even when a token only has balance on one —
  // pure transparency, not a disambiguation need (the send flow already
  // auto-resolves or asks with real options when a chain choice is
  // actually ambiguous). Helps build the right mental model of where funds
  // actually sit now that deposits/sends span multiple chains by default.
  const balanceLines = balances
    .map((b) => `${formatAmount(b.availableBalance)} ${b.tokenSymbol} on ${capitalize(b.chain)}`)
    .join("\n");

  return `💰 Balance:\n${balanceLines}`;
}

// Shown once a send actually reaches COMPLETE (Paycrest's payment_order.settled
// webhook, not the "processing" message initiateSend returns at submission
// time) — layout matches the user's AZZA-style reference receipt, but with
// "Sent"/"for" instead of the reference's "Buy"/"with": this is an off-ramp
// (user sends/sells crypto, receives fiat), not an on-ramp purchase, and
// "Sent" also matches the wording initiateSend's own "processing" message
// already uses for the same transaction.
export function buildSendCompletedMessage(send: Send): string {
  const netAmount = Number(send.amountHuman) - Number(send.feeAmount ?? "0");
  const fiatAmount =
    send.rate != null && Number.isFinite(Number(send.rate)) ? netAmount * Number(send.rate) : null;
  const fiatLine =
    fiatAmount != null ? `${send.fiatCurrency} ${fiatAmount.toFixed(2)}` : send.fiatCurrency;
  const { accountName, accountIdentifier, institutionName, institution } = send.recipient;
  // Last-4 masking, matching the existing convention in the receipt route
  // (routes/offramp.ts's accountIdentifierMasked) — this is the user's own
  // recipient, shown to confirm it's the right one, not a full account
  // number dump.
  const maskedAccount = `••••${accountIdentifier.slice(-4)}`;

  return [
    `✅ Your transaction with the following details has been completed:`,
    ``,
    `💲Sent ${formatAmount(send.amountHuman)} ${send.tokenSymbol} on ${send.chain.toUpperCase()} for ${fiatLine}`,
    ``,
    `To: ${accountName} — ${institutionName ?? institution} ${maskedAccount}`,
    ``,
    `Expect your funds within 1 - 5 minutes`,
  ].join("\n");
}

export function buildHelpMessage(): string {
  return [
    "Here's what I can help with right now:",
    `• "What's my balance?" — check your available balance`,
    `• "I want to deposit" — get your ${formatChainList(DEPOSIT_CHAINS, "or")} deposit address`,
    `• "Which chains are supported?" — see what network your deposit address runs on`,
    `• "Send $50 to a bank account in Nigeria" — send money abroad; tell me the amount, provider, and account`,
    `• "Withdraw 20 USDC to 0x... on Base" — send crypto to an external wallet address`,
    `• "I have 10 USDC on Celo but need it on Base" — move funds from one chain to a different one`,
    `• "My transactions" — see your recent activity`,
    "",
    `Need a real person? Reach us on Telegram: https://t.me/+OV3fAjsqmrtlZmY8`,
  ].join("\n");
}

export function buildTxHistoryMessage(sends: Send[], deposits: Deposit[], crossChainSends: CrossChainSend[] = []): string {
  if (sends.length === 0 && deposits.length === 0 && crossChainSends.length === 0) {
    return `No activity yet — send USDC to your deposit address, or try "send $50 to a bank account in Nigeria".`;
  }

  const sendLines = sends.map((s) => ({
    createdAt: s.createdAt,
    text: `• Sent ${formatAmount(s.amountHuman)} ${s.tokenSymbol} → ${s.recipient.accountName} (${s.fiatCurrency}) — ${describeSendState(s.state)}`,
  }));
  const depositLines = deposits.map((d) => ({
    createdAt: d.createdAt,
    text: `• Received ${formatAmount(d.amount)} ${d.tokenSymbol} — ${describeDepositState(d.state)}`,
  }));
  const crossChainSendLines = crossChainSends.map((c) => ({
    createdAt: c.createdAt,
    text: `• Moved ${formatAmount(c.amountHuman)} ${c.tokenSymbol} ${capitalize(c.sourceChain)} → ${capitalize(c.destinationChain)} — ${describeCrossChainSendState(c.state)}`,
  }));

  const lines = [...sendLines, ...depositLines, ...crossChainSendLines]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((l) => l.text);

  return `📜 Recent activity:\n${lines.join("\n")}`;
}

function describeSendState(state: SendState): string {
  switch (state) {
    case "COMPLETE":
      return "delivered ✅";
    case "MANUAL_REVIEW":
      return "under review";
    case "SEND_REJECTED":
    case "FAILED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    default:
      return "processing";
  }
}

function describeCrossChainSendState(state: CrossChainSendState): string {
  switch (state) {
    case "COMPLETE":
      return "delivered ✅";
    case "FAILED":
      return "failed";
    case "STUCK":
      return "needs a manual check";
    case "REFUNDED":
      return "refunded";
    default:
      return "processing";
  }
}

function describeDepositState(state: DepositState): string {
  switch (state) {
    case "BALANCE_CREDITED":
      return "credited ✅";
    case "MANUAL_REVIEW":
      return "under review";
    case "DEPOSIT_HELD":
      return "held";
    case "RETURN_TO_SENDER":
      return "returned";
    default:
      return "processing";
  }
}
