// Prints the payout ("master") wallet's address — the single KMS key every
// aws-kms withdraw() call signs with (AWS_KMS_PAYOUT_KEY_ARN), and the
// address that receives every user deposit sweep (see depositSweeper.ts).
// This is the wallet that actually generates real on-chain volume, so it's
// what should be registered as agentWalletAddress with a hackathon — not a
// per-user deposit address. Requires live AWS credentials: run wherever
// those are configured (e.g. Railway), not necessarily locally.
//   npx tsx scripts/print-payout-address.ts
import { env } from "../src/config/env.js";
import { getWalletAddress } from "../src/domain/wallets/awsKmsAdapter.js";

async function main() {
  if (!env.awsKmsPayoutKeyArn) {
    throw new Error("Set AWS_KMS_PAYOUT_KEY_ARN before running this script");
  }
  const address = await getWalletAddress(env.awsKmsPayoutKeyArn);
  console.log(address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
