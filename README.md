# AgentQuest Agent Client

This repo is the **independent agent runtime** for AgentQuest.

It connects to a separately hosted world service, chooses actions with an LLM, and submits those actions over HTTP.

## Setup

```bash
npm install
cp .env.example .env
```

Set environment values:

- `OPENAI_API_KEY` (required)
- `MODEL` (optional, default `gpt-4.1-mini`)
- `WORLD_BASE_URL` (default `http://localhost:8787`)
- `MAX_STEPS` (default `80`)

At session end, the agent uses its own OpenAI key to generate a Day entry for the questlog and sends it to the world service.

## Run

```bash
npm run build
npm start
```

Options:

- `--config=agents/agent_config.json`
- `--seed=42`
- `--agent-instance-id=<uuid>` (continue an existing agent lineage)

At startup, the CLI prints `Agent Instance ID: ...`. Reuse that ID in the next run to continue from the previous non-death snapshot.

## LLM context and memory

Decision-making uses the OpenAI Responses API with in-session chaining via `previous_response_id`.

- The first turn starts without a previous response id.
- Each subsequent turn reuses the last response id from the same run.
- Every turn also includes world-provided memory context:
  - prior session logbook text (capped to the most recent 30 turns)
  - questbook memory (capped to the latest 10 entries)

This combines short-term in-session context from Responses chaining with cross-session memory seeded from the world journal.

## Smoke verify (no OpenAI key needed)

This deterministic check validates:

- world service is healthy (`GET /health`)
- session creation works (`POST /sessions`)
- an agent can complete a successful run-through (`endReason: treasure`)

Run:

```bash
npm run verify:world
```

Optional:

- `WORLD_BASE_URL` (default `http://localhost:8787`)
- `MAX_STEPS` (default `20` for smoke verification)
- `npm run verify:world -- --config=agents/agent_explorer.json --seed=7`

## API contract

The world service is expected to implement:

- `POST /sessions`
- `POST /sessions/:id/step`
- `GET /agents/:agentInstanceId/journal`
- `POST /agents/:agentInstanceId/questbook-chronicle`
- `GET /health`