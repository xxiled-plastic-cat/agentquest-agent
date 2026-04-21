# Agent Contract Pin (v1)

This repo is pinned to the AgentQuest world API contract version **v1**.

Expected endpoints:

- `GET /health`
- `POST /sessions`
- `POST /sessions/:id/step`

Versioning rules:

- If world introduces breaking payload changes, this repo must upgrade to `contracts/v2`.
- Keep local DTOs in `src/types.ts` synchronized with the world contract.
