import { isAddress as isEvmAddress } from "viem";
import { isAddress as isSolanaAddress } from "@solana/kit";
import { SUPPORTED_CHAINS } from "../wallets/chains.js";

// A wrong-format address here isn't a rejected request — it's money sent
// to a destination that can never be recovered (no recipient to refund,
// no support ticket that gets it back). Validated per chain's actual
// address format, not a generic "looks like a hex string" check, since
// that's exactly the class of mistake (e.g. an EVM-shaped address entered
// for a Solana withdrawal) this exists to catch before broadcasting.
// Shared by same-chain crypto withdrawals (Celo only) AND cross-chain-send
// destination validation (Celo/Base/Optimism/Solana — see
// crossChainSend/service.ts) — Solana stays here for that second use even
// though it's no longer a same-chain withdrawal destination. Stellar was
// dropped entirely with the Agents at Work Celo-only narrowing.
export function isValidAddressForChain(chain: string, address: string): boolean {
  const c = chain.toLowerCase();
  if (SUPPORTED_CHAINS.includes(c)) {
    return isEvmAddress(address);
  }
  if (c === "solana") {
    return isSolanaAddress(address);
  }
  return false;
}
