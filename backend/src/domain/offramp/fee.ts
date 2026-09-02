import { env } from "../../config/env.js";

export interface FeeSplit {
  feeAmount: string;
  netAmount: string;
}

// Platform fee skimmed from every remittance, in basis points (100 = 1%,
// matching the old MiniPay system's REMITTANCE_FEE_BPS). Only the net
// amount actually goes through the off-ramp provider's conversion — the
// fee is tracked on the send record for the withdraw step to route
// separately to treasury via a real on-chain transfer.
export function computeFeeSplit(amount: string): FeeSplit {
  const amountNum = Number(amount);
  const feeAmount = Math.round(amountNum * env.remittanceFeeBps) / 10_000;
  const netAmount = Math.round((amountNum - feeAmount) * 1_000_000) / 1_000_000;
  return { feeAmount: String(feeAmount), netAmount: String(netAmount) };
}

// Same "fee taken from the amount" shape as computeFeeSplit above, so the
// mental model matches off-ramp sends exactly — the full amount debits
// the user's balance, only the net actually reaches the destination
// wallet. The one real difference: a minimum floor, since 0.3% of a small
// withdrawal rounds to almost nothing — without a floor, a $2 withdrawal
// would carry a ~$0.006 fee. Returns null (not a thrown error, same
// stance as ledgerRepo.debitAvailable's insufficient-balance guard) when
// the amount can't even cover the minimum fee, since that's an expected,
// user-correctable outcome, not a fault.
function computeFeeSplitWithFloor(amount: string, minFeeUsd: string): FeeSplit | null {
  const amountNum = Number(amount);
  const pctFee = Math.round(amountNum * env.cryptoWithdrawalFeeBps) / 10_000;
  const feeAmount = Math.max(pctFee, Number(minFeeUsd));
  if (feeAmount >= amountNum) return null;
  const netAmount = Math.round((amountNum - feeAmount) * 1_000_000) / 1_000_000;
  return { feeAmount: String(feeAmount), netAmount: String(netAmount) };
}

export function computeCryptoWithdrawalFeeSplit(amount: string): FeeSplit | null {
  return computeFeeSplitWithFloor(amount, env.cryptoWithdrawalMinFeeUsd);
}

// Same percentage as a same-chain withdrawal, but a much smaller floor
// (env.crossChainSendMinFeeUsd, $0.02 by default vs $0.1) — deliberately
// NOT computeCryptoWithdrawalFeeSplit. That $0.1 floor is flat, so it's
// what made a $2 cross-chain send look expensive (5% of $2) before this
// existed; the bridge itself (LI.FI/CCTP) already charges its own real
// cost on top, and this flow's whole point is undercutting a user
// bridging manually, not matching same-chain withdrawal fee economics.
// See env.ts's own comment for the live numbers this was sized against.
export function computeCrossChainSendFeeSplit(amount: string): FeeSplit | null {
  return computeFeeSplitWithFloor(amount, env.crossChainSendMinFeeUsd);
}

// Celo-only now (Agents at Work hackathon narrowing) — the Stellar/Solana
// dedicated fee-treasury branches this used to have are gone along with
// those chains as off-ramp/withdrawal sources. Still async/chain-parameterized
// (not a bare constant) so a second EVM chain could be added back the same
// way without changing every call site.
export async function requireTreasuryAddress(chain: string): Promise<string> {
  void chain;
  if (!env.remittanceTreasuryAddress) {
    throw new Error("REMITTANCE_TREASURY_ADDRESS must be set to process remittances");
  }
  return env.remittanceTreasuryAddress;
}
