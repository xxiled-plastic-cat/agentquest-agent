#!/usr/bin/env node

/**
 * Phase 2 coverage-circuit harness (no LLM).
 * Single session from SH001 — no initialRoom teleports.
 * Requires world at WORLD_BASE_URL (default http://localhost:8787)
 * with MAX_TURNS high enough (recommend ≥100; default world is 40).
 *
 * See agent-world-poc/docs/COVERAGE_CIRCUIT.md
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeUnsignedTransaction, generateAccount, signTransaction } from "algosdk"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const defaultConfigPath = resolve(repoRoot, "agents", "agent_treasure_hunter.json")

const WORLD_BASE_URL = process.env.WORLD_BASE_URL ?? "http://localhost:8787"
const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "120", 10)

const QUEST_GIVER_NAME = "Mara Thatch, Woodward of Stag Hollow"
const REQUIRED_ITEM_ID = "boundary_token"
const REWARD_ITEM_ID = "woodward_badge"
const MERCHANT_ID = "sh_merchant_01"
const TOKEN_POI = "stolen boundary token"
const PURSE_POI = "contingency purse"
const REPAIR_POI = "repair bin"

const BUY_LIST = [
  ["deer_hide", 1],
  ["charcoal_bundle", 1],
  ["pickaxe", 1],
  ["axe", 1],
  ["muriels_guide_to_plants_and_other_fauna", 1],
  ["fishing_rod", 1],
  ["salvage_tools", 1],
]

/** Prefer club; fall back if merchant stock is depleted in shared runtime. */
const EQUIP_CANDIDATES = ["club", "dagger", "handaxe"]

/** Free actionTools / occurrences the circuit must fire at least once. */
const REQUIRED_ACTIONS = [
  "move",
  "search",
  "inspect",
  "talk",
  "buy",
  "craft",
  "equip",
  "unequip",
  "eat",
  "rest",
  "use",
  "mine",
  "chop",
  "forage",
  "fish",
  "salvage",
  "attack",
]

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
        clientVersion: "verify-coverage-circuit",
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

async function createSession(config, seed, accessToken) {
  const res = await fetch(`${WORLD_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      agentId: `${config.name}-coverage`,
      config,
      seed,
      initialRoom: "SH001",
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
  return (
    (observation.availableActions ?? []).includes(name) ||
    (observation.actionTools ?? []).some((tool) => tool.name === name)
  )
}

function buyTarget(itemId, quantity = 1) {
  return `${MERCHANT_ID}:${itemId}:${quantity}`
}

function gatherTarget(observation, actionName, fallback) {
  const tool = (observation.actionTools ?? []).find((t) => t.name === actionName)
  return tool?.validTargets?.[0]?.id ?? tool?.validTargets?.[0]?.name ?? fallback
}

function move(direction, reason) {
  return { action: "move", direction, reason }
}

function act(actionName, target, reason) {
  return {
    action: "action",
    actionName,
    ...(target != null ? { target } : {}),
    reason,
  }
}

function searchIfNeeded(observation, reason = "Reveal exits/POIs.") {
  if (hasAction(observation, "search")) {
    return act("search", undefined, reason)
  }
  return null
}

function go(observation, direction, reason) {
  const s = searchIfNeeded(observation)
  if (s) return s
  if ((observation.knownExits ?? []).includes(direction)) {
    return move(direction, reason)
  }
  return null
}

function clubEquipped(observation) {
  const right = observation.inventory?.equipped?.rightHand
  const left = observation.inventory?.equipped?.leftHand
  return EQUIP_CANDIDATES.includes(right) || EQUIP_CANDIDATES.includes(left)
}

function equippedWeapon(observation) {
  const right = observation.inventory?.equipped?.rightHand
  const left = observation.inventory?.equipped?.leftHand
  if (EQUIP_CANDIDATES.includes(right)) return right
  if (EQUIP_CANDIDATES.includes(left)) return left
  return null
}

function pickEquipItem(observation, state) {
  if (state.equipItemId && itemCount(observation, state.equipItemId) > 0) {
    return state.equipItemId
  }
  for (const itemId of EQUIP_CANDIDATES) {
    if (itemCount(observation, itemId) > 0) {
      state.equipItemId = itemId
      return itemId
    }
  }
  return null
}

function toolsReady(state) {
  return (
    BUY_LIST.every(([itemId]) => state.bought.has(itemId)) &&
    EQUIP_CANDIDATES.some((id) => state.bought.has(id))
  )
}

/**
 * Ordered phases — return the first incomplete phase's decision.
 * phase: accept → purse_use → outfit → mine → gather → quest → combat
 */
function chooseDecision(observation, state) {
  if (observation.terminal) return null
  const room = observation.currentRoom
  const pois = observation.discoveredPOIs ?? []

  // Combat lock: only attack
  if (observation.activeCombat && hasAction(observation, "attack")) {
    return act("attack", undefined, "Continue engagement.")
  }

  // --- accept quest ---
  if (!state.questAccepted) {
    if (room !== "SH001") {
      return navigateToward(observation, "SH001")
    }
    const s = searchIfNeeded(observation)
    if (s) return s
    if (hasAction(observation, "talk")) {
      return act("talk", QUEST_GIVER_NAME, "Accept Stag Hollow quest.")
    }
    return null
  }

  // --- purse + satchel use at SH005 ---
  if (!state.usedSatchel) {
    if (room === "SH001") return go(observation, "south", "To SH005 tool shed.")
    if (room === "SH005") {
      const s = searchIfNeeded(observation)
      if (s) return s
      if (!state.gotPurse && pois.includes(PURSE_POI) && hasAction(observation, "inspect")) {
        return act("inspect", PURSE_POI, "Fund tool buys.")
      }
      if (state.gotPurse && !state.gotSatchel && pois.includes(REPAIR_POI) && hasAction(observation, "inspect")) {
        return act("inspect", REPAIR_POI, "Get satchel_cache.")
      }
      if (state.gotSatchel && hasAction(observation, "use") && itemCount(observation, "satchel_cache") > 0) {
        return act("use", "satchel_cache", "Exercise use.")
      }
    }
    return navigateToward(observation, "SH005")
  }

  // --- outfit at hub ---
  if (!state.outfitted) {
    if (room !== "SH001") return navigateToward(observation, "SH001")
    const s = searchIfNeeded(observation)
    if (s) return s

    // Buy kit + one equipable weapon (club preferred).
    for (const [itemId, qty] of BUY_LIST) {
      if (state.bought.has(itemId) || state.buyFailed.has(itemId)) continue
      if (itemCount(observation, itemId) >= qty) {
        state.bought.add(itemId)
        continue
      }
      if (hasAction(observation, "buy")) {
        return act("buy", buyTarget(itemId, qty), `Buy ${itemId}.`)
      }
    }
    if (!EQUIP_CANDIDATES.some((id) => state.bought.has(id) || itemCount(observation, id) > 0)) {
      for (const itemId of EQUIP_CANDIDATES) {
        if (state.buyFailed.has(itemId)) continue
        if (itemCount(observation, itemId) > 0) {
          state.bought.add(itemId)
          state.equipItemId = itemId
          break
        }
        if (hasAction(observation, "buy")) {
          return act("buy", buyTarget(itemId, 1), `Buy ${itemId} for equip.`)
        }
      }
    } else if (!state.equipItemId) {
      state.equipItemId = EQUIP_CANDIDATES.find((id) => state.bought.has(id) || itemCount(observation, id) > 0) ?? null
    }

    if (!state.crafted && hasAction(observation, "craft")) {
      return act("craft", "trail_kit_ration", "Craft trail kit ration.")
    }
    // Craft needs mats still in bag; if buy failed, stop looping
    if (!state.crafted && !hasAction(observation, "craft")) {
      return null
    }

    const weapon = pickEquipItem(observation, state)
    if (!state.equipped && weapon && hasAction(observation, "equip")) {
      return act("equip", weapon, `Equip ${weapon}.`)
    }
    if (state.equipped && !state.unequipped && clubEquipped(observation) && hasAction(observation, "unequip")) {
      return act("unequip", equippedWeapon(observation) ?? weapon, "Unequip weapon.")
    }
    if (state.unequipped && !state.reequipped && weapon && hasAction(observation, "equip")) {
      return act("equip", weapon, "Re-equip for combat.")
    }

    if (!state.ate && hasAction(observation, "eat") && itemCount(observation, "ration") > 0) {
      return act("eat", undefined, "Eat ration.")
    }
    if (state.ate && !state.rested && hasAction(observation, "rest")) {
      return act("rest", undefined, "Rest.")
    }

    if (
      toolsReady(state) &&
      state.crafted &&
      state.equipped &&
      state.unequipped &&
      state.reequipped &&
      state.ate &&
      state.rested
    ) {
      state.outfitted = true
      return chooseDecision(observation, state)
    }
    return null
  }

  // --- mine SH007 ---
  if (!state.mined) {
    if (room === "SH001") return go(observation, "south", "Toward SH007.")
    if (room === "SH005") return go(observation, "south", "To gravel cutting.")
    if (room === "SH007") {
      const s = searchIfNeeded(observation)
      if (s) return s
      if (hasAction(observation, "mine")) {
        return act("mine", gatherTarget(observation, "mine", "gravel seam"), "Mine gravel seam.")
      }
    }
    return navigateToward(observation, "SH007")
  }

  // --- gather ring: TI002 → CB002 salvage → CB001 chop/forage → HE001 fish ---
  if (!state.gathered) {
    if (!state.visitedTi002) {
      if (room === "SH007") return go(observation, "north", "Back SH005.")
      if (room === "SH005") return go(observation, "north", "Hub.")
      if (room === "SH001") return go(observation, "west", "To SH004.")
      if (room === "SH004") return go(observation, "west", "Enter TI002.")
      if (room === "TI002") {
        const s = searchIfNeeded(observation)
        if (s) return s
        state.visitedTi002 = true
        return go(observation, "east", "Leave TI002.")
      }
      return navigateToward(observation, "SH004")
    }

    if (!state.salvaged) {
      if (room === "TI002") return go(observation, "east", "To SH004.")
      if (room === "SH004") return go(observation, "north", "To CB002.")
      if (room === "CB002") {
        const s = searchIfNeeded(observation)
        if (s) return s
        if (hasAction(observation, "salvage")) {
          return act(
            "salvage",
            gatherTarget(observation, "salvage", "charcoal scraps"),
            "Salvage charcoal scraps."
          )
        }
      }
      return navigateToward(observation, "CB002")
    }

    if (!state.chopped || !state.foraged) {
      if (room === "CB002") return go(observation, "west", "To CB001.")
      if (room === "CB001") {
        const s = searchIfNeeded(observation)
        if (s) return s
        if (!state.chopped && hasAction(observation, "chop")) {
          return act("chop", gatherTarget(observation, "chop", "hazel coppice"), "Chop.")
        }
        if (state.chopped && !state.foraged && hasAction(observation, "forage")) {
          return act("forage", gatherTarget(observation, "forage", "coppice herbs"), "Forage.")
        }
      }
      return navigateToward(observation, "CB001")
    }

    if (!state.fished) {
      if (room === "CB001") return go(observation, "east", "To CB002.")
      if (room === "CB002") return go(observation, "north", "To HE001.")
      if (room === "HE001") {
        const s = searchIfNeeded(observation)
        if (s) return s
        if (hasAction(observation, "fish")) {
          return act("fish", gatherTarget(observation, "fish", "lodge mill pond"), "Fish.")
        }
      }
      return navigateToward(observation, "HE001")
    }

    state.gathered = true
    return chooseDecision(observation, state)
  }

  // --- quest token + turn-in ---
  if (!state.questDone) {
    if (itemCount(observation, REQUIRED_ITEM_ID) > 0) {
      if (room === "SH001") {
        const s = searchIfNeeded(observation)
        if (s) return s
        if (hasAction(observation, "talk")) {
          return act("talk", QUEST_GIVER_NAME, "Turn in boundary token.")
        }
      }
      return navigateToward(observation, "SH001")
    }

    if (room === "OB006") {
      const s = searchIfNeeded(observation)
      if (s) return s
      if (pois.includes(TOKEN_POI) && hasAction(observation, "inspect")) {
        return act("inspect", TOKEN_POI, "Retrieve boundary token.")
      }
    }
    // Prefer HE001 → OB002 → OB003 → OB006 after gather
    if (room === "HE001") return go(observation, "north", "To OB002.")
    if (room === "OB002") return go(observation, "east", "To OB003.")
    if (room === "OB003") return go(observation, "east", "To OB006.")
    return navigateToward(observation, "OB006")
  }

  // --- combat at OB005+ until death/terminal ---
  if (room === "OB005") {
    const s = searchIfNeeded(observation)
    if (s) return s
    if (hasAction(observation, "attack")) {
      return act("attack", undefined, "Engage hostile.")
    }
    // First wolf defeated: unequip and push into OB007 den for a lethal fight.
    if (state.attacked) {
      if (clubEquipped(observation) && hasAction(observation, "unequip")) {
        return act("unequip", equippedWeapon(observation), "Unequip before den fight.")
      }
      if ((observation.knownExits ?? []).includes("north")) {
        return go(observation, "north", "To OB007 second hostile.")
      }
    }
  }
  if (room === "OB007") {
    const s = searchIfNeeded(observation)
    if (s) return s
    if (hasAction(observation, "attack")) {
      return act("attack", undefined, "Fight until death/terminal.")
    }
  }
  if (room === "OB006") return go(observation, "west", "To OB005.")
  if (room === "OB002") return go(observation, "north", "To OB005.")
  if (room === "OB003") return go(observation, "west", "To OB002.")
  if (room === "SH001") return go(observation, "north", "Toward boundary.")
  if (room === "SH002") return go(observation, "north", "To OB001.")
  if (room === "OB001") return go(observation, "north", "To OB002.")
  if (state.attacked && hasAction(observation, "rest")) {
    return act("rest", undefined, "Burn turns toward max_turns terminal.")
  }
  return navigateToward(observation, "OB005")
}

/** Simple BFS-ish shortcuts using known graph edges when exits are known. */
function navigateToward(observation, dest) {
  const room = observation.currentRoom
  if (room === dest) return searchIfNeeded(observation)

  const ROUTE = {
    SH007: { SH001: "north", SH005: "north", SH007: null },
    SH005: { SH001: "north", SH007: "south", SH005: null },
    SH001: {
      SH005: "south",
      SH007: "south",
      SH004: "west",
      TI002: "west",
      CB002: "west",
      CB001: "west",
      HE001: "west",
      OB006: "north",
      OB005: "north",
      OB002: "north",
      SH002: "north",
    },
    SH004: {
      SH001: "east",
      TI002: "west",
      CB002: "north",
      CB001: "north",
      HE001: "north",
      OB006: "north",
      OB005: "north",
    },
    TI002: { SH004: "east", SH001: "east", CB002: "east", CB001: "west" },
    CB002: {
      SH004: "south",
      SH001: "south",
      CB001: "west",
      HE001: "north",
      OB006: "north",
      OB005: "north",
      TI002: "south",
    },
    CB001: { CB002: "east", HE001: "east", SH004: "east", SH001: "east" },
    HE001: {
      CB002: "south",
      OB002: "north",
      OB006: "north",
      OB005: "north",
      SH001: "south",
    },
    SH002: { SH001: "south", OB001: "north", OB002: "north", OB005: "north", OB006: "north" },
    OB001: { SH002: "south", SH001: "south", OB002: "north", OB005: "north", OB006: "north" },
    OB002: {
      OB001: "west",
      HE001: "south",
      OB003: "east",
      OB005: "north",
      OB006: "east",
      SH001: "west",
    },
    OB003: { OB002: "west", OB006: "east", OB005: "west", SH001: "west" },
    OB006: { OB003: "south", OB005: "west", OB002: "south", SH001: "south" },
    OB005: { OB002: "south", OB006: "east", OB007: "north", SH001: "south" },
    OB007: { OB005: "south", SH001: "south" },
  }

  const direction = ROUTE[room]?.[dest]
  if (direction) {
    const d = go(observation, direction, `Navigate toward ${dest}.`)
    if (d) return d
  }

  const s = searchIfNeeded(observation)
  if (s) return s
  if ((observation.knownExits ?? []).length > 0) {
    return move(observation.knownExits[0], `Explore toward ${dest}.`)
  }
  return null
}

function noteAccepted(state, decision, lastStep, observation) {
  const result = lastStep?.lastResult ?? ""
  const failedBuy = /insufficient marks|sold out|only has \d+|cannot buy|failed/i.test(result)
  // World sometimes returns intentAccepted=true even when buy fails for marks/stock.
  const effectivelyAccepted = lastStep?.intentAccepted !== false && !failedBuy

  if (failedBuy && decision.actionName === "buy" && decision.target) {
    const itemId = String(decision.target).split(":")[1]
    if (itemId) state.buyFailed.add(itemId)
    return
  }

  if (!effectivelyAccepted) return

  const name = decision.action === "move" ? "move" : decision.actionName
  if (name) state.fired.add(name)

  if (decision.actionName === "talk" && (observation.activeQuest || /boundary token|old wood/i.test(result))) {
    state.questAccepted = true
  }
  if (decision.actionName === "buy" && decision.target) {
    const itemId = String(decision.target).split(":")[1]
    if (itemId) {
      state.bought.add(itemId)
      if (EQUIP_CANDIDATES.includes(itemId)) state.equipItemId = itemId
    }
  }
  if (decision.actionName === "inspect" && decision.target === PURSE_POI) state.gotPurse = true
  if (decision.actionName === "inspect" && decision.target === REPAIR_POI) state.gotSatchel = true
  if (decision.actionName === "use" && decision.target === "satchel_cache") state.usedSatchel = true
  if (decision.actionName === "mine") state.mined = true
  if (decision.actionName === "craft") state.crafted = true
  if (decision.actionName === "equip") {
    if (!state.equipped) state.equipped = true
    else if (state.unequipped) state.reequipped = true
  }
  if (decision.actionName === "unequip") state.unequipped = true
  if (decision.actionName === "eat") state.ate = true
  if (decision.actionName === "rest") state.rested = true
  if (decision.actionName === "salvage") state.salvaged = true
  if (decision.actionName === "chop") state.chopped = true
  if (decision.actionName === "forage") state.foraged = true
  if (decision.actionName === "fish") state.fished = true
  if (decision.actionName === "attack") state.attacked = true
  if (observation.currentRoom === "TI002") state.visitedTi002 = true
  if (itemCount(observation, REWARD_ITEM_ID) > 0) state.questDone = true
  if (observation.terminal) state.combatDone = true
}

function summarizeState(state) {
  return JSON.stringify(
    {
      questAccepted: state.questAccepted,
      gotPurse: state.gotPurse,
      usedSatchel: state.usedSatchel,
      outfitted: state.outfitted,
      mined: state.mined,
      visitedTi002: state.visitedTi002,
      salvaged: state.salvaged,
      chopped: state.chopped,
      foraged: state.foraged,
      fished: state.fished,
      gathered: state.gathered,
      questDone: state.questDone,
      attacked: state.attacked,
      fired: [...state.fired],
      visited: [...state.visitedRooms],
    },
    null,
    0
  )
}

async function run() {
  const config = JSON.parse(readFileSync(defaultConfigPath, "utf-8"))
  console.log(`World API: ${WORLD_BASE_URL}`)
  console.log("Coverage circuit: single session from SH001 (no teleports)")
  await checkHealth()
  console.log("Health check: OK")
  const accessToken = await authenticate()
  console.log("Wallet auth: OK")

  const created = await createSession(config, 42, accessToken)
  let observation = created.observation
  if (observation.currentRoom !== "SH001") {
    throw new Error(`Expected spawn SH001, got ${observation.currentRoom}`)
  }

  const state = {
    fired: new Set(),
    visitedRooms: new Set(["SH001"]),
    bought: new Set(),
    buyFailed: new Set(),
    equipItemId: null,
    questAccepted: !!observation.activeQuest,
    gotPurse: false,
    gotSatchel: false,
    usedSatchel: false,
    mined: false,
    outfitted: false,
    crafted: false,
    equipped: false,
    unequipped: false,
    reequipped: false,
    ate: false,
    rested: false,
    visitedTi002: false,
    salvaged: false,
    chopped: false,
    foraged: false,
    fished: false,
    gathered: false,
    questDone: itemCount(observation, REWARD_ITEM_ID) > 0,
    attacked: false,
    combatDone: false,
  }

  let steps = 0
  let lastStep = null
  let stuckCount = 0

  while (!observation.terminal && steps < MAX_STEPS) {
    if (observation.activeQuest) state.questAccepted = true
    if (itemCount(observation, "satchel_cache") > 0) state.gotSatchel = true
    if ((observation.marks ?? 0) >= 80) state.gotPurse = true
    if (itemCount(observation, "iron_ore") > 0) state.mined = true
    if (itemCount(observation, REWARD_ITEM_ID) > 0) state.questDone = true
    if (state.salvaged && state.chopped && state.foraged && state.fished) state.gathered = true

    const decision = chooseDecision(observation, state)
    if (!decision) {
      stuckCount += 1
      if (stuckCount > 3) {
        throw new Error(
          `Stuck at ${observation.currentRoom} after ${steps} steps. state=${summarizeState(state)}`
        )
      }
      // Try search as last resort
      if (hasAction(observation, "search")) {
        lastStep = await stepSession(
          created.sessionId,
          act("search", undefined, "Unstick search."),
          accessToken
        )
        observation = lastStep.observation
        steps += 1
        state.fired.add("search")
        continue
      }
      throw new Error(
        `Stuck at ${observation.currentRoom} after ${steps} steps. state=${summarizeState(state)}`
      )
    }
    stuckCount = 0

    lastStep = await stepSession(created.sessionId, decision, accessToken)
    observation = lastStep.observation
    state.visitedRooms.add(observation.currentRoom)
    steps += 1
    noteAccepted(state, decision, lastStep, observation)

    const actionLabel =
      decision.action === "move"
        ? `move ${decision.direction}`
        : `${decision.actionName}${decision.target ? `:${decision.target}` : ""}`
    console.log(
      `  Step ${steps}: ${actionLabel} @${observation.currentRoom} | intent=${lastStep.intentAccepted ? "ok" : "reject"} | ${lastStep.lastResult}`
    )
  }

  // Keep attacking if still in combat / can attack
  while (!observation.terminal && steps < MAX_STEPS && hasAction(observation, "attack")) {
    lastStep = await stepSession(
      created.sessionId,
      act("attack", undefined, "Fight until terminal."),
      accessToken
    )
    observation = lastStep.observation
    steps += 1
    state.fired.add("attack")
    state.attacked = true
    console.log(`  Step ${steps}: attack | ${lastStep.lastResult}`)
  }

  if (!state.attacked) {
    throw new Error("Coverage circuit never engaged attack.")
  }

  if (observation.terminal) {
    state.combatDone = true
    console.log(`  Terminal reached (${observation.endReason ?? "unknown"}).`)
  } else {
    console.warn(
      `  WARN: session not terminal after ${steps} steps (raise world MAX_TURNS). Chronicle may fail.`
    )
  }

  const missing = REQUIRED_ACTIONS.filter((name) => !state.fired.has(name))
  if (missing.length > 0) {
    throw new Error(
      `Missing required free actions: ${missing.join(", ")}. Fired: ${[...state.fired].sort().join(", ")}`
    )
  }

  if (!state.questDone) {
    throw new Error("Quest turn-in did not complete (missing woodward_badge).")
  }
  if (!state.visitedTi002) {
    throw new Error("TI002 was never visited — connectivity check failed.")
  }

  const journal = await getJournal(created.agentInstanceId)
  const entry = journal.journal.questbook.find((q) => q.sessionId === created.sessionId)
  if (!entry) {
    throw new Error(
      "Questbook entry missing (need a terminal session). Increase MAX_TURNS and re-run."
    )
  }
  await setChronicle(
    created.agentInstanceId,
    created.sessionId,
    "Day verify: coverage-circuit harness confirmed contiguous free-action path.",
    accessToken
  )
  const after = await getJournal(created.agentInstanceId)
  const updated = after.journal.questbook.find((q) => q.sessionId === created.sessionId)
  if (!updated?.chronicleEntry?.includes("coverage-circuit")) {
    throw new Error("Chronicle entry was not saved.")
  }

  console.log("\nCoverage circuit PASS")
  console.log(`  Steps: ${steps}`)
  console.log(`  Actions: ${[...state.fired].sort().join(", ")}`)
  console.log(`  Rooms: ${[...state.visitedRooms].sort().join(", ")}`)
}

run().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
