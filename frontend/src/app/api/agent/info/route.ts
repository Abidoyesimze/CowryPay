import { NextResponse } from "next/server";
import { SelfAgent } from "@selfxyz/agent-sdk";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

export const runtime = "nodejs";

// Two DIFFERENT, cross-linked registries back this agent's identity — easy
// to conflate (a real mix-up that happened in conversation before this
// comment existed), so spelled out explicitly rather than left implicit:
//
// 1. erc8004 — the canonical ERC-8004 Identity Registry (what 8004scan.io
//    indexes). A plain, permissionless ERC-721: anyone can mint an agent
//    NFT here with no identity/KYC check at all. This project's entry is
//    agentId 9214 on Celo mainnet.
// 2. selfAgentId — Self Protocol's own "Self Agent ID" registry (a
//    completely different contract, SELF_AGENT_REGISTRY below). This is
//    the one that actually requires human verification — a real ZK
//    passport/ID scan — and the one AGENT_PRIVATE_KEY signs into via
//    isRegistered()/getInfo() below.
//
// These are linked on purpose, not by coincidence: agentId 9214's own
// on-chain metadata (its tokenURI) explicitly declares agentId 112 on
// registry #2 as its human-verification backing. Confirm this yourself
// rather than trust this comment:
//   cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "tokenURI(uint256)" 9214
const ERC8004_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const ERC8004_AGENT_ID = 9214n;
const ERC8004_ABI = [
  {
    name: "ownerOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export async function GET() {
  const pk = process.env.AGENT_PRIVATE_KEY;
  if (!pk) {
    return NextResponse.json({ error: "AGENT_PRIVATE_KEY not set" }, { status: 503 });
  }

  try {
    const agent = new SelfAgent({ privateKey: pk, network: "mainnet" });

    // Confirmed live against the real registry, not hardcoded and trusted
    // blindly — ownerOf() re-checked on every call so this catches the
    // entry ever being burned/transferred/re-registered elsewhere, rather
    // than silently reporting a stale agentId forever.
    let erc8004: { agentId: string; registry: string; ownerMatches: boolean; url: string } | { error: string };
    try {
      const client = createPublicClient({ chain: celo, transport: http() });
      const owner = await client.readContract({
        address: ERC8004_REGISTRY,
        abi: ERC8004_ABI,
        functionName: "ownerOf",
        args: [ERC8004_AGENT_ID],
      });
      erc8004 = {
        agentId: ERC8004_AGENT_ID.toString(),
        registry: ERC8004_REGISTRY,
        ownerMatches: owner.toLowerCase() === agent.address.toLowerCase(),
        url: `https://8004scan.io/agents/celo/${ERC8004_AGENT_ID}`,
      };
    } catch (e) {
      erc8004 = { error: e instanceof Error ? e.message : String(e) };
    }

    const isRegistered = await agent.isRegistered();
    if (!isRegistered) {
      return NextResponse.json({
        agentAddress: agent.address,
        network: "celo-mainnet",
        erc8004,
        selfAgentId: {
          registered: false,
          hint: `Not registered yet — run: npx self-agent register init --mode linked --human-address <your-wallet> --network mainnet (requires scanning your ID in the Self app to complete).`,
        },
      });
    }

    const info = await agent.getInfo();
    return NextResponse.json({
      agentAddress: agent.address,
      network: "celo-mainnet",
      erc8004,
      selfAgentId: {
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
