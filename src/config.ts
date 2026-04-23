import { readFileSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { encodeAddress, isValidAddress, mnemonicToSecretKey } from "algosdk"
import type { AgentAbilities, AgentConfig, AgentPersonality, AlgorandNetwork, WalletAuthConfig } from "./types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const AGENTS_DIR = join(__dirname, "..", "agents")
const DEFAULT_CONFIG_PATH = join(AGENTS_DIR, "agent_config.json")
const DEFAULT_CLASSES_PATH = join(AGENTS_DIR, "classes.json")
const PACKAGE_JSON_PATH = join(__dirname, "..", "package.json")

const ABILITY_NAMES = ["intelligence", "strength", "endurance", "agility"] as const
const ABILITY_POINT_BUY_POOL = 27
const ABILITY_MIN_SCORE = 8
const ABILITY_MAX_SCORE = 15
const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 200
const DISALLOWED_INSTRUCTION_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(instructions?|rules?|prompts?)\b/i,
    reason: "instruction override language",
  },
  {
    pattern: /\b(system prompt|developer message|hidden prompt|jailbreak)\b/i,
    reason: "prompt-hijacking language",
  },
  {
    pattern: /\b(you are (chatgpt|an ai|an assistant)|act as)\b/i,
    reason: "role reassignment language",
  },
  {
    pattern: /\b(recipe|poem|joke|story)\b/i,
    reason: "off-game content request",
  },
]

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

function validateCustomInstructions(raw: unknown): string | undefined {
  if (raw == null) return undefined
  if (typeof raw !== "string") {
    throw new Error("Agent config 'instructions' must be a string when provided")
  }
  const instructions = raw.trim()
  if (!instructions) return undefined
  if (instructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
    throw new Error(
      `Agent config 'instructions' must be ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters or fewer`
    )
  }
  for (const rule of DISALLOWED_INSTRUCTION_RULES) {
    if (rule.pattern.test(instructions)) {
      throw new Error(
        `Agent config 'instructions' contains disallowed content (${rule.reason}). Keep instructions focused on in-world behavior.`
      )
    }
  }
  return instructions
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
    instructions: validateCustomInstructions(o.instructions),
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

function readClientVersion(): string | undefined {
  try {
    const packageText = readFileSync(PACKAGE_JSON_PATH, "utf-8")
    const raw = JSON.parse(packageText) as { version?: unknown }
    return typeof raw.version === "string" && raw.version.trim() ? raw.version.trim() : undefined
  } catch {
    return undefined
  }
}

function parsePrivateKeyFromEnv(): Uint8Array {
  const seedPhrase = process.env.AGENT_WALLET_SEED_PHRASE?.trim()
  if (seedPhrase) {
    return mnemonicToSecretKey(seedPhrase).sk
  }
  const privateKeyBase64 = process.env.AGENT_WALLET_PRIVATE_KEY_BASE64?.trim()
  if (privateKeyBase64) {
    const bytes = new Uint8Array(Buffer.from(privateKeyBase64, "base64"))
    if (bytes.length !== 64) {
      throw new Error("AGENT_WALLET_PRIVATE_KEY_BASE64 must decode to a 64-byte Algorand private key")
    }
    return bytes
  }
  throw new Error(
    "Set AGENT_WALLET_SEED_PHRASE or AGENT_WALLET_PRIVATE_KEY_BASE64 for wallet auth"
  )
}

function parseAlgorandNetwork(raw: string | undefined): AlgorandNetwork {
  const normalized = raw?.trim().toLowerCase()
  if (!normalized) return "localnet"
  if (normalized === "localnet" || normalized === "testnet" || normalized === "mainnet" || normalized === "custom") {
    return normalized
  }
  throw new Error("ALGORAND_NETWORK must be one of: localnet, testnet, mainnet, custom")
}

export function loadWalletAuthConfig(): WalletAuthConfig {
  const privateKey = parsePrivateKeyFromEnv()
  const derivedAddress = encodeAddress(privateKey.slice(32))
  const configuredAddress = process.env.AGENT_WALLET_ADDRESS?.trim()
  if (configuredAddress && !isValidAddress(configuredAddress)) {
    throw new Error("AGENT_WALLET_ADDRESS must be a valid Algorand address")
  }
  if (configuredAddress && configuredAddress !== derivedAddress) {
    throw new Error("AGENT_WALLET_ADDRESS does not match the configured wallet private key")
  }
  return {
    walletAddress: configuredAddress ?? derivedAddress,
    privateKey,
    network: parseAlgorandNetwork(process.env.ALGORAND_NETWORK),
    protocolVersion: process.env.AGENT_PROTOCOL_VERSION?.trim() || "v1",
    clientVersion: process.env.AGENT_CLIENT_VERSION?.trim() || readClientVersion(),
    buildHash: process.env.AGENT_BUILD_HASH?.trim() || undefined,
  }
}
