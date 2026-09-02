import { NextResponse } from "next/server";
import { SelfAgent } from "@selfxyz/agent-sdk";

export const runtime = "nodejs";

// Reads the dedicated agent identity key (AGENT_PRIVATE_KEY) — deliberately
// separate from the AWS KMS payout wallet that actually moves user funds
// (see backend/src/domain/wallets/awsKmsAdapter.ts). This key exists only
// to sign ERC-8004/Self Protocol identity assertions, so it doesn't need
// KMS-grade custody the way real money movement does.
export async function GET() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "AGENT_PRIVATE_KEY not set" }, { status: 503 });
  }

  try {
    const agent = new SelfAgent({ privateKey: pk, network: "mainnet" });
    const isRegistered = await agent.isRegistered();

    if (!isRegistered) {
      return NextResponse.json({
        agentAddress: agent.address,
        network: "celo-mainnet",
        erc8004: {
          registered: false,
          hint: `Not registered yet — run: npx self-agent register init --mode linked --human-address <your-wallet> --network mainnet (requires scanning your ID in the Self app to complete).`,
        },
      });
    }

    const info = await agent.getInfo();
    return NextResponse.json({
      agentAddress: agent.address,
      network: "celo-mainnet",
      erc8004: {
        registered: true,
        agentId: info.agentId.toString(),
        proofExpiresAt: info.proofExpiresAt.toString(),
        isProofFresh: info.isProofFresh,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
