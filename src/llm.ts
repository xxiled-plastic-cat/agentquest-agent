import OpenAI from "openai"
import type {
  ActionToolDefinition,
  ActionToolName,
  AgentConfig,
  AgentDecision,
  DecisionContext,
  DecisionResult,
  QuestbookEntry,
  TurnObservation,
} from "./types.js"

const apiKey = process.env.OPENAI_API_KEY?.trim()
const openai = apiKey ? new OpenAI({ apiKey }) : null
const MODEL = process.env.MODEL ?? "gpt-4.1-mini"
const RATE_LIMIT_MAX_RETRIES = parseInt(process.env.RATE_LIMIT_MAX_RETRIES ?? "2", 10)
const RATE_LIMIT_DEFAULT_WAIT_MS = 4000
const FOOD_ITEM_ID = "ration"
const TREASURE_ITEM_ID = "coin_pouch"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getRateLimitRetryDelayMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null

  const maybeErr = err as {
    status?: number
    message?: string
    headers?: Record<string, string | string[] | undefined>
    error?: { message?: string }
  }
  if (maybeErr.status !== 429) return null

  const retryAfterHeader =
    maybeErr.headers?.["retry-after"] ??
    maybeErr.headers?.["Retry-After"] ??
    maybeErr.headers?.["x-ratelimit-reset-requests"]
  if (typeof retryAfterHeader === "string" && retryAfterHeader.trim()) {
    const seconds = parseFloat(retryAfterHeader.trim())
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000)
    }
  }

  const candidates = [maybeErr.error?.message, maybeErr.message]
  for (const text of candidates) {
    if (!text) continue
    const match = text.match(/Please try again in\s+([\d.]+)s/i)
    if (match) {
      const seconds = parseFloat(match[1])
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000)
      }
    }
  }

  return RATE_LIMIT_DEFAULT_WAIT_MS
}

function parseDecision(raw: string): AgentDecision | null {
  const trimmed = raw.trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      action?: string
      direction?: string
      actionName?: string
      target?: string
      reason?: string
    }
    if (parsed.action === "move" && typeof parsed.direction === "string") {
      return {
        action: "move",
        direction: parsed.direction.trim(),
        reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
      }
    }
    if (parsed.action === "action" && typeof parsed.actionName === "string") {
      return {
        action: "action",
        actionName: parsed.actionName.trim(),
        target: typeof parsed.target === "string" ? parsed.target.trim() : undefined,
        reason: typeof parsed.reason === "string" ? parsed.reason.trim() : undefined,
      }
    }
  } catch {
    return null
  }
  return null
}

interface ToolCallResult {
  name: string
  arguments: Record<string, unknown>
}

function getToolByName(observation: TurnObservation, name: string): ActionToolDefinition | undefined {
  return (observation.actionTools ?? []).find((tool) => tool.name === name)
}

function getToolEnumValues(tool: ActionToolDefinition, parameterName: string): string[] {
  const parameter = tool.parameters.properties?.[parameterName]
  if (!parameter?.enum) return []
  return parameter.enum.filter((value): value is string => typeof value === "string")
}

function getToolTargetIds(tool: ActionToolDefinition): string[] {
  return (tool.validTargets ?? []).map((target) => target.id).filter((value) => value.trim().length > 0)
}

function getToolTargetIdsOrEnum(tool: ActionToolDefinition, parameterName: string): string[] {
  const targetIds = getToolTargetIds(tool)
  if (targetIds.length > 0) return targetIds
  return getToolEnumValues(tool, parameterName)
}

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0
}

function randomValidDecision(observation: TurnObservation): AgentDecision {
  const random = Math.random
  const tools = observation.actionTools ?? []
  if (tools.length > 0) {
    const chosenTool = tools[Math.floor(random() * tools.length)]
    const reason = "Fallback: random available tool action."
    if (chosenTool.name === "move") {
      const directions = getToolTargetIdsOrEnum(chosenTool, "direction")
      const direction = directions[Math.floor(random() * directions.length)] ?? observation.knownExits[0] ?? "north"
      return { action: "move", direction, reason }
    }
    if (chosenTool.name === "search" || chosenTool.name === "attack" || chosenTool.name === "eat" || chosenTool.name === "rest") {
      return { action: "action", actionName: chosenTool.name, reason }
    }
    if (
      chosenTool.name === "inspect" ||
      chosenTool.name === "talk" ||
      chosenTool.name === "mine" ||
      chosenTool.name === "chop" ||
      chosenTool.name === "forage" ||
      chosenTool.name === "fish" ||
      chosenTool.name === "salvage"
    ) {
      const targets = getToolTargetIdsOrEnum(chosenTool, "target")
      const target = targets[Math.floor(random() * targets.length)]
      return { action: "action", actionName: chosenTool.name, target, reason }
    }
    if (chosenTool.name === "craft") {
      const recipeIds = getToolTargetIdsOrEnum(chosenTool, "recipeId")
      return { action: "action", actionName: "craft", target: recipeIds[Math.floor(random() * recipeIds.length)], reason }
    }
    if (chosenTool.name === "equip") {
      const itemIds = getToolTargetIdsOrEnum(chosenTool, "itemId")
      return { action: "action", actionName: "equip", target: itemIds[Math.floor(random() * itemIds.length)], reason }
    }
    if (chosenTool.name === "unequip" || chosenTool.name === "use") {
      const itemIds = getToolTargetIdsOrEnum(chosenTool, "itemId")
      return { action: "action", actionName: chosenTool.name, target: itemIds[Math.floor(random() * itemIds.length)], reason }
    }
    if (chosenTool.name === "buy" || chosenTool.name === "sell") {
      const ids = getToolTargetIds(chosenTool)
      const target = ids[Math.floor(random() * ids.length)]
      return { action: "action", actionName: chosenTool.name, target, reason }
    }
  }
  if (observation.knownExits.length > 0) {
    return {
      action: "move",
      direction: observation.knownExits[Math.floor(random() * observation.knownExits.length)],
      reason: "Fallback: random known exit.",
    }
  }
  return { action: "move", direction: "north", reason: "Fallback: no options returned by model." }
}

function isValidDecision(decision: AgentDecision, observation: TurnObservation): boolean {
  if (decision.action === "move") {
    const moveTool = getToolByName(observation, "move")
    if (!moveTool || !decision.direction) return false
    return getToolTargetIdsOrEnum(moveTool, "direction").includes(decision.direction)
  }
  if (decision.action === "action") {
    if (!decision.actionName) {
      return false
    }
    const tool = getToolByName(observation, decision.actionName)
    if (!tool) {
      return false
    }
    if (decision.actionName === "search" || decision.actionName === "attack" || decision.actionName === "eat" || decision.actionName === "rest") {
      return true
    }
    const target = decision.target?.trim()
    if (!target) {
      return false
    }
    if (
      decision.actionName === "inspect" ||
      decision.actionName === "talk" ||
      decision.actionName === "mine" ||
      decision.actionName === "chop" ||
      decision.actionName === "forage" ||
      decision.actionName === "fish" ||
      decision.actionName === "salvage"
    ) {
      return getToolTargetIdsOrEnum(tool, "target").includes(target)
    }
    if (decision.actionName === "craft") {
      return getToolTargetIdsOrEnum(tool, "recipeId").includes(target)
    }
    if (decision.actionName === "equip") {
      const [itemId] = target.split(":")
      return getToolTargetIdsOrEnum(tool, "itemId").includes(itemId)
    }
    if (decision.actionName === "unequip" || decision.actionName === "use") {
      return getToolTargetIdsOrEnum(tool, "itemId").includes(target)
    }
    if (decision.actionName === "buy" || decision.actionName === "sell") {
      const [merchantId, itemId, quantity] = target.split(":")
      if (!merchantId || !itemId) return false
      if (quantity && !isPositiveInteger(quantity)) return false
      const validPairs = getToolTargetIds(tool)
      return validPairs.some((pair) => {
        const [validMerchantId, validItemId] = pair.split(":")
        return merchantId === validMerchantId && itemId === validItemId
      })
    }
    return false
  }
  return false
}

function getToolCall(response: unknown): ToolCallResult | null {
  const output = (response as { output?: unknown[] }).output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    const candidate = item as {
      type?: string
      name?: string
      arguments?: string | Record<string, unknown>
    }
    if (candidate.type !== "function_call" || typeof candidate.name !== "string") continue
    if (typeof candidate.arguments === "string") {
      try {
        return {
          name: candidate.name,
          arguments: JSON.parse(candidate.arguments) as Record<string, unknown>,
        }
      } catch {
        return { name: candidate.name, arguments: {} }
      }
    }
    if (candidate.arguments && typeof candidate.arguments === "object") {
      return { name: candidate.name, arguments: candidate.arguments as Record<string, unknown> }
    }
    return { name: candidate.name, arguments: {} }
  }
  return null
}

function getStringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getQuantityArg(args: Record<string, unknown>): number {
  const raw = args.quantity
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 1
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.floor(value))
}

function decisionFromToolCall(toolCall: ToolCallResult, observation: TurnObservation): AgentDecision | null {
  const matchedTool = getToolByName(observation, toolCall.name)
  if (!matchedTool) return null
  const args = toolCall.arguments
  const reason = getStringArg(args, "reason")
  const name = matchedTool.name
  if (name === "move") {
    const direction = getStringArg(args, "direction")
    return direction ? { action: "move", direction, reason } : null
  }
  if (name === "search" || name === "attack" || name === "eat" || name === "rest") {
    return { action: "action", actionName: name, reason }
  }
  if (name === "inspect" || name === "talk" || name === "mine" || name === "chop" || name === "forage" || name === "fish" || name === "salvage") {
    const target = getStringArg(args, "target")
    return target ? { action: "action", actionName: name, target, reason } : null
  }
  if (name === "craft") {
    const target = getStringArg(args, "recipeId")
    return target ? { action: "action", actionName: "craft", target, reason } : null
  }
  if (name === "equip") {
    const itemId = getStringArg(args, "itemId")
    const slot = getStringArg(args, "slot")
    return itemId ? { action: "action", actionName: "equip", target: slot ? `${itemId}:${slot}` : itemId, reason } : null
  }
  if (name === "unequip" || name === "use") {
    const itemId = getStringArg(args, "itemId")
    return itemId ? { action: "action", actionName: name, target: itemId, reason } : null
  }
  if (name === "buy" || name === "sell") {
    const merchantId = getStringArg(args, "merchantId")
    const itemId = getStringArg(args, "itemId")
    if (!merchantId || !itemId) return null
    return {
      action: "action",
      actionName: name,
      target: `${merchantId}:${itemId}:${getQuantityArg(args)}`,
      reason,
    }
  }
  return null
}

interface ParsedMapExit {
  direction: string
  destination: string
}

function parseWorldMap(text: string): Record<string, ParsedMapExit[]> {
  const graph: Record<string, ParsedMapExit[]> = {}
  let currentRoom = ""
  for (const line of text.split("\n")) {
    const roomHeaderMatch = line.match(/^([A-Z]{2}\d{3}):$/)
    if (roomHeaderMatch) {
      currentRoom = roomHeaderMatch[1]
      if (!graph[currentRoom]) graph[currentRoom] = []
      continue
    }
    if (!currentRoom) continue
    const exitMatch = line.match(/^\s+([a-z]+)\s+→\s+([A-Z]{2}\d{3}|unknown)$/i)
    if (!exitMatch) continue
    const direction = exitMatch[1].toLowerCase()
    const destination = exitMatch[2]
    if (destination.toLowerCase() === "unknown") continue
    graph[currentRoom].push({ direction, destination })
  }
  return graph
}

function getNextDirectionToTarget(
  currentRoom: string,
  targetRoom: string,
  graph: Record<string, ParsedMapExit[]>
): string | null {
  if (currentRoom === targetRoom) return null
  const visited = new Set<string>([currentRoom])
  const queue: Array<{ room: string; firstDirection: string }> = []
  for (const edge of graph[currentRoom] ?? []) {
    queue.push({ room: edge.destination, firstDirection: edge.direction })
  }

  while (queue.length > 0) {
    const node = queue.shift()!
    if (visited.has(node.room)) continue
    visited.add(node.room)
    if (node.room === targetRoom) return node.firstDirection
    for (const edge of graph[node.room] ?? []) {
      if (!visited.has(edge.destination)) {
        queue.push({ room: edge.destination, firstDirection: node.firstDirection })
      }
    }
  }
  return null
}

function getQuestTurnInDecision(observation: TurnObservation): AgentDecision | null {
  const activeQuest = observation.activeQuest
  if (!activeQuest || activeQuest.questType !== "retrieval") return null
  const requiredCount = observation.inventory.bag.items?.[activeQuest.requiredItemId] ?? 0
  if (requiredCount <= 0) return null

  if (observation.availableActions.includes("talk") && observation.talkTargets.includes(activeQuest.npcName)) {
    return {
      action: "action",
      actionName: "talk",
      target: activeQuest.npcName,
      reason: "Quest item acquired; turning in to quest giver now.",
    }
  }

  const graph = parseWorldMap(observation.worldMapText)
  const nextDirection = getNextDirectionToTarget(
    observation.currentRoom,
    activeQuest.npcRoomId,
    graph
  )
  if (nextDirection && observation.knownExits.includes(nextDirection)) {
    return {
      action: "move",
      direction: nextDirection,
      reason: `Quest item acquired; returning to ${activeQuest.npcName}.`,
    }
  }
  return null
}

function formatAgentProfile(config: AgentConfig, classStrategies: Record<string, string[]>): string {
  const className = config.class.charAt(0).toUpperCase() + config.class.slice(1).replace(/_/g, " ")
  const strategyHints = classStrategies[config.class] ?? []

  const lines = [
    `Name: ${config.name}`,
    `Class: ${className}`,
    "",
    "Abilities",
    `- Intelligence: ${config.abilities.intelligence}`,
    `- Strength: ${config.abilities.strength}`,
    `- Endurance: ${config.abilities.endurance}`,
    `- Agility: ${config.abilities.agility}`,
    "",
    "Personality",
    `- Confidence: ${config.personality.confidence}`,
    `- Caution: ${config.personality.caution}`,
  ]

  if (strategyHints.length > 0) {
    lines.push("", "Class Strategy")
    strategyHints.forEach((hint) => lines.push(`- ${hint}`))
  }
  if (config.instructions?.trim()) {
    lines.push("", "Player Instructions", config.instructions.trim())
  }
  return lines.join("\n")
}

function formatToolSummary(tools: ActionToolDefinition[]): string {
  if (tools.length === 0) return "none"
  return tools
    .map((tool) => {
      const targets = tool.validTargets?.length
        ? ` targets: ${tool.validTargets
          .slice(0, 8)
          .map((target) => target.id)
          .join(", ")}`
        : ""
      const payment = tool.requiresPayment ? " paid" : " free"
      const turnCost = tool.consumesTurn ? "consumes turn" : "no turn cost"
      return `- ${tool.name} (${payment.trim()}, ${turnCost}): ${tool.description}${targets}`
    })
    .join("\n")
}

function formatAvailableActionSubtext(observation: TurnObservation): string {
  if (observation.availableActions.length === 0) return "none"
  return observation.availableActions
    .map((actionName) => {
      const tool = getToolByName(observation, actionName)
      return `- ${actionName}: ${tool?.description ?? "Available this turn."}`
    })
    .join("\n")
}

function toOpenAiTools(tools: ActionToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

export async function decideAction(
  observation: TurnObservation,
  config: AgentConfig,
  classStrategies: Record<string, string[]>,
  context?: DecisionContext
): Promise<DecisionResult> {
  const questTurnInDecision = getQuestTurnInDecision(observation)
  if (questTurnInDecision) {
    return { decision: questTurnInDecision }
  }

  const discoveredThings =
    observation.discoveredPOIs.length > 0 ? observation.discoveredPOIs.join(", ") : "none"
  const availableMoves = observation.knownExits.length > 0 ? observation.knownExits.join(", ") : "none"
  const unexploredExits =
    observation.unexploredExits.length > 0 ? observation.unexploredExits.join(", ") : "none"
  const talkTargets = observation.talkTargets.length > 0 ? observation.talkTargets.join(", ") : "none"
  const inventoryItems = Object.entries(observation.inventory.bag.items ?? {})
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, qty]) => `${itemId} x${qty}`)
    .join(", ")
  const equippedItems = Object.entries(observation.inventory.equipped)
    .map(([slot, itemId]) => `${slot}:${itemId ?? "empty"}`)
    .join(", ")
  const hasHandItemEquipped = !!observation.inventory.equipped.leftHand || !!observation.inventory.equipped.rightHand
  const activeQuestText = observation.activeQuest
    ? `${observation.activeQuest.npcName} (${observation.activeQuest.npcRoomId}) | ${observation.activeQuest.questType} | retrieve ${observation.activeQuest.requiredItemId} | status: ${observation.activeQuest.status}`
    : "none"
  const activeCombatText = observation.activeCombat
    ? `${observation.activeCombat.npcName} [${observation.activeCombat.npcId}] | HP ${observation.activeCombat.npcHealth}/${observation.activeCombat.npcMaxHealth} | EnemyAC ${observation.activeCombat.npcArmorClass} | YourAC ${observation.activeCombat.agentArmorClass} | lockedByAnother=${observation.activeCombat.lockedByAnotherAgent ? "yes" : "no"}`
    : "none"
  const currentRoomSearchExhausted = observation.roomsSearchExhausted
    .split(",")
    .map((roomId) => roomId.trim())
    .filter(Boolean)
    .includes(observation.currentRoom)
  const memoryLastSession = observation.lastSessionLogbook || "No previous session logbook."
  const memoryQuestbook = observation.questbook || "No questbook entries yet."
  const actionTools = observation.actionTools ?? []

  const foodCount = observation.inventory.bag.items[FOOD_ITEM_ID] ?? 0
  const treasureCount = observation.inventory.bag.items[TREASURE_ITEM_ID] ?? 0
  const merchantOffersText =
    observation.merchantOffers.length > 0
      ? observation.merchantOffers
        .map((merchant) => {
          const listing = merchant.inventory
            .map(
              (entry) =>
                `${entry.itemId} stock ${entry.stock}/${entry.maxStock} buy ${entry.buyPriceMarks} sell ${entry.sellPriceMarks}`
            )
            .join(", ")
          return `${merchant.merchantName} [${merchant.merchantId}] marks=${merchant.balanceMarks} :: ${listing}`
        })
        .join("\n")
      : "none"
  const affordableMerchantItems = observation.merchantOffers.flatMap((merchant) =>
    merchant.inventory
      .filter((entry) => entry.stock > 0 && entry.buyPriceMarks <= observation.marks)
      .map((entry) => `${entry.itemId} from ${merchant.merchantName} [${merchant.merchantId}] for ${entry.buyPriceMarks} marks`)
  )
  const conditionText = observation.conditions.length > 0 ? observation.conditions.join(", ") : "none"

  const prompt = `You are an explorer in the world of Idacron. Survival is key. Fame, glory and riches will only go to those who survive.

${formatAgentProfile(config, classStrategies)}

Turn: ${observation.turn}
World tick: ${observation.worldTick}
Status: ${observation.status}
Room: ${observation.currentRoom}
Room description: ${observation.roomDescription}

Health: ${observation.vitality.health}/${observation.vitality.maxHealth}
Stamina: ${observation.vitality.stamina}/${observation.vitality.maxStamina}
Conditions: ${conditionText}
Food: ${foodCount}
Treasure: ${treasureCount}
Marks: ${observation.marks}
Bag slots: ${observation.inventory.bag.usedSlots}/${observation.inventory.bag.maxSlots}
Items: ${inventoryItems || "none"}
Equipped: ${equippedItems}
Hand weapon or tool equipped: ${hasHandItemEquipped ? "yes" : "no"}
Merchant offers:
${merchantOffersText}
Affordable shop items:
${affordableMerchantItems.length > 0 ? affordableMerchantItems.join("\n") : "none"}

Visited rooms: ${observation.visitedRooms.join(", ") || "none"}
Known exits: ${availableMoves}
Unexplored exits from here: ${unexploredExits}
Available actions (with subtext):
${formatAvailableActionSubtext(observation)}
Discovered things to inspect: ${discoveredThings}
Talk targets here: ${talkTargets}
Active quest: ${activeQuestText}
Active combat: ${activeCombatText}
Rooms where search found nothing: ${observation.roomsSearchExhausted}
Current room search exhausted: ${currentRoomSearchExhausted ? "yes" : "no"}
Rooms with unexplored exits:\n${observation.roomsWithUnexploredExits}

World map:\n${observation.worldMapText}

Last session logbook (previous session memory):
${memoryLastSession}

Questbook (longer-term memory):
${memoryQuestbook}

Available action tools:
${formatToolSummary(actionTools)}

Rules:

Survival priorities:
- Stay alive. If health is low, avoid unnecessary combat when possible.
- Stamina matters. If stamina is low or fatigued, eat if you have food, or rest if safe.
- If active combat is present, usually attack until combat ends unless the target is locked by another agent.
- Weapons and armor are very useful for survival and progress.

Exploration priorities:
- Prefer actions that reveal new information: search, inspect, talk, and unexplored exits.
- Search rooms that are not exhausted before repeatedly backtracking.
- Inspect discovered points of interest before leaving if it seems safe.
- Prefer unexplored exits over known return paths when survival is stable.

Preparation priorities:
- If you are in a shop, have marks, and do not have anything equipped in hand, consider buying a useful affordable weapon or tool before leaving.
- After buying useful gear such as a weapon or armor, equip it before dangerous exploration.
- Prioritize essentials you lack: food, a weapon, armor, or tools that unlock nearby resources.
- Do not spend all marks unless the purchase clearly improves survival or progress.
- If merchant offers are already visible, do not talk to the merchant just to relist inventory; buy/sell if preparing, otherwise choose another progress action.

Quest priorities:
- If you have an active retrieval quest, look for the required item.
- Once you have the required quest item, return to the quest giver and talk to them.
- Quest givers usually do not repeat useful information after the first conversation.

Decision rule:
- Choose exactly one available action tool.
- Avoid repeated no-progress actions and loops.`

  let decision: AgentDecision | null = null
  let responseId: string | undefined
  if (openai && actionTools.length > 0) {
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
      try {
        const response = await openai.responses.create({
          model: MODEL,
          instructions: "Choose exactly one available AgentQuest action by calling one tool.",
          input: prompt,
          tools: toOpenAiTools(actionTools) as never,
          tool_choice: "required",
          max_output_tokens: 220,
          store: true,
        })
        const toolCall = getToolCall(response)
        if (toolCall) {
          decision = decisionFromToolCall(toolCall, observation)
          responseId = response.id
        }
        break
      } catch (err) {
        const retryDelayMs = getRateLimitRetryDelayMs(err)
        const canRetry = retryDelayMs != null && attempt < RATE_LIMIT_MAX_RETRIES
        if (canRetry) {
          const waitSeconds = (retryDelayMs / 1000).toFixed(3)
          console.warn(
            `LLM rate limited; retrying in ${waitSeconds}s (${attempt + 1}/${RATE_LIMIT_MAX_RETRIES}).`
          )
          await sleep(retryDelayMs)
          continue
        }
        console.error("LLM request failed:", err)
        break
      }
    }
  } else if (!openai) {
    console.warn("OPENAI_API_KEY not set; using fallback random decisions.")
  }

  if (decision && isValidDecision(decision, observation)) {
    return { decision, responseId }
  }
  return { decision: randomValidDecision(observation), responseId }
}

function bulletList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- None"
}

export async function generateQuestChronicle(
  day: number,
  entry: QuestbookEntry,
  config: AgentConfig,
  lastSessionLogbookText: string
): Promise<string> {
  const fallback = [
    `Day ${day}. ${entry.endReason === "death" ? "I fell before nightfall." : "I endured another hard day."}`,
    `Turns: ${entry.turns}. Exploration points: ${entry.explorationPoints}. Exits discovered: ${entry.exitsDiscovered}.`,
  ].join(" ")

  if (!openai) {
    return fallback
  }

  const playerInstructions =
    typeof config.instructions === "string" && config.instructions.trim()
      ? config.instructions.trim()
      : "None provided."

  const prompt = `Write a short fantasy quest chronicle entry (1-2 paragraphs) for Day ${day}.
Use plain text only (no markdown), keep it vivid but grounded, and stay strictly consistent with the facts.
Write in first-person singular from the adventurer's perspective ("I", "me", "my"), never third-person.
Reflect the player instructions/personality notes when phrasing tone and priorities, but do not invent facts.

Adventurer: ${config.name}
Class: ${config.class}
Player instructions:
${playerInstructions}

End reason: ${entry.endReason}
Turns: ${entry.turns}
Exploration points: ${entry.explorationPoints}
Exits discovered: ${entry.exitsDiscovered}

Rooms visited:
${bulletList(entry.roomsVisited)}

Items found:
${bulletList(entry.itemsFound)}

Important findings:
${bulletList(entry.importantFindings)}

Session turn log:
${lastSessionLogbookText || "No turn log available."}
`

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 1024,
    })
    const content = completion.choices[0]?.message?.content?.trim()
    return content || fallback
  } catch (err) {
    console.error("Quest chronicle generation failed:", err)
    return fallback
  }
}
