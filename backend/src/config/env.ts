import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT) || 3001,
  // This service's own public URL — used to verify third-party webhooks are
  // actually configured to call back to THIS environment. No hardcoded
  // fallback — a wrong guess here would be worse than an explicit unset.
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
  databaseUrl: required("DATABASE_URL"),
  databaseSsl: process.env.DATABASE_SSL !== "false",
  supabaseUrl: required("SUPABASE_URL"),
  walletProvider: process.env.WALLET_PROVIDER ?? "mock",
  kycProvider: process.env.KYC_PROVIDER ?? "mock",
  // Only required when walletProvider === "blockradar" — checked lazily by
  // that adapter, not here, so mock mode keeps working with these unset.
  blockradarApiKey: process.env.BLOCKRADAR_API_KEY,
  blockradarWalletId: process.env.BLOCKRADAR_WALLET_ID,
  blockradarBaseUrl: process.env.BLOCKRADAR_BASE_URL ?? "https://api.blockradar.co/v1",
  defaultChain: process.env.DEFAULT_CHAIN ?? "mock-chain",
  defaultTokenSymbol: process.env.DEFAULT_TOKEN_SYMBOL ?? "USDC",
  mockScreeningFlagThreshold: Number(process.env.MOCK_SCREENING_FLAG_THRESHOLD ?? 5000),
  // Comma-separated allowlist for browser callers (the frontend). Unset ==
  // allow any origin — fine for pre-launch testing since auth is bearer-token
  // based (no cookies, so no CSRF exposure from a permissive policy), but
  // set this once there's a real frontend origin to lock down to.
  corsOrigins: process.env.CORS_ORIGINS?.split(",").map((o) => o.trim()),
  // Only used for the free-form chat fallback — unset means that path
  // degrades to a static reply instead of erroring (see domain/chat/llm.ts).
  groqApiKey: process.env.GROQ_API_KEY,
  // llama-3.3-70b-versatile (the old default here) was fully decommissioned
  // by Groq on 2026-08-16 — every call silently failed and fell through to
  // Claude/static fallbacks, undetected until traced directly (see
  // domain/chat/llm.ts's now-added logging on every one of those catches).
  // openai/gpt-oss-120b is Groq's own recommended replacement, verified
  // live against the real intent-parsing prompt before switching (a
  // smaller 20b variant was tried first but failed to reliably produce
  // valid JSON against this prompt's length).
  groqModel: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
  // Fallback only — used when Groq is unavailable/errors, or for intent
  // parsing that needs the stronger model. Unset means no fallback; Groq
  // failures degrade to the static reply, same as before.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
  // Off-ramp provider (Paycrest). API key only needed for order-creation and
  // authenticated endpoints — rate quotes are public. Secret is only used to
  // verify webhook signatures.
  paycrestApiKey: process.env.PAYCREST_API_KEY,
  paycrestApiSecret: process.env.PAYCREST_API_SECRET,
  paycrestBaseUrl: process.env.PAYCREST_BASE_URL ?? "https://api.paycrest.io/v2",
  // Second off-ramp provider (Quidax Ramp) — a second-opinion quote,
  // eligibility gated per-chain in providerSelection.ts (celo/USDT support
  // pending live verification — see quidaxAdapter.ts's own comment history
  // of its docs disagreeing with the real API). secretKey signs both
  // outbound requests (x-private-key header) and inbound webhook
  // verification (HMAC-SHA256 over the raw body, x-ramp-signature header);
  // publicKey is currently unused server-side (kept for parity/future use).
  quidaxPublicKey: process.env.QUIDAX_PUBLIC_KEY,
  quidaxSecretKey: process.env.QUIDAX_SECRET_KEY,
  quidaxBaseUrl: process.env.QUIDAX_RAMP_BASE_URL ?? "https://ramp-be.quidax.io/api/v1",
  // How long a half-finished multi-turn chat draft (e.g. a partial send
  // request) survives with no reply before the next message starts fresh.
  chatSessionIdleMinutes: Number(process.env.CHAT_SESSION_IDLE_MINUTES ?? 10),
  // Platform fee skimmed from every remittance, in basis points (100 = 1%).
  // Only required when a send is actually resolved — checked lazily by
  // domain/offramp/fee.ts, not here.
  remittanceTreasuryAddress: process.env.REMITTANCE_TREASURY_ADDRESS,
  remittanceFeeBps: Number(process.env.REMITTANCE_FEE_BPS ?? 100),
  // Crypto-to-crypto withdrawals were originally fee-free (see migration
  // 0015's own comment) — now 0.3% (much lower than the 1% off-ramp fee,
  // since there's no fiat conversion/provider rail involved), with a
  // minimum floor so a small withdrawal doesn't carry a near-zero fee.
  // Reuses the SAME treasury addresses as the off-ramp fee (fee.ts's
  // requireTreasuryAddress) — both are platform fee revenue, no reason to
  // route them to separate wallets per chain.
  cryptoWithdrawalFeeBps: Number(process.env.CRYPTO_WITHDRAWAL_FEE_BPS ?? 30),
  cryptoWithdrawalMinFeeUsd: process.env.CRYPTO_WITHDRAWAL_MIN_FEE_USD ?? "0.1",
  // A separate, explicit minimum SEND amount — the min-fee floor above
  // only guards the platform's own fee revenue (a $0.11 withdrawal would
  // pass it, netting $0.01), not whether the withdrawal is worth doing at
  // all against real on-chain gas. Same pattern as
  // crossChainSendMinAmountUsd, sized lower here since a same-chain
  // withdrawal has none of that flow's extra bridge/slippage cost.
  cryptoWithdrawalMinAmountUsd: process.env.CRYPTO_WITHDRAWAL_MIN_AMOUNT_USD ?? "1",
  // A cross-chain send has real costs computeCryptoWithdrawalFeeSplit's
  // own min-fee floor was never sized for: CCTP's destination-chain mint
  // still needs real gas, and LI.FI's Celo legs go through an actual swap
  // with slippage. Sized deliberately low (not $5+) — verified live against
  // LI.FI's real quote API (2026-08-21) that a $2 Celo->Base send only
  // loses ~2.2% to the bridge itself (LI.FI's fixed + percentage fee);
  // the point of this feature is to undercut a user bridging manually
  // (who'd need to already hold native gas on the source chain just to
  // try), not to match a same-chain withdrawal's economics. Checked
  // against the gross amount (what the user typed), before any fee split
  // — see crossChainSend/service.ts and chat/crossChainSendDraft.ts.
  crossChainSendMinAmountUsd: process.env.CROSS_CHAIN_SEND_MIN_AMOUNT_USD ?? "2",
  // A separate, much smaller minimum fee than cryptoWithdrawalMinFeeUsd
  // ($0.1) — that flat floor is what actually made a $2 cross-chain send
  // look expensive (5% of $2, before LI.FI's own ~2.2% on top), not the
  // bridge's real cost. Kept as its own knob (not just reusing
  // cryptoWithdrawalMinFeeUsd) so this flow's affordability goal can be
  // tuned independently of same-chain withdrawal fee revenue. See
  // offramp/fee.ts's computeCrossChainSendFeeSplit.
  crossChainSendMinFeeUsd: process.env.CROSS_CHAIN_SEND_MIN_FEE_USD ?? "0.02",
  // Historical Solana fee-treasury address — Solana is destination-only
  // now (no longer an off-ramp source, so nothing NEW routes here), but
  // this stays for admin/treasury.ts's read-only balance display of
  // whatever's still there.
  solanaTreasuryFeeAddress: process.env.SOLANA_TREASURY_FEE_ADDRESS,
  // Any secret string — a 32-byte encryption key gets derived from it via
  // scrypt, so this doesn't need to be exact raw key bytes. Only required
  // when a recipient is actually saved — checked lazily, not here.
  recipientEncryptionKey: process.env.RECIPIENT_ENCRYPTION_KEY,
  // Gates POST /admin/deposits/:id/review — there's no role/permission
  // system in this codebase yet, so this is a shared-secret header check
  // (x-admin-key) rather than real per-admin auth. Only required when that
  // endpoint is actually called — checked lazily, not here.
  adminApiKey: process.env.ADMIN_API_KEY,
  // Narrower sibling of adminApiKey — grants ONLY the read-only dashboard
  // endpoints (requireMetricsKey), not the write endpoints requireAdminKey
  // alone guards (correct-state, deposit resolve). Handed to the frontend
  // admin dashboard's own backend so a leaked/compromised dashboard key
  // can't be used to tamper with financial records.
  adminMetricsKey: process.env.ADMIN_METRICS_KEY,
  // Only required when walletProvider === "aws-kms" — checked lazily by
  // that adapter, not here, same pattern as the Blockradar vars above.
  awsRegion: process.env.AWS_REGION,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // The single KMS key every aws-kms withdraw() call signs with — mirrors
  // BLOCKRADAR_WALLET_ID being one fixed master payout wallet today, not a
  // per-user key. Only required when walletProvider === "aws-kms".
  awsKmsPayoutKeyArn: process.env.AWS_KMS_PAYOUT_KEY_ARN,
  celoRpcUrl: process.env.CELO_RPC_URL ?? "https://forno.celo.org",
  // ERC-8021 attribution tag for the Celo "Agents at Work" hackathon —
  // registered against this repo's github.com/Abidoyesimze/CowryPay slug at
  // celobuilders.xyz, locked to that value for the hackathon's duration.
  // Only ever appended to Celo mainnet sends (awsKmsAdapter.ts's withdraw())
  // — meaningless on the other EVM chains this codebase supports, and this
  // codebase only needs Celo for the hackathon itself.
  celoAttributionTag: process.env.CELO_ATTRIBUTION_TAG ?? "celo_9ef59d7031c8",
  // Base/Optimism are destination-only now (bridge targets via
  // liFiAdapter.ts) — kept for their token-config/RPC needs, not as
  // deposit/withdrawal chains. Ethereum, Stellar, and Solana's own
  // signing/deposit infra (RPC network selection, KMS keys, Helius webhook,
  // CCTP attestation env) were dropped entirely with the Agents at Work
  // Celo-only narrowing; Solana's mint addresses/RPC below are the one
  // exception, still needed to resolve a Celo->Solana bridge destination.
  baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  optimismRpcUrl: process.env.OPTIMISM_RPC_URL ?? "https://mainnet.optimism.io",
  // Public mainnet-beta RPC is rate-limited/unreliable for real use — a
  // paid RPC is expected in production. Only needed for liFiAdapter.ts's
  // Celo->Solana destination resolution now (no more Solana deposit
  // scanning/signing).
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  // Circle's official USDC mint on Solana mainnet (developers.circle.com/
  // stablecoins/usdc-contract-addresses).
  solanaUsdcMint: process.env.SOLANA_USDC_MINT ?? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // Tether's official USDT mint on Solana mainnet, announced by Solana's
  // own account — verified live via getTokenSupply (decimals: 6, ~3.8B
  // real circulating supply) before being hardcoded here.
  solanaUsdtMint: process.env.SOLANA_USDT_MINT ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  // Ops-only alerting (gasStatusMonitor.ts) — a private Telegram chat, never
  // the public support group linked in chat replies. Both required for the
  // monitor to actually send anything; unset just means it logs instead of
  // posting (see gasStatusMonitor.ts's own guard).
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramOpsChatId: process.env.TELEGRAM_OPS_CHAT_ID,
  // One-off/marketing campaign sends (domain/campaigns) — a separate,
  // narrower concern from every other integration above, all of which are
  // core money-movement rails. Only required when a campaign is actually
  // triggered — checked lazily by campaigns/resendClient.ts, not here.
  // Resend requires sending FROM a domain you've verified with them via
  // DNS (SPF/DKIM) — a plain gmail.com address can't be used here, which
  // is why this is a distinct address from the cowrypay.xyz@gmail.com
  // inbox used for manual sends.
  resendApiKey: process.env.RESEND_API_KEY,
  campaignFromEmail: process.env.CAMPAIGN_FROM_EMAIL ?? "CowryPay <feedback@cowrypay.xyz>",
  // Signs unsubscribe links (HMAC over the recipient's email) so
  // GET /campaigns/unsubscribe can't be used to unsubscribe an address the
  // link wasn't actually generated for. No hardcoded fallback, same
  // reasoning as publicBaseUrl above — a guessed secret is worse than an
  // explicit unset (link generation just fails loudly instead).
  campaignUnsubscribeSecret: process.env.CAMPAIGN_UNSUBSCRIBE_SECRET,
};
