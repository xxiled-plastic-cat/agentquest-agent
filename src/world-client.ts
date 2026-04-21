import type {
  AgentJournalResponse,
  AgentConfig,
  AgentDecision,
  SessionCreateResponse,
  SessionStepResponse,
} from "./types.js"

export async function createSession(
  worldBaseUrl: string,
  config: AgentConfig,
  seed?: number,
  agentInstanceId?: string
): Promise<SessionCreateResponse> {
  const res = await fetch(`${worldBaseUrl}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: config.name, agentInstanceId, config, seed }),
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
  chronicleEntry: string
): Promise<void> {
  const res = await fetch(`${worldBaseUrl}/agents/${encodeURIComponent(agentInstanceId)}/questbook-chronicle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, chronicleEntry }),
  })
  if (!res.ok) {
    throw new Error(`World questbook update failed: ${res.status} ${await res.text()}`)
  }
}
