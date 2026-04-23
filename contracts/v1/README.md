# Agent Contract Pin (v1)

This repo is pinned to the AgentQuest world API contract version **v1**.

Expected endpoints:

- `GET /health`
- `POST /auth/challenge`
- `POST /auth/verify`
- `POST /sessions`
- `POST /sessions/:id/step`

Write routes are authenticated with a short-lived bearer token obtained by:

1. requesting `POST /auth/challenge`
   - include `network` (`localnet|testnet|mainnet|custom`) in the challenge request
2. signing the returned unsigned Algorand transaction locally
3. exchanging it via `POST /auth/verify`
4. attaching `Authorization: Bearer <accessToken>` to write calls

Versioning rules:

- If world introduces breaking payload changes, this repo must upgrade to `contracts/v2`.
- Keep local DTOs in `src/types.ts` synchronized with the world contract.
