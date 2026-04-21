import "dotenv/config"
import { loadAgentConfig, loadClasses } from "./config.js"
import { decideAction } from "./llm.js"
import { createSession, stepSession } from "./world-client.js"
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

function printStartup(config: AgentConfig, configPath: string | undefined): void {
  console.log("")
  console.log("=== AgentQuest Agent Client ===")
  console.log(`World API: ${WORLD_BASE_URL}`)
  console.log(`Agent: ${config.name} (${config.class})`)
  console.log(`Config: ${configPath ?? "agents/agent_config.json"}`)
  console.log("")
}

async function run(): Promise<void> {
  const configPath = parseConfigPath()
  const seed = parseSeed()
  const config = loadAgentConfig(configPath)
  const classStrategies = loadClasses()
  printStartup(config, configPath)

  const created = await createSession(WORLD_BASE_URL, config, seed)
  let sessionId = created.sessionId
  let observation = created.observation

  console.log(`Session: ${sessionId}`)

  let steps = 0
  while (!observation.terminal && steps < MAX_STEPS) {
    const decision = await decideAction(observation, config, classStrategies)
    const stepResult = await stepSession(WORLD_BASE_URL, sessionId, decision)
    observation = stepResult.observation
    steps += 1

    console.log("")
    console.log(`TURN ${observation.turn}`)
    console.log(`ROOM ${observation.currentRoom}`)
    console.log(
      `HEALTH ${observation.health}/10  HUNGER ${observation.hunger}/10  FOOD ${observation.inventory.food}  TREASURE ${observation.inventory.treasure}`
    )
    console.log(`RESULT ${stepResult.lastResult}`)
    if (decision.reason) console.log(`REASON ${decision.reason}`)
    if (stepResult.fallbackApplied) {
      console.log("NOTE World service applied fallback validation.")
    }
  }

  console.log("")
  console.log("=== Session Complete ===")
  console.log(`End reason: ${observation.endReason ?? "unknown"}`)
  console.log(`Turns played: ${Math.min(steps, MAX_STEPS)}`)
  console.log(`Final room: ${observation.currentRoom}`)
}

run().catch((err) => {
  console.error("Agent runner failed:", err)
  process.exit(1)
})
