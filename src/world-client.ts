import type {
  AgentJournalResponse,
  AgentConfig,
  AgentDecision,
  SessionCreateResponse,
  SessionStepResponse,
} from "./types.js"
import type { WorldSessionAuth } from "./auth.js"

async function fetchWorldJson<T>(
  url: string,
  init: RequestInit,
  errorLabel: string,
  auth?: WorldSessionAuth
): Promise<T> {
  const headers = new Headers(init.headers)
  if (auth) {
    headers.set("authorization", `Bearer ${await auth.getAccessToken()}`)
  }
  let res = await fetch(url, { ...init, headers })
  if (res.status === 401 && auth) {
    headers.set("authorization", `Bearer ${await auth.getAccessToken(true)}`)
    res = await fetch(url, { ...init, headers })
  }
  if (!res.ok) {
    throw new Error(`${errorLabel}: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as T
}

export async function createSession(
  worldBaseUrl: string,
  config: AgentConfig,
  auth: WorldSessionAuth,
  seed?: number,
  agentInstanceId?: string
): Promise<SessionCreateResponse> {
  return fetchWorldJson<SessionCreateResponse>(
    `${worldBaseUrl}/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: config.name, agentInstanceId, config, seed }),
    },
    "World create session failed",
    auth
  )
}

export async function stepSession(
  worldBaseUrl: string,
  sessionId: string,
  decision: AgentDecision,
  auth: WorldSessionAuth
): Promise<SessionStepResponse> {
  return fetchWorldJson<SessionStepResponse>(
    `${worldBaseUrl}/sessions/${sessionId}/step`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    },
    "World step failed",
    auth
  )
}

export async function getAgentJournal(
  worldBaseUrl: string,
  agentInstanceId: string
): Promise<AgentJournalResponse> {
  const res = await fetch(`${worldBaseUrl}/agents/${encodeURIComponent(agentInstanceId)}/journal`)
  if (!res.ok) {
    throw new Error(`World journal fetch failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as AgentJournalResponse
}

export async function setQuestbookChronicle(
  worldBaseUrl: string,
  agentInstanceId: string,
  sessionId: string,
  chronicleEntry: string,
  auth: WorldSessionAuth
): Promise<void> {
  await fetchWorldJson<{ ok: true }>(
    `${worldBaseUrl}/agents/${encodeURIComponent(agentInstanceId)}/questbook-chronicle`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, chronicleEntry }),
    },
    "World questbook update failed",
    auth
  )
}
