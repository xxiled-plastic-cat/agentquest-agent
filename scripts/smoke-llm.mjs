#!/usr/bin/env node

/**
 * Phase 3 LLM smoke: zs-proxy (ZeroSignal) must be up.
 * One Responses API tool call — no world session, no payments.
 *
 * Requires: OPENAI_BASE_URL (default http://127.0.0.1:8080/v1)
 * Pattern: brownie-bot smoke-llm (connectivity only).
 */

import OpenAI from "openai"

const baseURL = process.env.OPENAI_BASE_URL?.trim() || "http://127.0.0.1:8080/v1"
const apiKey = process.env.OPEN_AI_API_KEY?.trim() || "zerosignal"
const model = process.env.OPENAI_MODEL?.trim() || "Qwen/Qwen3-Coder-480B-A35B-Instruct"
const reasoningRaw = process.env.OPENAI_REASONING_EFFORT?.trim().toLowerCase()
const reasoningEffort =
  reasoningRaw === "low" || reasoningRaw === "medium" || reasoningRaw === "high"
    ? reasoningRaw
    : "medium"

function healthUrlFromBase(url) {
  try {
    const u = new URL(url)
    // .../v1 → /healthz on same origin (zs-proxy)
    return `${u.origin}/healthz`
  } catch {
    return "http://127.0.0.1:8080/healthz"
  }
}

async function checkProxyHealth() {
  const healthUrl = healthUrlFromBase(baseURL)
  const res = await fetch(healthUrl)
  if (!res.ok) {
    throw new Error(`zs-proxy health failed: ${healthUrl} → ${res.status}`)
  }
  return healthUrl
}

function getToolCall(response) {
  const output = response?.output
  if (!Array.isArray(output)) return null
  for (const item of output) {
    if (item?.type !== "function_call" || typeof item.name !== "string") continue
    let args = {}
    if (typeof item.arguments === "string") {
      try {
        args = JSON.parse(item.arguments)
      } catch {
        args = {}
      }
    } else if (item.arguments && typeof item.arguments === "object") {
      args = item.arguments
    }
    return { name: item.name, arguments: args }
  }
  return null
}

async function run() {
  const healthUrl = await checkProxyHealth()
  const openai = new OpenAI({ apiKey, baseURL })

  const tools = [
    {
      type: "function",
      name: "smoke_ping",
      description: "Connectivity smoke tool. Call once with message=pong.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Must be the string pong." },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  ]

  const response = await openai.responses.create({
    model,
    instructions: "You are a connectivity smoke test. Call smoke_ping exactly once.",
    input: 'Call the smoke_ping tool with message set to "pong". Do not answer in prose.',
    tools,
    tool_choice: "required",
    max_output_tokens: 128,
    reasoning: { effort: reasoningEffort },
  })

  const toolCall = getToolCall(response)
  if (!toolCall || toolCall.name !== "smoke_ping") {
    throw new Error(`Expected smoke_ping tool call, got: ${JSON.stringify(toolCall)}`)
  }

  const message =
    typeof toolCall.arguments?.message === "string" ? toolCall.arguments.message : ""
  const responseId =
    typeof response.id === "string" && response.id.trim() ? response.id.trim() : undefined

  return {
    status: "ok",
    model,
    baseURL,
    healthUrl,
    reasoningEffort,
    toolCalled: toolCall.name,
    message,
    responseId: responseId ?? null,
    note: "zs-proxy connectivity only — no world session, no treasury movement",
  }
}

run()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[smoke-llm] ${message}`)
    process.stdout.write(`${JSON.stringify({ status: "failed", error: message, baseURL }, null, 2)}\n`)
    process.exitCode = 1
  })
