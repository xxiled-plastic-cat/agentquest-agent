# Agent Contract Pin (v1)

This repo is pinned to the AgentQuest world API contract version **v1**.

Authoritative world pin (keep in sync):

- `agent-world-poc/contracts/v1/README.md`
- Economy lock: `agent-world-poc/docs/PHASE0_ECONOMY_AND_ACTIONS.md`

## Target economy (Phase 0)

| Rail | Use |
|------|-----|
| Marks | Soft currency for NPC merchant **buy** and world rewards |
| Free `/step` | Exploration, combat, craft, gather, NPC buy (marks) |
| x402 | **Only** future `marketplace_buy` (crafted) — not implemented yet |
| NPC `sell` | **Deprecated** — do not use in new agent logic or tests |
| Item-breakdown salvage | Out of scope |

## Expected endpoints

### Required for free agent loop

- `GET /health`
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /sessions`
- `POST /sessions/:id/step`
- `GET /agents/:agentInstanceId/journal`
- `POST /agents/:agentInstanceId/questbook-chronicle`

### Present on world (optional / later for this client)

- `GET /lore`, `GET /lore/:slug`
- `GET /journal/timeline`
- `POST /sessions/:id/payments/quote`
- `POST /sessions/:id/paid-action`
- `GET /x402/quote` (Caddy broker only — agents must not call this)

## Auth

Write routes use a short-lived bearer token:

1. `POST /auth/challenge` — include `network` (`localnet|testnet|mainnet|custom`)
2. Sign the returned unsigned Algorand transaction locally
3. `POST /auth/verify`
4. Attach `Authorization: Bearer <accessToken>` to write calls

## Observation fields agents must handle

Keep local DTOs in `src/types.ts` aligned with the world pin:

- `vitality` (`maxHealth`, `health`, `maxStamina`, `stamina`) — not legacy flat `health`/`hunger`
- `worldTick`
- `marks`
- `actionTools[]` with `requiresPayment`, `consumesTurn`, `validTargets`
- `merchantOffers`, `craftingRecipes`, `resourceNodes`
- `intentAccepted` / `rejectReason` on step responses (shared-world contention)

NPC `buy` is marks-priced and free of x402 (`requiresPayment: false` in target). Do not route NPC commerce through quote/paid-action for new work.

## Payments (client expectations)

- Experimental quote/paid-action helpers may exist for transitional world types.
- **Target:** only wire the main loop to x402 for `marketplace_buy` when marketplace exists.
- Prefer GoPlausible via Caddy when live; do not depend on a custom local facilitator for production paths.

## Versioning rules

- If world introduces breaking payload changes, this repo must upgrade to `contracts/v2`.
- Non-breaking documentation catch-up (Phase 0) stays on v1.
- Keep local DTOs in `src/types.ts` synchronized with the world contract.
