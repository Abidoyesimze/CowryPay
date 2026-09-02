import { getOfframpRate as getPaycrestRate, isPaycrestEligible, PAYCREST_SUPPORTED_FIAT_CURRENCIES } from "./paycrestAdapter.js";
import { getOfframpRate as getQuidaxRate, quidaxNetworkFor, QUIDAX_SUPPORTED_FIAT_CURRENCIES } from "./quidaxAdapter.js";
import { getTokenConfig } from "../wallets/chains.js";

export { isPaycrestEligible };

export type OfframpProvider = "paycrest" | "quidax";

export interface ProviderQuote {
  provider: OfframpProvider;
  // "How much fiat the user actually receives" — the one number that's
  // genuinely comparable across providers, regardless of how each
  // represents rate/fee internally (Paycrest: a rate multiplier; Quidax:
  // a fee-inclusive amount straight from their own quote).
  toAmount: string;
}

// Quidax's Celo/USDT support (quidaxNetworkFor) is docs-sourced, not
// live-verified — see quidaxAdapter.ts's own comment for exactly what
// that means. token omitted means "don't filter by token" (generic
// alt-options messaging below, not a specific real send). Gated on
// fiatCurrency too, not just chain — real bug found live: an
// eligible-chain send in an unsupported currency (e.g. UGX) was still
// being compared here, since Quidax's own endpoints don't validate
// to_currency either (see QUIDAX_SUPPORTED_FIAT_CURRENCIES's own comment).
export function isQuidaxEligible(chain: string, fiatCurrency: string, token?: string): boolean {
  return quidaxNetworkFor(chain, token) !== null && QUIDAX_SUPPORTED_FIAT_CURRENCIES.has(fiatCurrency.toUpperCase());
}

function isTokenSupportedOnChain(chain: string, token: string): boolean {
  try {
    getTokenConfig(chain.toLowerCase(), token);
    return true;
  } catch {
    return false;
  }
}

// Celo-only now (Agents at Work hackathon narrowing) — kept as its own
// list, not just `["celo"]` inlined, so explainNoProviderMessage below
// reads the same either way if a second off-ramp-eligible chain is ever
// added back.
const ALL_OFFRAMP_CHAINS = ["celo"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Every fiat currency any provider supports right now, for enumerating
// "what CAN this chain send to" — deliberately NOT limited to whichever
// currency the user originally asked about.
const ALL_SUPPORTED_FIAT_CURRENCIES = new Set([...PAYCREST_SUPPORTED_FIAT_CURRENCIES, ...QUIDAX_SUPPORTED_FIAT_CURRENCIES]);

function chainsSupportingCurrency(fiatCurrency: string): string[] {
  return ALL_OFFRAMP_CHAINS.filter((chain) => isPaycrestEligible(chain, fiatCurrency) || isQuidaxEligible(chain, fiatCurrency));
}

function currenciesReachableFromChain(chain: string): string[] {
  return [...ALL_SUPPORTED_FIAT_CURRENCIES].filter((ccy) => isPaycrestEligible(chain, ccy) || isQuidaxEligible(chain, ccy));
}

// Real incident this replaces: "No off-ramp provider is available for
// this amount/chain right now" told a user their send failed with no
// indication of WHY, or whether "right now" meant "try again in a
// minute" (implying a transient outage) versus "this combination isn't
// supported at all" (the actual, permanent reason).
export function explainNoProviderMessage(chain: string, fiatCurrency: string): string {
  const chainLabel = capitalize(chain);
  const currencyLabel = fiatCurrency.toUpperCase();
  const altChains = chainsSupportingCurrency(fiatCurrency).filter((c) => c.toLowerCase() !== chain.toLowerCase());
  const altCurrencies = currenciesReachableFromChain(chain);

  const parts = [`Sending from ${chainLabel} to ${currencyLabel} isn't supported right now.`];
  if (altChains.length > 0) {
    parts.push(`${currencyLabel} can currently be reached from: ${altChains.map(capitalize).join(", ")}.`);
  }
  if (altCurrencies.length > 0) {
    parts.push(`${chainLabel} can currently send to: ${altCurrencies.join(", ")}.`);
  }
  if (altChains.length === 0 && altCurrencies.length === 0) {
    parts.push(`${currencyLabel} isn't supported by any provider right now.`);
  }
  return parts.join(" ");
}

// Queries every eligible provider in parallel and returns whichever gives
// the user more fiat. A provider erroring out (rate-limited, momentarily
// down, amount too small for their liquidity) is treated as "not
// available this round," not a hard failure — the other still gets a
// chance to fill the order. Only throws when neither can.
export async function selectOfframpProvider(params: {
  chain: string;
  amount: string;
  fiatCurrency: string;
  // Omitted means USDC — the only token that existed before USDT support.
  token?: string;
}): Promise<ProviderQuote> {
  const token = params.token ?? "USDC";
  if (!isTokenSupportedOnChain(params.chain, token)) {
    throw new Error(`${token} isn't supported on ${params.chain} yet.`);
  }
  const paycrestPromise: Promise<ProviderQuote | null> = isPaycrestEligible(params.chain, params.fiatCurrency)
    ? getPaycrestRate({
        network: params.chain,
        token,
        amount: params.amount,
        fiatCurrency: params.fiatCurrency,
      })
        .then((q) => ({ provider: "paycrest" as const, toAmount: (Number(params.amount) * Number(q.rate)).toString() }))
        .catch(() => null)
    : Promise.resolve(null);

  const quidaxPromise: Promise<ProviderQuote | null> = isQuidaxEligible(params.chain, params.fiatCurrency, token)
    ? getQuidaxRate({ network: params.chain, token, amount: params.amount, fiatCurrency: params.fiatCurrency })
        .then((q) => ({ provider: "quidax" as const, toAmount: q.toAmount }))
        .catch(() => null)
    : Promise.resolve(null);

  const quotes = (await Promise.all([paycrestPromise, quidaxPromise])).filter((q): q is ProviderQuote => q !== null);

  if (quotes.length === 0) {
    throw new Error(explainNoProviderMessage(params.chain, params.fiatCurrency));
  }
  return quotes.reduce((best, q) => (Number(q.toAmount) > Number(best.toAmount) ? q : best));
}
