// One-off proof that CowryPay can genuinely settle a stablecoin transfer on
// Celo mainnet through Celo's own x402 facilitator (api.x402.celo.org) —
// for the "Best Stablecoin Adoption" bounty's "settled over x402" criteria.
// Deliberately standalone, independent of the real remittance/withdrawal
// flows (see awsKmsAdapter.ts's withdraw()) — this never touches the
// production payout path, just proves the payout wallet CAN sign an
// EIP-3009 TransferWithAuthorization and have it settled by the facilitator.
//
// Usage:
//   npx tsx scripts/x402-settlement.ts <amount> [USDC|USDT]
//   e.g. npx tsx scripts/x402-settlement.ts 0.01 USDC
//
// Requires X402_API_KEY (from https://x402.celo.org — Create API key) and
// AWS_KMS_PAYOUT_KEY_ARN's wallet to hold at least <amount> of the chosen
// token. No native CELO is needed on that wallet — the facilitator
// broadcasts and pays gas; the wallet only ever signs an off-chain
// authorization.
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { env } from "../src/config/env.js";
import { getTokenConfig } from "../src/domain/wallets/chains.js";
import { getWalletAddress, kmsAccountFromKey } from "../src/domain/wallets/awsKmsAdapter.js";

const CELO_CHAIN_ID = 42220;
const X402_BASE_URL = "https://api.x402.celo.org";
// GET /supported advertises an x402Version 2 / "eip155:42220" kind, but that
// combination is live-rejected by /verify with "unsupported_scheme" before
// any real validation runs. x402Version 1 with network "celo" is what's
// actually wired up — confirmed by getting past that check into real
// on-chain signature simulation (an ECRecover revert on a deliberately
// garbage test signature) before switching to a real KMS signature below.
const X402_VERSION = 1;
const X402_NETWORK = "celo";

// EIP-712 domain name/version per token, as verified live against the
// deployed contracts (matches the `extra` field the x402 facilitator itself
// expects in paymentRequirements).
const TOKEN_EIP712: Record<string, { name: string; version: string }> = {
  USDC: { name: "USDC", version: "2" },
  USDT: { name: "Tether USD", version: "1" },
};

async function main() {
  const amount = process.argv[2];
  const tokenSymbol = (process.argv[3] ?? "USDC").toUpperCase();
  if (!amount) {
    throw new Error("Usage: npx tsx scripts/x402-settlement.ts <amount> [USDC|USDT]  (e.g. 0.01 USDC)");
  }
  const eip712 = TOKEN_EIP712[tokenSymbol];
  if (!eip712) {
    throw new Error(`Unsupported token for x402 settlement: ${tokenSymbol} (supported: ${Object.keys(TOKEN_EIP712).join(", ")})`);
  }
  const apiKey = process.env.X402_API_KEY;
  if (!apiKey) {
    throw new Error("Set X402_API_KEY (from https://x402.celo.org) before running this script");
  }
  if (!env.awsKmsPayoutKeyArn) {
    throw new Error("Set AWS_KMS_PAYOUT_KEY_ARN before running this script");
  }

  const { address: tokenAddress, decimals } = getTokenConfig("celo", tokenSymbol);
  const from = await getWalletAddress(env.awsKmsPayoutKeyArn);
  // The facilitator refuses an identical from/to as a no-op
  // (self_payment_rejected) — a fresh throwaway EOA is a genuinely distinct
  // recipient while keeping funds fully recoverable (its private key is
  // printed below). Generated locally rather than via a new KMS key, since
  // this IAM user is deliberately scoped to sign/read only — not
  // kms:CreateKey/TagResource — on the one payout key it's meant for.
  const destinationPrivateKey = generatePrivateKey();
  const to = privateKeyToAccount(destinationPrivateKey).address;
  console.log("Destination:", to, "(private key printed below — sweep the tiny test amount back if you want it)");
  console.log("Destination private key:", destinationPrivateKey);

  const value = BigInt(Math.round(Number(amount) * 10 ** decimals)).toString();
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to,
    value,
    validAfter: "0",
    validBefore: String(now + 300),
    nonce: `0x${randomBytes(32).toString("hex")}` as `0x${string}`,
  };

  console.log(`Signing a ${amount} ${tokenSymbol} TransferWithAuthorization from ${from}...`);
  const account = kmsAccountFromKey(env.awsKmsPayoutKeyArn, from);
  const signature = await account.signTypedData({
    domain: {
      name: eip712.name,
      version: eip712.version,
      chainId: CELO_CHAIN_ID,
      verifyingContract: tokenAddress,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    // viem's typed-data checker wants real bigints for uint256 fields — the
    // outgoing JSON `authorization` object (above) uses strings instead,
    // since that's the wire format the x402 facilitator expects.
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  });

  const paymentPayload = {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: X402_NETWORK,
    payload: { signature, authorization },
  };
  const paymentRequirements = {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: value,
    resource: "cowrypay-hackathon-x402-verification",
    description: "CowryPay settlement",
    mimeType: "application/json",
    payTo: to,
    maxTimeoutSeconds: 60,
    asset: tokenAddress,
    extra: eip712,
  };

  console.log("Calling /verify...");
  const verifyRes = await fetch(`${X402_BASE_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
  });
  const verifyBody = await verifyRes.json();
  console.log("verify response:", verifyBody);
  if (!verifyRes.ok || !verifyBody.isValid) {
    throw new Error(`/verify rejected the payment — not calling /settle. Response: ${JSON.stringify(verifyBody)}`);
  }

  console.log("Verified. Calling /settle (this broadcasts a REAL mainnet transaction)...");
  const settleRes = await fetch(`${X402_BASE_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
  });
  const settleBody = await settleRes.json();
  console.log("settle response:", settleBody);
  if (!settleRes.ok || !settleBody.success) {
    throw new Error(`/settle failed. Response: ${JSON.stringify(settleBody)}`);
  }

  console.log(`OK: settled over x402. Celoscan: https://celoscan.io/tx/${settleBody.transaction}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
