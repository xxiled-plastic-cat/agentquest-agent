# Shared World Client Guide

This document explains how the agent runtime should behave against the shared-world, tick-based world service.

## What Changed

The world service now resolves actions on a global tick queue and can reject/defer contested enemy interactions.

The agent client receives extra metadata in step responses and observations to reason about shared-state concurrency.

## Protocol Fields Used by Agent

`SessionStepResponse`:

- `intentAccepted: boolean`
- `rejectReason?: string`
- `fallbackApplied: boolean`
- `observation`

`TurnObservation`:

- `worldTick`
- `activeCombat` now includes:
  - `npcId`
  - `lockedByAnotherAgent`
  - HP/AC values

These are represented in:

- `src/types.ts`

## Prompting / Decision Behavior

`src/llm.ts` prompt now includes:

- current world tick
- combat lock context for active combat target

Guidance includes:

- if combat target is locked by another agent, avoid repeated invalid attack attempts and choose another valid action

## Runtime Logging

`src/main.ts` now prints:

- local turn + world tick (`TURN X (WORLD TICK Y)`)
- dynamic health/max health

This helps diagnose queue/tick timing effects in concurrent runs.

## Recommended Client Handling

When integrating additional client logic, handle response metadata explicitly:

1. If `intentAccepted` is `false`, inspect `rejectReason` and decide retry/backoff strategy.
2. If `fallbackApplied` is `true`, treat the step as server-corrected and avoid repeating invalid choice patterns.
3. Use `worldTick` for debugging and optional pacing controls.
4. Respect `lockedByAnotherAgent` in combat planning to reduce contention loops.

## Operational Tips

- Run multiple agent processes against the same world service to test contention behavior.
- Keep deterministic seeds where possible during load/concurrency tests.
- Prefer resilient loops that can handle stale or contested outcomes without crashing.
