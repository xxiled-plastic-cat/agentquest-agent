#!/usr/bin/env node

/**
 * Deterministic free-loop harness (no LLM).
 * Requires a running world at WORLD_BASE_URL (default http://localhost:8787).
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeUnsignedTransaction, generateAccount, signTransaction } from "algosdk"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const defaultConfigPath = resolve(repoRoot, "agents", "agent_treasure_hunter.json")

const WORLD_BASE_URL = process.env.WORLD_BASE_URL ?? "http://localhost:8787"
const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "40", 10)

const QUEST_GIVER_NAME = "Mara Thatch, Woodward of Stag Hollow"
const REQUIRED_ITEM_ID = "boundary_token"
const REWARD_ITEM_ID = "woodward_badge"
const MERCHANT_ID = "sh_merchant_01"
const TOKEN_POI = "stolen boundary token"

async function expectOkJson(res, label) {
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${label} failed: ${res.status} ${body}`)
  }
  return res.json()
}

async function checkHealth() {
  const res = await fetch(`${WORLD_BASE_URL}/health`)
  const body = await expectOkJson(res, "World health check")
  if (!body?.ok) throw new Error("World health check returned unexpected payload.")
}

async function authenticate() {
  const account = generateAccount()
  const challenge = await expectOkJson(
    await fetch(`${WORLD_BASE_URL}/auth/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: account.addr.toString(),
        protocolVersion: "v1",
        clientVersion: "verify-free-loop",
      }),
    }),
    "Auth challenge"
  )
  const txn = decodeUnsignedTransaction(Buffer.from(challenge.unsignedTransaction, "base64"))
  const signed = signTransaction(txn, account.sk)
  const verified = await expectOkJson(
    await fetch(`${WORLD_BASE_URL}/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        signedTransaction: Buffer.from(signed.blob).toString("base64"),
      }),
    }),
    "Auth verify"
  )
  return verified.accessToken
}

async function createSession(config, seed, accessToken, initialRoom) {
  const res = await fetch(`${WORLD_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      agentId: config.name,
      config,
      seed,
      ...(initialRoom ? { initialRoom } : {}),
    }),
  })
  return expectOkJson(res, "Create session")
}

async function stepSession(sessionId, decision, accessToken) {
  const res = await fetch(`${WORLD_BASE_URL}/sessions/${sessionId}/step`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ decision }),
  })
  return expectOkJson(res, "Step session")
}

async function getJournal(agentInstanceId) {
  const res = await fetch(`${WORLD_BASE_URL}/agents/${encodeURIComponent(agentInstanceId)}/journal`)
  return expectOkJson(res, "Get journal")
}

async function setChronicle(agentInstanceId, sessionId, chronicleEntry, accessToken) {
  const res = await fetch(
    `${WORLD_BASE_URL}/agents/${encodeURIComponent(agentInstanceId)}/questbook-chronicle`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ sessionId, chronicleEntry }),
    }
  )
  return expectOkJson(res, "Set questbook chronicle")
}

function itemCount(observation, itemId) {
  return observation.inventory?.bag?.items?.[itemId] ?? 0
}

function hasAction(observation, name) {
  return (observation.availableActions ?? []).includes(name) ||
    (observation.actionTools ?? []).some((tool) => tool.name === name)
}

function buyTarget(itemId, quantity = 1) {
  return `${MERCHANT_ID}:${itemId}:${quantity}`
}

async function runScripted(label, accessToken, config, seed, initialRoom, chooseDecision, assertDone) {
  console.log(`\n=== Scenario: ${label} ===`)
  const created = await createSession(config, seed, accessToken, initialRoom)
  let observation = created.observation
  let lastStep = null
  let steps = 0

  while (!observation.terminal && steps < MAX_STEPS) {
    const decision = chooseDecision(observation, { steps, lastStep, created })
    if (!decision) break
    lastStep = await stepSession(created.sessionId, decision, accessToken)
    observation = lastStep.observation
    steps += 1
    const actionLabel =
      decision.action === "move" ? `move ${decision.direction}` : `${decision.actionName}${decision.target ? `:${decision.target}` : ""}`
    console.log(
      `  Step ${steps}: ${actionLabel} | intent=${lastStep.intentAccepted ? "ok" : "reject"} | ${lastStep.lastResult}`
    )
    if (assertDone({ observation, lastStep, created, steps })) {
      console.log(`  PASS ${label}`)
      return { created, observation, lastStep }
    }
  }

  throw new Error(`Scenario "${label}" did not complete within ${MAX_STEPS} steps.`)
}

function questDecision(observation) {
  if (observation.terminal) return null
  const itemCountToken = itemCount(observation, REQUIRED_ITEM_ID)
  const rewardCount = itemCount(observation, REWARD_ITEM_ID)
  const hasActiveQuest = !!observation.activeQuest
  const canTalk = hasAction(observation, "talk")
  const canSearch = hasAction(observation, "search")
  const pois = observation.discoveredPOIs ?? []

  if (observation.currentRoom === "SH001" && canTalk && !hasActiveQuest && rewardCount === 0) {
    return {
      action: "action",
      actionName: "talk",
      target: QUEST_GIVER_NAME,
      reason: "Acquire Stag Hollow retrieval quest.",
    }
  }
  if (observation.currentRoom === "SH001" && canTalk && itemCountToken > 0) {
    return {
      action: "action",
      actionName: "talk",
      target: QUEST_GIVER_NAME,
      reason: "Turn in boundary token.",
    }
  }
  if (observation.currentRoom === "OB006" && pois.includes(TOKEN_POI) && itemCountToken <= 0) {
    return {
      action: "action",
      actionName: "inspect",
      target: TOKEN_POI,
      reason: "Retrieve boundary token.",
    }
  }

  // Return to SH001 with the token (before generic search).
  if (itemCountToken > 0) {
    if (observation.currentRoom === "OB006" && observation.knownExits.includes("south")) {
      return { action: "move", direction: "south", reason: "Back via OB003." }
    }
    if (observation.currentRoom === "OB003" && observation.knownExits.includes("west")) {
      return { action: "move", direction: "west", reason: "Back via OB002." }
    }
    if (observation.currentRoom === "OB002" && observation.knownExits.includes("west")) {
      return { action: "move", direction: "west", reason: "Back via OB001." }
    }
    if (observation.currentRoom === "OB001" && observation.knownExits.includes("south")) {
      return { action: "move", direction: "south", reason: "Back to SH002." }
    }
    if (observation.currentRoom === "SH002" && observation.knownExits.includes("south")) {
      return { action: "move", direction: "south", reason: "Return to quest giver." }
    }
  }

  // Route toward OB006 with the token still needed.
  if (itemCountToken <= 0) {
    if (observation.currentRoom === "SH001" && observation.knownExits.includes("north")) {
      return { action: "move", direction: "north", reason: "Toward shrine / old boundary." }
    }
    if (observation.currentRoom === "SH002" && observation.knownExits.includes("north")) {
      return { action: "move", direction: "north", reason: "To OB001." }
    }
    if (observation.currentRoom === "OB001" && observation.knownExits.includes("north")) {
      return { action: "move", direction: "north", reason: "To OB002." }
    }
    if (observation.currentRoom === "OB002" && observation.knownExits.includes("east")) {
      return { action: "move", direction: "east", reason: "To OB003." }
    }
    if (observation.currentRoom === "OB003" && observation.knownExits.includes("east")) {
      return { action: "move", direction: "east", reason: "To OB006 token room." }
    }
  }

  if (canSearch) {
    return { action: "action", actionName: "search", reason: "Reveal exits/items." }
  }

  if (observation.knownExits.length > 0) {
    return { action: "move", direction: observation.knownExits[0], reason: "Fallback move." }
  }
  return null
}

function merchantBuyDecision(observation, ctx) {
  if (hasAction(observation, "buy") && itemCount(observation, "ration") < (ctx.startRations ?? 0) + 1) {
    return {
      action: "action",
      actionName: "buy",
      target: buyTarget("ration", 1),
      reason: "Buy ration with marks.",
    }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal merchant actions." }
  }
  return null
}

function equipDecision(observation) {
  const equippedRight = observation.inventory?.equipped?.rightHand
  const equippedLeft = observation.inventory?.equipped?.leftHand
  if (equippedRight === "club" || equippedLeft === "club") {
    return {
      action: "action",
      actionName: "unequip",
      target: "club",
      reason: "Unequip club.",
    }
  }
  if (itemCount(observation, "club") > 0 && hasAction(observation, "equip")) {
    return {
      action: "action",
      actionName: "equip",
      target: "club",
      reason: "Equip club.",
    }
  }
  if (hasAction(observation, "buy") && itemCount(observation, "club") === 0) {
    return {
      action: "action",
      actionName: "buy",
      target: buyTarget("club", 1),
      reason: "Buy club for equip test.",
    }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal buy/equip." }
  }
  return null
}

function craftDecision(observation) {
  if (hasAction(observation, "craft")) {
    const craftTool = (observation.actionTools ?? []).find((tool) => tool.name === "craft")
    const recipeId =
      craftTool?.validTargets?.find((target) => target.id === "trail_kit_ration")?.id ??
      craftTool?.validTargets?.[0]?.id ??
      "trail_kit_ration"
    return {
      action: "action",
      actionName: "craft",
      target: recipeId,
      reason: "Craft trail kit ration.",
    }
  }
  if (hasAction(observation, "buy")) {
    if (itemCount(observation, "deer_hide") < 1) {
      return {
        action: "action",
        actionName: "buy",
        target: buyTarget("deer_hide", 1),
        reason: "Buy craft ingredient deer_hide.",
      }
    }
    if (itemCount(observation, "charcoal_bundle") < 1) {
      return {
        action: "action",
        actionName: "buy",
        target: buyTarget("charcoal_bundle", 1),
        reason: "Buy craft ingredient charcoal_bundle.",
      }
    }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal craft/buy." }
  }
  return null
}

function gatherDecision(observation) {
  if (hasAction(observation, "chop")) {
    const chopTool = (observation.actionTools ?? []).find((tool) => tool.name === "chop")
    const target = chopTool?.validTargets?.[0]?.id
    if (target) {
      return { action: "action", actionName: "chop", target, reason: "Chop resource node." }
    }
  }
  if (hasAction(observation, "buy") && itemCount(observation, "axe") < 1) {
    return {
      action: "action",
      actionName: "buy",
      target: buyTarget("axe", 1),
      reason: "Buy axe for gather.",
    }
  }
  // SH001 -> west SH004 -> north CB002 -> west CB001
  if (observation.currentRoom === "SH001" && observation.knownExits.includes("west")) {
    return { action: "move", direction: "west", reason: "Toward charcoal burns." }
  }
  if (observation.currentRoom === "SH004" && observation.knownExits.includes("north")) {
    return { action: "move", direction: "north", reason: "To CB002." }
  }
  if (observation.currentRoom === "CB002" && observation.knownExits.includes("west")) {
    return { action: "move", direction: "west", reason: "To CB001 gather node." }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal exits/nodes." }
  }
  if (observation.knownExits.length > 0) {
    return { action: "move", direction: observation.knownExits[0], reason: "Explore toward nodes." }
  }
  return null
}

function survivalDecision(observation, ctx) {
  if (!ctx.didEat && hasAction(observation, "eat") && itemCount(observation, "ration") > 0) {
    ctx.didEat = true
    return { action: "action", actionName: "eat", reason: "Eat ration." }
  }
  if (ctx.didEat && !ctx.didRest && hasAction(observation, "rest")) {
    ctx.didRest = true
    return { action: "action", actionName: "rest", reason: "Rest after eat." }
  }
  if (!ctx.didEat && hasAction(observation, "buy") && itemCount(observation, "ration") === 0) {
    return {
      action: "action",
      actionName: "buy",
      target: buyTarget("ration", 1),
      reason: "Ensure food for eat test.",
    }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal survival actions." }
  }
  return null
}

function combatDecision(observation) {
  if (hasAction(observation, "attack")) {
    return { action: "action", actionName: "attack", reason: "Engage hostile." }
  }
  if (hasAction(observation, "search")) {
    return { action: "action", actionName: "search", reason: "Reveal hostile." }
  }
  return null
}

async function runCombatLockScenario(accessToken, config, seed) {
  console.log("\n=== Scenario: combat (single + lock best-effort) ===")
  const a = await createSession(config, seed, accessToken, "OB005")
  const b = await createSession(config, seed + 1, accessToken, "OB005")

  let obsA = a.observation
  let sawCombat = false
  let sawLock = false

  for (let i = 0; i < 12; i += 1) {
    if (obsA.terminal) break
    const decisionA = combatDecision(obsA) ?? {
      action: "action",
      actionName: "search",
      reason: "Find hostile.",
    }
    const stepA = await stepSession(a.sessionId, decisionA, accessToken)
    obsA = stepA.observation
    if (obsA.activeCombat) sawCombat = true
    if (obsA.activeCombat?.lockedByAnotherAgent) sawLock = true
    console.log(
      `  A${i + 1}: intent=${stepA.intentAccepted ? "ok" : "reject"} combat=${obsA.activeCombat ? "yes" : "no"} lock=${obsA.activeCombat?.lockedByAnotherAgent ? "yes" : "no"} | ${stepA.lastResult}`
    )

    if (!b.observation.terminal) {
      const decisionB = combatDecision(b.observation) ?? {
        action: "action",
        actionName: "search",
        reason: "Contest combat.",
      }
      const stepB = await stepSession(b.sessionId, decisionB, accessToken)
      b.observation = stepB.observation
      if (b.observation.activeCombat?.lockedByAnotherAgent) sawLock = true
      if (obsA.activeCombat?.lockedByAnotherAgent) sawLock = true
      console.log(
        `  B${i + 1}: intent=${stepB.intentAccepted ? "ok" : "reject"} lock=${b.observation.activeCombat?.lockedByAnotherAgent ? "yes" : "no"} | ${stepB.lastResult}`
      )
    }

    if (sawCombat && (sawLock || !obsA.activeCombat || obsA.terminal)) break
  }

  if (!sawCombat) {
    throw new Error("Combat scenario: never entered activeCombat at OB005.")
  }
  console.log(
    sawLock
      ? "  PASS combat (engaged + observed lockedByAnotherAgent)"
      : "  PASS combat (engaged; lock not observed — single-agent combat ok)"
  )
  return { created: a, observation: obsA }
}

async function runChronicleScenario(accessToken, config, seed) {
  console.log("\n=== Scenario: chronicle ===")
  // Fight until death for a terminal session, then write chronicle.
  const created = await createSession(config, seed, accessToken, "OB005")
  let observation = created.observation
  let steps = 0
  while (!observation.terminal && steps < MAX_STEPS) {
    const decision = combatDecision(observation) ?? {
      action: "action",
      actionName: "search",
      reason: "Find hostile for terminal session.",
    }
    const step = await stepSession(created.sessionId, decision, accessToken)
    observation = step.observation
    steps += 1
    console.log(`  Step ${steps}: ${decision.actionName ?? decision.direction} | ${step.lastResult}`)
  }
  if (!observation.terminal) {
    throw new Error("Chronicle scenario: session never became terminal.")
  }
  const journal = await getJournal(created.agentInstanceId)
  const entry = journal.journal.questbook.find((q) => q.sessionId === created.sessionId)
  if (!entry) {
    throw new Error("Chronicle scenario: questbook entry missing after terminal session.")
  }
  await setChronicle(
    created.agentInstanceId,
    created.sessionId,
    "Day verify: free-loop harness confirmed chronicle writeback.",
    accessToken
  )
  const after = await getJournal(created.agentInstanceId)
  const updated = after.journal.questbook.find((q) => q.sessionId === created.sessionId)
  if (!updated?.chronicleEntry?.includes("free-loop harness")) {
    throw new Error("Chronicle scenario: chronicle entry was not saved.")
  }
  console.log("  PASS chronicle")
}

async function run() {
  const config = JSON.parse(readFileSync(defaultConfigPath, "utf-8"))
  console.log(`World API: ${WORLD_BASE_URL}`)
  await checkHealth()
  console.log("Health check: OK")
  const accessToken = await authenticate()
  console.log("Wallet auth: OK")

  await runScripted(
    "quest",
    accessToken,
    config,
    42,
    "SH001",
    (obs) => questDecision(obs),
    ({ observation }) =>
      itemCount(observation, REWARD_ITEM_ID) >= 1 && itemCount(observation, REQUIRED_ITEM_ID) === 0
  )

  let startRations = 0
  await runScripted(
    "merchant-buy",
    accessToken,
    config,
    7,
    "SH001",
    (obs, ctx) => {
      if (ctx.steps === 0) startRations = itemCount(obs, "ration")
      return merchantBuyDecision(obs, { startRations })
    },
    ({ observation, lastStep }) => {
      if (!lastStep) return false
      const bought = itemCount(observation, "ration") > startRations
      return bought && lastStep.intentAccepted !== false
    }
  )

  let didEquip = false
  let didUnequip = false
  await runScripted(
    "equip",
    accessToken,
    config,
    11,
    "SH001",
    (obs) => equipDecision(obs),
    ({ observation }) => {
      const right = observation.inventory?.equipped?.rightHand
      const left = observation.inventory?.equipped?.leftHand
      if (right === "club" || left === "club") didEquip = true
      if (didEquip && itemCount(observation, "club") >= 1 && right !== "club" && left !== "club") {
        didUnequip = true
      }
      return didEquip && didUnequip
    }
  )

  let rationsBeforeCraft = 0
  await runScripted(
    "craft",
    accessToken,
    config,
    13,
    "SH001",
    (obs, ctx) => {
      if (ctx.steps === 0) rationsBeforeCraft = itemCount(obs, "ration")
      return craftDecision(obs)
    },
    ({ observation }) => itemCount(observation, "ration") > rationsBeforeCraft
  )

  let woodBefore = 0
  await runScripted(
    "gather",
    accessToken,
    config,
    17,
    "SH001",
    (obs, ctx) => {
      if (ctx.steps === 0) woodBefore = itemCount(obs, "wood")
      return gatherDecision(obs)
    },
    ({ observation, lastStep }) => {
      const gained = itemCount(observation, "wood") > woodBefore
      const chopText = /\b(cut|chop|poles?)\b/i.test(lastStep?.lastResult ?? "")
      return gained || chopText
    }
  )

  const survivalCtx = { didEat: false, didRest: false }
  await runScripted(
    "eat-rest",
    accessToken,
    config,
    19,
    "SH001",
    (obs) => survivalDecision(obs, survivalCtx),
    () => survivalCtx.didEat && survivalCtx.didRest
  )

  await runCombatLockScenario(accessToken, config, 23)
  await runChronicleScenario(accessToken, config, 29)

  console.log("\nAll free-loop scenarios passed.")
}

run().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
