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

## API contract

The world service is expected to implement:

- `POST /sessions`
- `POST /sessions/:id/step`
- `GET /health`