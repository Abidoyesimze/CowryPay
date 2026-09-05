# CowryPay

An AI-agent-powered payments and remittance app built on **Celo** for the **Agents at Work Hackathon**. Users talk to an in-app AI agent to deposit stablecoins, send money on-chain, off-ramp to local currency, and send cross-chain — with every Celo-mainnet payout carrying the project's ERC-8021 attribution tag (`celo_9ef59d7031c8`).

Live demo: https://cowry-pay.vercel.app

## What it does

- **AI chat agent** drives the money flows — deposit, send, off-ramp quote, and cross-chain send are all initiated conversationally, with deterministic balance/address/help intents handled without an LLM.
- **Email OTP signup** via Supabase Auth; user wallets and profile are provisioned idempotently on the backend once a session exists.
- **Stablecoin deposits** to a per-user Celo mainnet deposit address (USDC/USDT), auto-credited on-chain.
- **Off-ramp to NGN** with live quotes from Paycrest (primary) and Quidax (second opinion), platform fee skimmed to a treasury.
- **Cross-chain send** from Celo to Base/Optimism via the LiFi bridge, resolving destination tokens/RPCs at send time.
- **x402 settlement** — a real USDC transfer settled over Celo's x402 facilitator.
- **ERC-8004 agent identity** with SELF protocol status checks surfaced in the app.
- **Self-custody option** on AWS KMS-signed payouts (staging branch only).

## Architecture

| Layer | Tech |
| --- | --- |
| Frontend | Next.js 14 (App Router), Tailwind, `@supabase/supabase-js`, `viem` |
| Backend | Express (TypeScript), `pg`, `jose`, `zod` |
| Auth | Supabase Auth (email OTP) — backend verifies JWTs via Supabase public JWKS |
| Database | Supabase Postgres (public schema + `auth.users` FK) |
| Chat agent | Groq (primary), Anthropic fallback |
| Off-ramp | Paycrest API + Quidax |
| Bridging | LiFi SDK (Celo → Base/Optimism) |
| On-chain tag | `@celo/attribution-tags` (ERC-8021) appended to every Celo mainnet payout |

## Repo layout

```
backend/   Express API — auth, users, wallets, deposits, withdrawals,
           off-ramp, cross-chain sends, chat, KYC, admin, webhooks
frontend/  Next.js app — onboard, verify, chat, send, off-ramp, settings
```

## Getting started

Prerequisites: Node 20+, a Supabase project, and the API keys listed in the env examples.

```bash
# Backend
cd backend
cp .env.example .env        # fill in supabase URL, Paycrest/Quidax keys, etc.
npm install
npm run dev                 # http://localhost:3001

# Frontend
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_SUPABASE_URL / anon key
npm install
npm run dev                 # http://localhost:3000
```

## Environment

See `backend/.env.example` and `frontend/.env.local.example` for every variable. Key ones:

- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` + anon key — Supabase Auth + Postgres.
- `PAYCREST_API_KEY` / `PAYCREST_API_SECRET` — off-ramp provider.
- `GROQ_API_KEY`, `ANTHROPIC_API_KEY` — chat agent LLM.
- `CELO_ATTRIBUTION_TAG` — defaults to `celo_9ef59d7031c8`, the tag registered for this repo at celobuilders.xyz; only appended on Celo mainnet sends.
- `WALLET_PROVIDER=mock` for local dev; `blockradar` or `aws-kms` for real wallets.

## Hackathon note

Registered at celobuilders.xyz (Agents at Work) under tracks
**Real World Adoption** (primary), **Value Moved**, and **Judges' Favorite**.
Attribution tag: `celo_9ef59d7031c8`. Agent wallet: `0x04d8b8eae3466b97afe789b414861c3d06e246f2`.