import type { BridgeAdapter } from "./adapter.js";
import { liFiAdapter } from "./liFiAdapter.js";

// Celo-only-source narrowing (Agents at Work hackathon): the source side of
// a cross-chain send is always Celo now (the only chain with a real
// deposit/balance), and Celo isn't a CCTP domain at all (confirmed against
// both Circle's docs and their own SDK internals) — so every real call here
// resolves to liFiAdapter.ts, which composes whichever underlying bridge +
// swap actually delivers the real, canonical destination token on
// Base/Optimism. The plain CCTP adapter and the hand-built Stellar
// Soroban integration this used to dispatch to for non-Celo pairs are gone
// — they were only ever reachable via a source chain that no longer has a
// balance to send from. Kept as a function (not just calling liFiAdapter
// directly) so crossChainSend/service.ts's own explicit sourceChain==="celo"
// guard stays the actual enforcement point, not this dispatch.
export function getBridgeAdapter(sourceChain: string, destinationChain: string): BridgeAdapter {
  void sourceChain;
  void destinationChain;
  return liFiAdapter;
}
