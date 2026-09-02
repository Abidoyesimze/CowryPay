import { env } from "../../config/env.js";
import type { WalletAdapter } from "./adapter.js";
import { blockradarWalletAdapter } from "./blockradarAdapter.js";
import { mockWalletAdapter } from "./mockAdapter.js";
import { awsKmsWalletAdapter } from "./awsKmsAdapter.js";

// `explicitProvider` makes EVM dispatch per-wallet, not just per-chain.
// Without it, a withdraw() call would grab whatever WALLET_PROVIDER
// currently says globally, regardless of which provider actually custodies
// a given user's wallet — safe only as long as an environment never has two
// EVM providers' wallets coexisting. That stopped being true the moment
// production needed to deprecate Blockradar for new signups while 24
// existing users (2 with real balances) still have Blockradar-custodied
// wallets: flipping WALLET_PROVIDER globally would make their next send
// sign with the wrong key entirely. Callers that already have a wallet row
// in hand (offramp/service.ts) pass wallet.provider explicitly; callers
// creating a brand-new wallet (users/service.ts) have no existing provider
// to honor, so they correctly fall through to the current env default.
// Stellar/Solana custody (their own separate wallet-adapter dispatch) was
// removed with the Agents at Work Celo-only narrowing — Solana survives
// only as a cross-chain-send DESTINATION (see liFiAdapter.ts), which never
// goes through this wallet-adapter dispatch at all.
export function getWalletAdapter(chain: string, explicitProvider?: string): WalletAdapter {
  void chain;
  const provider = explicitProvider ?? env.walletProvider;
  switch (provider) {
    case "mock":
      return mockWalletAdapter;
    case "blockradar":
      return blockradarWalletAdapter;
    case "aws-kms":
      return awsKmsWalletAdapter;
    default:
      throw new Error(`Unknown wallet provider: ${provider}`);
  }
}
