import { createClient, getQuote, getStepTransaction, getStatus } from "@lifi/sdk";
import type { SDKClient, LiFiStep } from "@lifi/sdk";
import { encodeFunctionData, parseUnits } from "viem";
import { toDataSuffix } from "@celo/attribution-tags";
import { env } from "../../../config/env.js";
import { getChainConfig, getTokenConfig } from "../../wallets/chains.js";
import { getWalletAddress } from "../../wallets/awsKmsAdapter.js";
import { getSolanaMint, SOLANA_TOKEN_DECIMALS } from "../../wallets/solanaAdapter.js";
import { sendRawEvmTx } from "./evmRawTx.js";
import type { BridgeAdapter, BridgeInitiateInput, BridgeInitiateResult, BridgePhaseCheckResult, BridgeQuote } from "./adapter.js";

// Celo has no native CCTP support at all — confirmed against both
// Circle's official docs AND Circle's own SDK internals (its Celo chain
// definition exists but cctp is explicitly null, 2026-08-19). Since Celo
// is now the ONLY source chain this codebase has a real balance on
// (Agents at Work hackathon narrowing — see crossChainSend/service.ts's
// own sourceChain guard), every real cross-chain send routes through
// LI.FI, an aggregator that composes whichever underlying bridge + DEX
// swap gets the recipient the REAL requested token — unlike Wormhole's
// own transfer mechanisms (Wrapped Token Transfer, Native Token
// Transfers), which both mint a new, non-canonical token contract on the
// destination that this codebase's ledger/balance code wouldn't
// recognize. Confirmed live (li.quest/v1/tokens) that LI.FI's own token
// registry already has the exact canonical USDC addresses this codebase
// uses on Base and Celo.
//
// This is a materially different trust model than a clean CCTP burn-mint
// would be: a real third party (whichever bridge LI.FI selects) and a
// swap step are both involved, so the amount actually delivered can be
// slightly less than netAmount (slippage) — accepted, deliberate
// trade-off, not something to "fix" by pretending it's 1:1.
//
// Also handles Celo->Solana, since LI.FI is chain-agnostic: confirmed
// live (li.quest/v1/chains) Solana's LI.FI chain ID is 1151111081099710.
// Solana is DESTINATION-only here — we never sign a Solana-side
// transaction ourselves (LI.FI's own relayer delivers funds on that
// side), so there's no Solana signing path in this file at all.
const LIFI_CHAIN_IDS: Record<string, number> = { celo: 42220, base: 8453, optimism: 10, solana: 1151111081099710 };

// Which of the chains LI.FI knows about (LIFI_CHAIN_IDS) are actually
// offered right now as a cross-chain-send DESTINATION. Optimism was
// previously withheld here because Optimism deposits were on hold — that
// reasoning no longer applies: destination availability was never gated
// on having a balance to send FROM, only on having one to send TO, and
// Celo is the only source now regardless. Re-added.
const SUPPORTED_CHAINS = new Set(["celo", "base", "optimism", "solana"]);

// Conservative defaults — not yet tuned against real transfers. slippage
// is fractional (0.005 = 0.5%); maxPriceImpact hides routes worse than
// this rather than silently accepting a bad quote.
const SLIPPAGE = 0.005;
const MAX_PRICE_IMPACT = 0.02;

let cachedClient: SDKClient | null = null;
function getLiFiClient(): SDKClient {
  if (cachedClient) return cachedClient;
  cachedClient = createClient({
    integrator: "cowrypay",
    apiUrl: "https://li.quest/v1",
    debug: false,
    // Feeds LI.FI our own already-verified RPC URLs (chains.ts /
    // env.solanaRpcUrl) for whichever chains it needs to read from,
    // rather than whatever public default it would otherwise pick.
    rpcUrls: {
      [LIFI_CHAIN_IDS.base]: [getChainConfig("base").rpcUrl],
      [LIFI_CHAIN_IDS.optimism]: [getChainConfig("optimism").rpcUrl],
      [LIFI_CHAIN_IDS.celo]: [getChainConfig("celo").rpcUrl],
      [LIFI_CHAIN_IDS.solana]: [env.solanaRpcUrl],
    },
  });
  return cachedClient;
}

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

function requireLiFiChainId(chain: string): number {
  const chainId = LIFI_CHAIN_IDS[chain.toLowerCase()];
  if (!chainId) throw new Error(`${chain} has no LI.FI chain ID registered`);
  return chainId;
}

// Token address/decimals still differ between EVM chains (chains.ts's
// registry) and Solana (its own mint registry in solanaAdapter.ts) even
// with Solana destination-only — a route's TO side can still be Solana.
async function tokenAddressFor(chain: string, tokenSymbol: string): Promise<{ address: string; decimals: number }> {
  if (chain.toLowerCase() === "solana") {
    return { address: getSolanaMint(tokenSymbol), decimals: SOLANA_TOKEN_DECIMALS };
  }
  return getTokenConfig(chain, tokenSymbol);
}

// The source side is always our own EVM payout wallet now (Celo is the
// only source chain) — no more Solana-treasury-signer branch here.
async function sourceSignerAddress(): Promise<string> {
  if (!env.awsKmsPayoutKeyArn) throw new Error("AWS_KMS_PAYOUT_KEY_ARN must be set to bridge via LI.FI");
  return getWalletAddress(env.awsKmsPayoutKeyArn);
}

// A pure quote (no real send happening yet) has no real recipient to give
// LI.FI — any syntactically valid address on the destination chain is a
// safe placeholder, since quotes are priced off amount/route, not the
// specific recipient. Our own EVM address works for Base/Optimism (same
// address across every EVM chain); Solana has no equivalent "our own
// address" anymore (destination-only, no treasury signer), so its System
// Program address — a fixed, always-valid, unowned Solana account — is
// used instead purely as a well-formed placeholder.
const SOLANA_PLACEHOLDER_ADDRESS = "11111111111111111111111111111111";

async function placeholderAddressFor(chain: string): Promise<string> {
  if (chain.toLowerCase() === "solana") return SOLANA_PLACEHOLDER_ADDRESS;
  return sourceSignerAddress();
}

async function requestQuote(input: {
  sourceChain: string;
  destinationChain: string;
  tokenSymbol: string;
  amount: string;
  destinationAddress: string;
}): Promise<LiFiStep> {
  const [{ address: fromTokenAddress, decimals }, { address: toTokenAddress }, fromAddress] = await Promise.all([
    tokenAddressFor(input.sourceChain, input.tokenSymbol),
    tokenAddressFor(input.destinationChain, input.tokenSymbol),
    sourceSignerAddress(),
  ]);

  return getQuote(getLiFiClient(), {
    fromChain: requireLiFiChainId(input.sourceChain),
    toChain: requireLiFiChainId(input.destinationChain),
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    fromAmount: parseUnits(input.amount, decimals).toString(),
    fromAddress,
    toAddress: input.destinationAddress,
    slippage: SLIPPAGE,
    maxPriceImpact: MAX_PRICE_IMPACT,
  });
}

export const liFiAdapter: BridgeAdapter = {
  supports(sourceChain: string, destinationChain: string): boolean {
    return SUPPORTED_CHAINS.has(sourceChain.toLowerCase()) && SUPPORTED_CHAINS.has(destinationChain.toLowerCase());
  },

  async quote(input): Promise<BridgeQuote> {
    // A pure quote (no real send happening yet) has no real recipient to
    // give LI.FI — the platform's own signer address on the destination
    // chain is a safe placeholder; quotes are priced off amount/route,
    // not the specific recipient.
    const placeholderAddress = await placeholderAddressFor(input.destinationChain);
    const step = await requestQuote({ ...input, destinationAddress: placeholderAddress });
    // toAmountMin, not the optimistic toAmount — the guaranteed floor is
    // the honest number to report, given a swap step is involved.
    const { decimals } = await tokenAddressFor(input.destinationChain, input.tokenSymbol);
    const destinationAmount = (Number(step.estimate.toAmountMin) / 10 ** decimals).toString();
    return { estimatedSeconds: step.estimate.executionDuration, destinationAmount };
  },

  // Source is always EVM (Celo) now — no more Solana-source signing branch.
  // crossChainSend/service.ts's own sourceChain==="celo" guard is what
  // actually enforces this; this function just no longer has a Solana path
  // to fall into.
  async initiate(input: BridgeInitiateInput): Promise<BridgeInitiateResult> {
    const step = await requestQuote(input);

    const { address: fromTokenAddress } = await tokenAddressFor(input.sourceChain, input.tokenSymbol);
    // Approve LI.FI's selected route to spend the source token, unless
    // this specific route doesn't need it (estimate.skipApproval).
    if (!step.estimate.skipApproval) {
      const approveData = encodeFunctionData({
        abi: ERC20_APPROVE_ABI,
        functionName: "approve",
        args: [step.estimate.approvalAddress as `0x${string}`, BigInt(step.action.fromAmount)],
      });
      await sendRawEvmTx(input.sourceChain, fromTokenAddress as `0x${string}`, approveData);
    }

    // getQuote's step doesn't always carry live calldata —
    // getStepTransaction fetches the actual, current transactionRequest
    // to sign, same "quote now, fresh tx data at broadcast time"
    // separation as most aggregators use since prices/calldata can
    // shift between the two calls.
    const stepWithTx = await getStepTransaction(getLiFiClient(), step);
    if (!stepWithTx.transactionRequest?.to || !stepWithTx.transactionRequest.data) {
      throw new Error("LI.FI did not return a transaction to sign for this route");
    }
    const { to, value } = stepWithTx.transactionRequest;
    let { data } = stepWithTx.transactionRequest;
    // ERC-8021 attribution suffix (Agents at Work hackathon) — same Celo-only
    // gating as awsKmsAdapter.ts's withdraw(), placed on the actual
    // value-moving bridge call, not the approve() above. Safe to append here
    // for the same reason it's safe on a plain ERC-20 transfer(): `to` is
    // LI.FI's own well-known LiFiDiamond contract (an EIP-2535 diamond
    // proxy), which forwards the ENTIRE raw calldata verbatim via
    // delegatecall to a facet that does standard Solidity ABI decoding —
    // decoding never validates msg.data.length beyond what the declared
    // parameters need, so trailing bytes past the real call are ignored
    // the same way they are on a plain transfer(). Confirmed live
    // (2026-09-02) against a real li.quest quote that `to` resolves to
    // 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE, LI.FI's canonical diamond
    // address, not some arbitrary/unaudited per-route contract.
    if (input.sourceChain.toLowerCase() === "celo") {
      data = (data + toDataSuffix(env.celoAttributionTag).slice(2)) as `0x${string}`;
    }
    const sourceTxHash = await sendRawEvmTx(input.sourceChain, to as `0x${string}`, data as `0x${string}`, value ? BigInt(value) : 0n);

    return {
      sourceTxHash,
      bridgeReference: {
        sourceChain: input.sourceChain,
        destinationChain: input.destinationChain,
        sourceTxHash,
        tool: step.tool,
      },
    };
  },

  async checkStatus(bridgeReference: Record<string, unknown>): Promise<BridgePhaseCheckResult> {
    const ref = bridgeReference as unknown as {
      sourceChain: string;
      destinationChain: string;
      sourceTxHash: string;
      tool: string;
    };

    const result = await getStatus(getLiFiClient(), {
      txHash: ref.sourceTxHash,
      bridge: ref.tool,
      fromChain: requireLiFiChainId(ref.sourceChain),
      toChain: requireLiFiChainId(ref.destinationChain),
    });

    if (result.status === "FAILED") {
      return { phase: "FAILED", detail: result.substatus ?? "lifi_failed" };
    }

    if (result.status === "DONE") {
      // PARTIAL means something didn't complete as quoted (e.g. a
      // fallback path returned a different/lesser amount) — deliberately
      // NOT treated as a clean success. By the time this is reported the
      // source leg is already irreversible, so this becomes STUCK via
      // the poller's existing safety split, not silently marked complete.
      if (result.substatus === "PARTIAL") {
        return { phase: "FAILED", detail: "lifi_partial_completion_needs_review" };
      }
      const destinationTxHash = "txHash" in result.receiving ? result.receiving.txHash : undefined;
      return { phase: "DESTINATION_CONFIRMED", destinationTxHash };
    }

    // PENDING, NOT_FOUND, or INVALID (the latter two most likely mean
    // LI.FI's indexer hasn't picked up the just-broadcast tx yet) — all
    // read as "still working on it, check again next tick."
    if (result.status === "PENDING" && result.substatus === "WAIT_SOURCE_CONFIRMATIONS") {
      return { phase: "SOURCE_PENDING" };
    }
    return { phase: "ATTESTATION_PENDING" };
  },
};
