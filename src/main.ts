import "dotenv/config"
import { loadAgentConfig, loadClasses } from "./config.js"
import { decideAction, generateQuestChronicle } from "./llm.js"
import { createSession, getAgentJournal, setQuestbookChronicle, stepSession } from "./world-client.js"
import type { AgentConfig } from "./types.js"

const WORLD_BASE_URL = process.env.WORLD_BASE_URL ?? "http://localhost:8787"
const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? "80", 10)

function parseSeed(): number | undefined {
  const arg = process.argv.find((a) => a.startsWith("--seed="))
  if (!arg) return undefined
  const value = arg.slice("--seed=".length)
  const n = parseInt(value, 10)
  return Number.isNaN(n) ? undefined : n
}

function parseConfigPath(): string | undefined {
  const withEquals = process.argv.find((a) => a.startsWith("--config="))
  if (withEquals) return withEquals.slice("--config=".length).trim() || undefined
  const idx = process.argv.indexOf("--config")
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].trim()
  return undefined
}

function parseAgentInstanceId(): string | undefined {
  const withEquals = process.argv.find((a) => a.startsWith("--agent-instance-id="))
  if (withEquals) return withEquals.slice("--agent-instance-id=".length).trim() || undefined
  const idx = process.argv.indexOf("--agent-instance-id")
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].trim()
  return undefined
}

function printStartup(
  config: AgentConfig,
  configPath: string | undefined,
  agentInstanceId?: string
): void {
  console.log("")
  console.log("=== AgentQuest Agent Client ===")
  console.log(`World API: ${WORLD_BASE_URL}`)
  console.log(`Agent: ${config.name} (${config.class})`)
  console.log(`Config: ${configPath ?? "agents/agent_config.json"}`)
  if (agentInstanceId) {
    console.log(`Agent Instance: ${agentInstanceId}`)
  }
  console.log("")
}

async function run(): Promise<void> {
  const configPath = parseConfigPath()
  const seed = parseSeed()
  const agentInstanceId = parseAgentInstanceId()
  const config = loadAgentConfig(configPath)
  const classStrategies = loadClasses()
  printStartup(config, configPath, agentInstanceId)

  const created = await createSession(WORLD_BASE_URL, config, seed, agentInstanceId)
  let sessionId = created.sessionId
  let observation = created.observation
  let previousResponseId: string | undefined

  console.log(`Session: ${sessionId}`)
  console.log(`Agent Instance ID: ${created.agentInstanceId}`)

  let steps = 0
  while (!observation.terminal && steps < MAX_STEPS) {
    const decisionResult = await decideAction(observation, config, classStrategies, {
      previousResponseId,
    })
    previousResponseId = decisionResult.responseId
    const stepResult = await stepSession(WORLD_BASE_URL, sessionId, decisionResult.decision)
    observation = stepResult.observation
    steps += 1

    console.log("")
    console.log(`TURN ${observation.turn}`)
    console.log(`ROOM ${observation.currentRoom}`)
    console.log(`KNOWN EXITS ${observation.knownExits.join(", ") || "none"}`)
    console.log(
      `HEALTH ${observation.health}/10  HUNGER ${observation.hunger}/10  FOOD ${observation.inventory.food}  TREASURE ${observation.inventory.treasure}`
    )
    console.log(`RESULT ${stepResult.lastResult}`)
    if (decisionResult.decision.reason) console.log(`REASON ${decisionResult.decision.reason}`)
    if (stepResult.fallbackApplied) {
      console.log("NOTE World service applied fallback validation.")
    }
  }

  if (observation.terminal) {
    try {
      const journal = await getAgentJournal(WORLD_BASE_URL, created.agentInstanceId)
      const questbook = journal.journal.questbook
      const dayIndex = questbook.findIndex((entry) => entry.sessionId === sessionId)
      if (dayIndex >= 0) {
        const questEntry = questbook[dayIndex]
        const chronicle = await generateQuestChronicle(
          dayIndex + 1,
          questEntry,
          config,
          journal.lastSessionLogbook
        )
        await setQuestbookChronicle(WORLD_BASE_URL, created.agentInstanceId, sessionId, chronicle)
        console.log(`QUESTLOG Updated Day ${dayIndex + 1} chronicle entry.`)
      } else {
        console.warn("QUESTLOG No matching questbook session entry found; chronicle not updated.")
      }
    } catch (err) {
      console.warn(
        `QUESTLOG Failed to generate or save chronicle: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      )
    }
  } else {
    console.warn("QUESTLOG Session did not reach a terminal state; chronicle was not generated.")
  }

  console.log("")
  console.log("=== Session Complete ===")
  console.log(`End reason: ${observation.endReason ?? "unknown"}`)
  console.log(`Turns played: ${Math.min(steps, MAX_STEPS)}`)
  console.log(`Final room: ${observation.currentRoom}`)
  console.log(`Use for continuation: --agent-instance-id=${created.agentInstanceId}`)
}

run().catch((err) => {
  console.error("Agent runner failed:", err)
  process.exit(1)
})
