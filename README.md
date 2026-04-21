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

## Run

```bash
npm run build
npm start
```

Options:

- `--config=agents/agent_config.json`
- `--seed=42`

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
- `GET /health`