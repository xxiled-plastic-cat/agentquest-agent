#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const defaultConfigPath = resolve(repoRoot, "agents", "agent_treasure_hunter.json");

const WORLD_BASE_URL = process.env.WORLD_BASE_URL ?? "http://localhost:8787";
const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "30", 10);
const QUEST_GIVER_NAME = "Eldra Moonwell";
const REQUIRED_ITEM_ID = "bruswick_seal";
const REWARD_ITEM_ID = "moonwell_charm";

function parseArgs(argv) {
  const out = {
    configPath: defaultConfigPath,
    seed: 42,
  };

  for (const arg of argv) {
    if (arg.startsWith("--config=")) {
      out.configPath = resolve(repoRoot, arg.slice("--config=".length));
    } else if (arg.startsWith("--seed=")) {
      const n = parseInt(arg.slice("--seed=".length), 10);
      if (!Number.isNaN(n)) out.seed = n;
    }
  }
  return out;
}

async function expectOkJson(res, label) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${label} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function checkHealth() {
  const res = await fetch(`${WORLD_BASE_URL}/health`);
  const body = await expectOkJson(res, "World health check");
  if (!body?.ok) {
    throw new Error("World health check returned unexpected payload.");
  }
}

function chooseDeterministicDecision(observation) {
  if (observation.terminal) return null;
  const itemCount = observation.inventory?.items?.[REQUIRED_ITEM_ID] ?? 0;
  const rewardItemCount = observation.inventory?.items?.[REWARD_ITEM_ID] ?? 0;
  const hasActiveQuest = !!observation.activeQuest;
  const canTalk = observation.availableActions.includes("talk");
  const canSearch = observation.availableActions.includes("search");

  if (observation.currentRoom === "HL001" && canTalk && !hasActiveQuest && rewardItemCount === 0) {
    return {
      action: "action",
      actionName: "talk",
      target: QUEST_GIVER_NAME,
      reason: "Smoke-test: acquire the starter retrieval quest.",
    };
  }

  if (observation.currentRoom === "HL001" && canTalk && itemCount > 0) {
    return {
      action: "action",
      actionName: "talk",
      target: QUEST_GIVER_NAME,
      reason: "Smoke-test: turn in required quest item for reward.",
    };
  }

  if (observation.currentRoom === "BC001" && observation.discoveredPOIs.includes("torn banner") && itemCount <= 0) {
    return {
      action: "action",
      actionName: "inspect",
      target: "torn banner",
      reason: "Smoke-test target: retrieve quest item from castle.",
    };
  }

  if (canSearch) {
    return {
      action: "action",
      actionName: "search",
      reason: "Smoke-test progression: reveal exits and items.",
    };
  }

  if (observation.currentRoom === "HL001" && observation.knownExits.includes("north") && itemCount <= 0) {
    return {
      action: "move",
      direction: "north",
      reason: "Smoke-test route: move to castle for quest item.",
    };
  }

  if (observation.currentRoom === "BC001" && observation.knownExits.includes("south") && itemCount > 0) {
    return {
      action: "move",
      direction: "south",
      reason: "Smoke-test route: return to quest giver with item.",
    };
  }

  if (observation.knownExits.length > 0) {
    return {
      action: "move",
      direction: observation.knownExits[0],
      reason: "Smoke-test fallback route.",
    };
  }

  if (observation.availableActions.length > 0) {
    return {
      action: "action",
      actionName: observation.availableActions[0],
      reason: "Smoke-test fallback action.",
    };
  }

  return {
    action: "move",
    direction: "north",
    reason: "Smoke-test no-op fallback.",
  };
}

async function createSession(config, seed) {
  const res = await fetch(`${WORLD_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: config.name, config, seed }),
  });
  return expectOkJson(res, "Create session");
}

async function stepSession(sessionId, decision) {
  const res = await fetch(`${WORLD_BASE_URL}/sessions/${sessionId}/step`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return expectOkJson(res, "Step session");
}

async function run() {
  const { configPath, seed } = parseArgs(process.argv.slice(2));
  const config = JSON.parse(readFileSync(configPath, "utf-8"));

  console.log(`World API: ${WORLD_BASE_URL}`);
  console.log(`Config: ${configPath}`);
  console.log(`Seed: ${seed}`);
  await checkHealth();
  console.log("Health check: OK");

  const created = await createSession(config, seed);
  const sessionId = created.sessionId;
  let observation = created.observation;
  let steps = 0;

  console.log(`Session: ${sessionId}`);
  while (!observation.terminal && steps < MAX_STEPS) {
    const decision = chooseDeterministicDecision(observation);
    if (!decision) break;
    const result = await stepSession(sessionId, decision);
    observation = result.observation;
    steps += 1;
    console.log(
      `Step ${steps}: ${decision.action === "move" ? `move ${decision.direction}` : decision.actionName} -> ${result.lastResult}`
    );
  }

  const finalTreasure = observation.inventory?.treasure ?? 0;
  const finalItems = observation.inventory?.items ?? {};
  const rewardItemCount = finalItems[REWARD_ITEM_ID] ?? 0;
  const requiredItemRemaining = finalItems[REQUIRED_ITEM_ID] ?? 0;

  if (finalTreasure < 2) {
    throw new Error(`Expected treasure reward >= 2, got ${finalTreasure}.`);
  }
  if (rewardItemCount < 1) {
    throw new Error(`Expected reward item ${REWARD_ITEM_ID}, got ${rewardItemCount}.`);
  }
  if (requiredItemRemaining !== 0) {
    throw new Error(`Expected ${REQUIRED_ITEM_ID} to be consumed on turn-in, got ${requiredItemRemaining}.`);
  }

  console.log(`End reason: ${observation.endReason ?? "unknown"}`);
  console.log(`Treasure: ${finalTreasure}`);
  console.log(`Items: ${JSON.stringify(finalItems)}`);
  console.log("Smoke test passed: quest giver talk/retrieval/turn-in flow confirmed.");
}

run().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
