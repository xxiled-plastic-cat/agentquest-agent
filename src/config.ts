import { readFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentAbilities, AgentConfig, AgentPersonality } from "./types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR = join(__dirname, "..", "agents")
const DEFAULT_CONFIG_PATH = join(AGENTS_DIR, "agent_config.json")
const DEFAULT_CLASSES_PATH = join(AGENTS_DIR, "classes.json")

const ABILITY_NAMES = ["intelligence", "strength", "endurance", "agility"] as const
const ABILITY_POINT_BUY_POOL = 27
const ABILITY_MIN_SCORE = 8
const ABILITY_MAX_SCORE = 15

function getPointBuyCost(score: number): number {
  if (score < ABILITY_MIN_SCORE || score > ABILITY_MAX_SCORE) {
    throw new Error(
      `Ability scores must be between ${ABILITY_MIN_SCORE} and ${ABILITY_MAX_SCORE} for point buy`
    )
  }
  const costs: Record<number, number> = {
    8: 0,
    9: 1,
    10: 2,
    11: 3,
    12: 4,
    13: 5,
    14: 7,
    15: 9,
  }
  return costs[score]
}

function isAgentAbilities(v: unknown): v is AgentAbilities {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  for (const key of ABILITY_NAMES) {
    if (typeof o[key] !== "number") return false
    const value = o[key] as number
    if (!Number.isInteger(value)) return false
    if (value < ABILITY_MIN_SCORE || value > ABILITY_MAX_SCORE) return false
  }
  return true
}

function isAgentPersonality(v: unknown): v is AgentPersonality {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  const c = o.confidence
  const w = o.caution
  return typeof c === "number" && c >= 0 && c <= 1 && typeof w === "number" && w >= 0 && w <= 1
}

function validateAgentConfig(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Agent config must be a JSON object")
  }
  const o = raw as Record<string, unknown>
  if (typeof o.name !== "string" || !o.name.trim()) {
    throw new Error("Agent config requires a non-empty 'name'")
  }
  if (typeof o.class !== "string" || !o.class.trim()) {
    throw new Error("Agent config requires non-empty 'class'")
  }
  if (!isAgentAbilities(o.abilities)) {
    throw new Error(`Agent config 'abilities' must include: ${ABILITY_NAMES.join(", ")}`)
  }
  const abilities = o.abilities as AgentAbilities
  const totalPointBuyCost = ABILITY_NAMES.reduce((sum, key) => sum + getPointBuyCost(abilities[key]), 0)
  if (totalPointBuyCost !== ABILITY_POINT_BUY_POOL) {
    throw new Error(
      `Ability point-buy cost must equal ${ABILITY_POINT_BUY_POOL}, got ${totalPointBuyCost}`
    )
  }
  if (!isAgentPersonality(o.personality)) {
    throw new Error("Agent config 'personality' must include confidence and caution (0-1)")
  }

  return {
    name: o.name.trim(),
    class: o.class.trim(),
    abilities,
    personality: o.personality as AgentPersonality,
    instructions: typeof o.instructions === "string" ? o.instructions : undefined,
  }
}

export function loadAgentConfig(configFilePath?: string): AgentConfig {
  const path = configFilePath ? resolve(process.cwd(), configFilePath) : DEFAULT_CONFIG_PATH
  const text = readFileSync(path, "utf-8")
  const raw = JSON.parse(text) as unknown
  return validateAgentConfig(raw)
}

export function loadClasses(classesPath?: string): Record<string, string[]> {
  const path = classesPath ? resolve(process.cwd(), classesPath) : DEFAULT_CLASSES_PATH
  const text = readFileSync(path, "utf-8")
  const raw = JSON.parse(text) as unknown
  if (!raw || typeof raw !== "object") {
    throw new Error("classes.json must be a JSON object")
  }
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
      out[key] = value as string[]
    }
  }
  return out
}
