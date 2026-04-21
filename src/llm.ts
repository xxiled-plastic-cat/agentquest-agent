import OpenAI from "openai"
import type {
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

function randomValidDecision(observation: TurnObservation): AgentDecision {
  const random = Math.random
  const safeActions = observation.availableActions.filter(
    (actionName) => !(actionName === "eat" && observation.inventory.food <= 0)
  )
  const moveCount = observation.knownExits.length
  const actionCount = safeActions.length
  const total = moveCount + actionCount
  if (total === 0) {
    return { action: "move", direction: "north", reason: "Fallback: no options returned by model." }
  }
  const i = Math.floor(random() * total)
  if (i < moveCount) {
    return {
      action: "move",
      direction: observation.knownExits[i],
      reason: "Fallback: random known exit.",
    }
  }
  const actionName = safeActions[i - moveCount]
  const target =
    actionName === "inspect" && observation.discoveredPOIs.length > 0
      ? observation.discoveredPOIs[Math.floor(random() * observation.discoveredPOIs.length)]
      : actionName === "talk" && observation.talkTargets.length > 0
        ? observation.talkTargets[Math.floor(random() * observation.talkTargets.length)]
      : undefined
  return {
    action: "action",
    actionName,
    target,
    reason: "Fallback: random available action.",
  }
}

function isValidDecision(decision: AgentDecision, observation: TurnObservation): boolean {
  if (decision.action === "move") {
    return !!decision.direction && observation.knownExits.includes(decision.direction)
  }
  if (decision.action === "action") {
    if (!decision.actionName || !observation.availableActions.includes(decision.actionName)) {
      return false
    }
    if (decision.actionName === "eat" && observation.inventory.food <= 0) {
      return false
    }
    return true
  }
  return false
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
  const requiredCount = observation.inventory.items?.[activeQuest.requiredItemId] ?? 0
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
  const availableRoomActions =
    observation.availableActions.length > 0 ? observation.availableActions.join(", ") : "none"
  const talkTargets = observation.talkTargets.length > 0 ? observation.talkTargets.join(", ") : "none"
  const inventoryItems = Object.entries(observation.inventory.items ?? {})
    .filter(([, qty]) => qty > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, qty]) => `${itemId} x${qty}`)
    .join(", ")
  const activeQuestText = observation.activeQuest
    ? `${observation.activeQuest.npcName} (${observation.activeQuest.npcRoomId}) | ${observation.activeQuest.questType} | retrieve ${observation.activeQuest.requiredItemId} | status: ${observation.activeQuest.status}`
    : "none"
  const activeCombatText = observation.activeCombat
    ? `${observation.activeCombat.npcName} [${observation.activeCombat.npcId}] | HP ${observation.activeCombat.npcHealth}/${observation.activeCombat.npcMaxHealth} | AC ${observation.activeCombat.npcArmorClass} | lockedByAnother=${observation.activeCombat.lockedByAnotherAgent ? "yes" : "no"}`
    : "none"
  const currentRoomSearchExhausted = observation.roomsSearchExhausted
    .split(",")
    .map((roomId) => roomId.trim())
    .filter(Boolean)
    .includes(observation.currentRoom)
  const memoryLastSession = observation.lastSessionLogbook || "No previous session logbook."
  const memoryQuestbook = observation.questbook || "No questbook entries yet."

  const prompt = `You are an explorer in the world of Idacron. Survival is key. Fame, glory and riches will only go to those who survive.

${formatAgentProfile(config, classStrategies)}

Turn: ${observation.turn}
World tick: ${observation.worldTick}
Status: ${observation.status}
Room: ${observation.currentRoom}
Room description: ${observation.roomDescription}

Health: ${observation.health}/${observation.maxHealth}
Hunger: ${observation.hunger}/10
Food: ${observation.inventory.food}
Treasure: ${observation.inventory.treasure}
Items: ${inventoryItems || "none"}

Visited rooms: ${observation.visitedRooms.join(", ") || "none"}
Known exits: ${availableMoves}
Unexplored exits from here: ${unexploredExits}
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

Available moves (movement choices): ${availableMoves}
Available room actions: ${availableRoomActions}

Rules:
- Prioritize survival when hunger is low and food is available. 
- Prefer discovering new information (searching unexplored rooms and taking unexplored exits).
- If search is available and current room search is not exhausted, strongly prefer search before backtracking moves.
- Prefer inspect/search/talk actions that can reveal new information before taking already-known return paths.
- Treat movement and room actions as equally valid choices.
- Prefer unexplored exits over previously taken return paths when choosing movement.
- If discovered things exist, inspect them before leaving when safe.
- If talk targets are present and no active quest, talk to an NPC.
- Quest givers will not give more information after the first time you talk to them.
- If active quest is retrieval, prioritize finding the item and then immediately returning it to the quest giver room.
- If active combat is present, prioritize attack until combat ends.
- If combat target is locked by another agent, avoid attack spam and choose another valid non-combat action.
- Avoid loops and repeated no-progress actions.
- Return JSON only.
- For move decisions, direction must be one of Available moves.

Response formats:
{ "action": "move", "direction": "north", "reason": "..." }
{ "action": "action", "actionName": "search", "reason": "..." }
{ "action": "action", "actionName": "inspect", "target": "<exact discovered thing name>", "reason": "..." }
{ "action": "action", "actionName": "talk", "target": "<exact NPC name>", "reason": "..." }
{ "action": "action", "actionName": "attack", "reason": "..." }
{ "action": "action", "actionName": "eat", "reason": "..." }`

  let decision: AgentDecision | null = null
  let responseId: string | undefined
  if (openai) {
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
      try {
        const response = await openai.responses.create({
          model: MODEL,
          instructions: "Return JSON only using one of the allowed response formats.",
          input: prompt,
          previous_response_id: context?.previousResponseId,
          max_output_tokens: 220,
          store: true,
        })
        responseId = response.id
        const content = response.output_text
        if (content) decision = parseDecision(content)
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
  } else {
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
    `Day ${day}. ${entry.endReason === "death" ? "The adventurer fell before nightfall." : "The adventurer endured another hard day."}`,
    `Turns: ${entry.turns}. Exploration points: ${entry.explorationPoints}. Exits discovered: ${entry.exitsDiscovered}.`,
  ].join(" ")

  if (!openai) {
    return fallback
  }

  const prompt = `Write a short fantasy quest chronicle entry (1-2 paragraphs) for Day ${day}.
Use plain text only (no markdown), keep it vivid but grounded, and stay strictly consistent with the facts.

Adventurer: ${config.name}
Class: ${config.class}
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
      max_completion_tokens: 260,
    })
    const content = completion.choices[0]?.message?.content?.trim()
    return content || fallback
  } catch (err) {
    console.error("Quest chronicle generation failed:", err)
    return fallback
  }
}
