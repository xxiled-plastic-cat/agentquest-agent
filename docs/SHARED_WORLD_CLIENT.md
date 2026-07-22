# Shared World Client Guide

This document explains how the agent runtime behaves against the shared-world, tick-based world service.

## Protocol fields

`SessionStepResponse`:

- `intentAccepted: boolean`
- `rejectReason?: string`
- `fallbackApplied: boolean`
- `observation`

`TurnObservation`:

- `worldTick`
- `actionTools` (includes `requiresPayment`, `validTargets`)
- `craftingRecipes`, `resourceNodes`, `merchantOffers`
- `activeCombat` includes `npcId`, `lockedByAnotherAgent`, HP/AC values

These are represented in `src/types.ts`.

## Implemented main-loop behavior (Phase 1)

[`src/main.ts`](../src/main.ts) and [`src/llm.ts`](../src/llm.ts):

1. **Intent metadata** — after every step, the runner logs `intentAccepted`, `rejectReason`, and `fallbackApplied`, and feeds them into the next `decideAction` via `DecisionContext`.
2. **Rejected intents** — when `intentAccepted` is false, the next prompt includes shared-world feedback so the model avoids immediately repeating the same rejected action.
3. **Combat locks** — if `activeCombat.lockedByAnotherAgent` is true, `attack` is removed from selectable tools (LLM + random fallback).
4. **Responses chaining** — successful tool decisions pass `previous_response_id` on the next turn; fallback/random decisions clear the chain. Empty ZeroSignal ids are ignored.
5. **Prompt surface** — crafting recipes, resource nodes, merchant offers, and quest/combat state are included explicitly.
6. **Economy (Phase 0)** — NPC buy uses marks; NPC sell is deprecated in guidance; x402 marketplace is out of scope for the free loop.
7. **Inference (Phase 3)** — `OPENAI_BASE_URL` → zs-proxy `/v1`, placeholder `OPEN_AI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` (brownie-bot pattern). `npm run smoke:llm` checks proxy connectivity.

## Session create

Optional `initialRoom` is supported:

```bash
npm start -- --initial-room=SH001
```

Harness scenarios use this to spawn near merchants, hostiles, or quest rooms.

## Free-loop verification

Deterministic multi-scenario harness (no OpenAI key):

```bash
# world must be running at WORLD_BASE_URL (default http://localhost:8787)
npm run verify:free-loop
```

Covers quest, NPC buy (marks), equip/unequip, craft, gather, eat/rest, combat (+ best-effort lock), and chronicle writeback.

Quest-only smoke remains:

```bash
npm run verify:world
```

## Operational tips

- Run multiple agent processes against the same world service to exercise combat locks.
- Keep deterministic seeds for harness and concurrency checks.
- Prefer resilient loops that handle contested outcomes without crashing.
