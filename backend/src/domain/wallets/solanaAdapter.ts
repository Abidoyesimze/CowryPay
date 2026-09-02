import { env } from "../../config/env.js";

// Solana is destination-only now (Celo -> Solana via liFiAdapter.ts) — we
// never sign or broadcast a Solana-side transaction ourselves, since LI.FI's
// own bridge/relayer delivers funds on the destination side. Everything this
// file used to own for Solana-as-a-deposit-chain (wallet creation, treasury
// signing, sweeping, Helius webhook registration) is gone; only the token
// address/decimals lookup liFiAdapter.ts's tokenAddressFor() needs survives.

// Shared by both mints we support on Solana — USDC and USDT are both
// 6-decimal SPL tokens, confirmed live via getTokenSupply for the USDT
// mint before it was added (see env.ts's own comment on that address).
export const SOLANA_TOKEN_DECIMALS = 6;

const SOLANA_MINTS: Record<string, () => string | undefined> = {
  USDC: () => env.solanaUsdcMint,
  USDT: () => env.solanaUsdtMint,
};

// Replaces the old single-token requireSolanaUsdcMint — same "throw clearly,
// don't let a missing/unsupported token silently resolve to nothing" stance,
// now keyed by symbol so USDT support is additive rather than a special case.
export function getSolanaMint(tokenSymbol: string): string {
  const resolver = SOLANA_MINTS[tokenSymbol.toUpperCase()];
  if (!resolver) {
    throw new Error(`${tokenSymbol} is not supported on Solana (supported: ${Object.keys(SOLANA_MINTS).join(", ")})`);
  }
  const mint = resolver();
  if (!mint) {
    throw new Error(`SOLANA_${tokenSymbol.toUpperCase()}_MINT must be set for Solana support`);
  }
  return mint;
}
