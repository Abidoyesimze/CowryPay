"use client";
import { type Wallet } from "@/lib/backendApi";
import { DepositAddressCard } from "./DepositAddressCard";

type Props = {
  /** The default (Celo) wallet from useAuth — already loaded, no fetch needed. */
  wallet:  Wallet;
  onClose: () => void;
};

// Celo-only now (Agents at Work hackathon narrowing) — no more picker
// between EVM/Solana/Stellar deposit chains, just the one address.
export function DepositModal({ wallet, onClose }: Props) {
  return (
    <div
      className="absolute inset-0 z-[65] flex flex-col justify-end lg:items-center lg:justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-cowry-dark border-t lg:border border-cowry-border rounded-t-3xl lg:rounded-3xl overflow-hidden max-h-[88vh] lg:max-w-md lg:w-full lg:mx-4 lg:shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b border-cowry-border">
          <div className="w-10 h-1 bg-cowry-border rounded-full mx-auto mb-3 lg:hidden" />
          <div className="flex items-center justify-between gap-2">
            <span className="w-7" />
            <h2 className="text-sm font-bold text-white flex-1 text-center">Deposit</h2>
            <button onClick={onClose} className="text-cowry-muted hover:text-white text-xs px-2 py-1 transition-colors">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-6">
          <DepositAddressCard
            address={wallet.address}
            chain={wallet.chain}
            note="Send USDC or USDT on Celo to this address."
          />
        </div>
      </div>
    </div>
  );
}
