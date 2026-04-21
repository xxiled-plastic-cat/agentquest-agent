import OpenAI from "openai"
import type { AgentConfig, AgentDecision, TurnObservation } from "./types.js"

const apiKey = process.env.OPENAI_API_KEY?.trim()
const openai = apiKey ? new OpenAI({ apiKey }) : null
const MODEL = process.env.MODEL ?? "gpt-4.1-mini"

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
  const moveCount = observation.knownExits.length
  const actionCount = observation.availableActions.length
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
  const actionName = observation.availableActions[i - moveCount]
  const target =
    actionName === "inspect" && observation.discoveredPOIs.length > 0
      ? observation.discoveredPOIs[Math.floor(random() * observation.discoveredPOIs.length)]
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
    return !!decision.actionName && observation.availableActions.includes(decision.actionName)
  }
  return false
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
    `- Perception: ${config.abilities.perception}`,
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
  classStrategies: Record<string, string[]>
): Promise<AgentDecision> {
  const discoveredThings =
    observation.discoveredPOIs.length > 0 ? observation.discoveredPOIs.join(", ") : "none"
  const knownExits = observation.knownExits.length > 0 ? observation.knownExits.join(", ") : "none"
  const unexploredExits =
    observation.unexploredExits.length > 0 ? observation.unexploredExits.join(", ") : "none"
  const availableActions =
    observation.availableActions.length > 0 ? observation.availableActions.join(", ") : "none"

  const prompt = `You are an autonomous AgentQuest explorer.

${formatAgentProfile(config, classStrategies)}

Turn: ${observation.turn}
Status: ${observation.status}
Room: ${observation.currentRoom}
Room description: ${observation.roomDescription}

Health: ${observation.health}/10
Hunger: ${observation.hunger}/10
Food: ${observation.inventory.food}
Treasure: ${observation.inventory.treasure}

Visited rooms: ${observation.visitedRooms.join(", ") || "none"}
Known exits: ${knownExits}
Unexplored exits from here: ${unexploredExits}
Discovered things to inspect: ${discoveredThings}
Rooms where search found nothing: ${observation.roomsSearchExhausted}
Rooms with unexplored exits:\n${observation.roomsWithUnexploredExits}

World map:\n${observation.worldMapText}

Available actions: ${availableActions}

Rules:
- Prioritize survival when hunger is low and food is available.
- Prefer discovering new information (searching unexplored rooms and taking unexplored exits).
- If discovered things exist, inspect them before leaving when safe.
- Avoid loops and repeated no-progress actions.
- Return JSON only.

Response formats:
{ "action": "move", "direction": "north", "reason": "..." }
{ "action": "action", "actionName": "search", "reason": "..." }
{ "action": "action", "actionName": "inspect", "target": "<exact discovered thing name>", "reason": "..." }
{ "action": "action", "actionName": "eat", "reason": "..." }`

  let decision: AgentDecision | null = null
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 220,
      })
      const content = completion.choices[0]?.message?.content
      if (content) decision = parseDecision(content)
    } catch (err) {
      console.error("LLM request failed:", err)
    }
  } else {
    console.warn("OPENAI_API_KEY not set; using fallback random decisions.")
  }

  if (decision && isValidDecision(decision, observation)) {
    return decision
  }
  return randomValidDecision(observation)
}
