import type {
  AgentConfig,
  AgentDecision,
  SessionCreateResponse,
  SessionStepResponse,
} from "./types.js"

export async function createSession(
  worldBaseUrl: string,
  config: AgentConfig,
  seed?: number
): Promise<SessionCreateResponse> {
  const res = await fetch(`${worldBaseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: config.name, config, seed }),
  })
  if (!res.ok) {
    throw new Error(`World create session failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as SessionCreateResponse
}

export async function stepSession(
  worldBaseUrl: string,
  sessionId: string,
  decision: AgentDecision
): Promise<SessionStepResponse> {
  const res = await fetch(`${worldBaseUrl}/sessions/${sessionId}/step`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  })
  if (!res.ok) {
    throw new Error(`World step failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as SessionStepResponse
}
