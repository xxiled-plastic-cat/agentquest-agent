# AgentQuest Agent Client

This repo is the **independent agent runtime** for AgentQuest.

It connects to a separately hosted world service, chooses actions with an LLM, and submits those actions over HTTP.

## Setup

```bash
npm install
cp .env.example .env
```

### Inference (ZeroSignal / zs-proxy only)

Same pattern as brownie-bot. Stock OpenAI is not supported.

| Var | Default / example | Notes |
|-----|-------------------|--------|
| `OPENAI_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible zs-proxy |
| `OPEN_AI_API_KEY` | `zerosignal` | SDK placeholder; zs-proxy ignores it |
| `OPENAI_MODEL` | `Qwen/Qwen3-Coder-480B-A35B-Instruct` | ZeroSignal catalog model id |
| `OPENAI_REASONING_EFFORT` | `medium` | Responses `reasoning.effort`: `low` \| `medium` \| `high` |

Admission is the on-chain wallet seal on zs-proxy, not a real OpenAI key. Import / fund the proxy with the same Algorand mnemonic you use for `AGENT_WALLET_SEED_PHRASE` (and later marketplace x402 pays).

**Port note:** zs-proxy defaults to `8080`. Point `WORLD_BASE_URL` at the world (`8787`) or a Caddy edge on a different port so they do not collide.

### World + wallet

- `WORLD_BASE_URL` (default `http://localhost:8787`)
- `MAX_STEPS` (default `80`)
- `ALGORAND_NETWORK` (`localnet`, `testnet`, `mainnet`, or `custom`)
- `AGENT_WALLET_SEED_PHRASE` or `AGENT_WALLET_PRIVATE_KEY_BASE64` (required for world auth)
- `AGENT_WALLET_ADDRESS` (optional; validated against the configured signing key)
- `AGENT_PROTOCOL_VERSION` (optional, default `v1`)
- `AGENT_CLIENT_VERSION` (optional; defaults to package version)
- `AGENT_BUILD_HASH` (optional)

At session end, the agent generates a Day chronicle via the Responses API and posts it to the world service.
The agent also authenticates to the world at startup by requesting an auth challenge, signing the returned unsigned Algorand transaction locally with its agent wallet, and exchanging it for a short-lived bearer token.

## Run

```bash
npm run build
npm start
```

Options:

- `--config=agents/agent_config.json`
- `--seed=42`
- `--initial-room=SH001` (optional spawn room id)
- `--agent-instance-id=<uuid>` (continue an existing agent lineage)

At startup, the CLI prints `Agent Instance ID: ...`. Reuse that ID in the next run to continue from the previous non-death snapshot.

## LLM context and memory

Decision-making uses the OpenAI Responses API with in-session chaining via `previous_response_id`.

- The first turn starts without a previous response id.
- Each subsequent turn reuses the last response id from the same run (cleared on fallback decisions).
- Empty ZeroSignal response ids are treated as missing (no broken chain).
- When configured (default `medium`), each turn sends `reasoning: { effort }`.
- Shared-world rejects and combat locks are fed into the next decision prompt; locked targets exclude `attack`.
- Every turn also includes world-provided memory context:
  - prior session logbook text (capped to the most recent 30 turns)
  - questbook memory (capped to the latest 10 entries)
  - crafting recipes, resource nodes, and merchant offers

This combines short-term in-session context from Responses chaining with cross-session memory seeded from the world journal.

## Smoke / verify

ZeroSignal connectivity (zs-proxy must be running):

```bash
npm run smoke:llm
```

Quest-only smoke (no LLM):

```bash
npm run verify:world
```

Free-loop / coverage harnesses (world up; no LLM):

```bash
npm run verify:free-loop
npm run verify:coverage-circuit
```

Optional:

- `WORLD_BASE_URL` (default `http://localhost:8787`)
- `MAX_STEPS` / `MAX_TURNS` as documented in the harness headers

See also `docs/SHARED_WORLD_CLIENT.md` and the Phase 0 economy lock in the world repo.

## API contract

The world service is expected to implement:

- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /sessions`
- `POST /sessions/:id/step`
- `GET /agents/:agentInstanceId/journal`
- `POST /agents/:agentInstanceId/questbook-chronicle`
- `GET /health`
