import type {
  AgentJournalResponse,
  AgentConfig,
  AgentDecision,
  PaidActionExecuteRequest,
  PaymentQuoteRequest,
  PaymentQuoteResponse,
  SessionCreateResponse,
  SessionStepResponse,
} from "./types.js"
import type { WorldSessionAuth } from "./auth.js"

function parsePaymentRequired(res: Response, bodyText: string): unknown {
  const headerValue = res.headers.get("PAYMENT-REQUIRED")
  if (headerValue) {
    try {
      return JSON.parse(Buffer.from(headerValue, "base64").toString("utf-8"))
    } catch {
      // best effort fallthrough to body parse
    }
  }
  if (bodyText.trim()) {
    try {
      return JSON.parse(bodyText)
    } catch {
      return { raw: bodyText }
    }
  }
  return { error: "payment required" }
}

function extractQuoteId(paymentRequired: unknown): string | undefined {
  const accepts = (paymentRequired as { accepts?: Array<Record<string, unknown>> })?.accepts
  const first = Array.isArray(accepts) ? accepts[0] : undefined
  const quoteId = first?.quoteId
  return typeof quoteId === "string" && quoteId.trim() ? quoteId.trim() : undefined
}

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
  if (auth) {
    let quoteBoundPaymentRequired: unknown
    let lastChallengeFingerprint: string | undefined
    for (let i = 0; i < 3 && res.status === 402; i += 1) {
      const body = await res.text()
      const paymentRequired = parsePaymentRequired(res, body)
      const challengeFingerprint = JSON.stringify(paymentRequired)
      if (lastChallengeFingerprint && challengeFingerprint === lastChallengeFingerprint) {
        break
      }
      lastChallengeFingerprint = challengeFingerprint
      if (extractQuoteId(paymentRequired)) {
        quoteBoundPaymentRequired = paymentRequired
      }
      const signature = await auth.createX402PaymentSignature(
        quoteBoundPaymentRequired ?? paymentRequired,
        paymentRequired
      )
      headers.set("PAYMENT-SIGNATURE", signature)
      res = await fetch(url, { ...init, headers })
    }
  }
  if (!res.ok) {
    const errorBody = await res.text()
    const headerDump = JSON.stringify(Object.fromEntries(res.headers.entries()))
    const detail = errorBody.trim() || "<empty body>"
    throw new Error(
      `${errorLabel}: ${res.status} ${res.statusText} url=${url} headers=${headerDump} body=${detail}`
    )
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

export async function issuePaymentQuote(
  worldBaseUrl: string,
  sessionId: string,
  request: PaymentQuoteRequest,
  auth: WorldSessionAuth
): Promise<PaymentQuoteResponse> {
  return fetchWorldJson<PaymentQuoteResponse>(
    `${worldBaseUrl}/sessions/${sessionId}/payments/quote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    "Payment quote failed",
    auth
  )
}

export async function executePaidAction(
  worldBaseUrl: string,
  sessionId: string,
  request: PaidActionExecuteRequest,
  auth: WorldSessionAuth
): Promise<SessionStepResponse> {
  const quoteQuery = new URLSearchParams({ quoteId: request.quoteId }).toString()
  return fetchWorldJson<SessionStepResponse>(
    `${worldBaseUrl}/sessions/${sessionId}/paid-action?${quoteQuery}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    },
    "Paid action failed",
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
