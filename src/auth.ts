import { decodeUnsignedTransaction, signTransaction } from "algosdk"
import type {
  AuthChallengeRequest,
  AuthChallengeResponse,
  AuthVerifyRequest,
  AuthVerifyResponse,
  WalletAuthConfig,
} from "./types.js"

async function fetchJson<T>(url: string, init: RequestInit, errorLabel: string): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw new Error(`${errorLabel}: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as T
}

function signChallenge(unsignedTransaction: string, walletAuth: WalletAuthConfig): string {
  const txn = decodeUnsignedTransaction(Buffer.from(unsignedTransaction, "base64"))
  const signed = signTransaction(txn, walletAuth.privateKey)
  return Buffer.from(signed.blob).toString("base64")
}

export class WorldSessionAuth {
  private accessToken?: string
  private expiresAt?: string

  constructor(
    private readonly worldBaseUrl: string,
    private readonly walletAuth: WalletAuthConfig
  ) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.accessToken && this.expiresAt && Date.parse(this.expiresAt) > Date.now() + 5000) {
      return this.accessToken
    }

    const challengeRequest: AuthChallengeRequest = {
      walletAddress: this.walletAuth.walletAddress,
      network: this.walletAuth.network,
      protocolVersion: this.walletAuth.protocolVersion,
      clientVersion: this.walletAuth.clientVersion,
      buildHash: this.walletAuth.buildHash,
    }
    const challenge = await fetchJson<AuthChallengeResponse>(
      `${this.worldBaseUrl}/auth/challenge`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(challengeRequest),
      },
      "World auth challenge failed"
    )
    const verifyRequest: AuthVerifyRequest = {
      challengeId: challenge.challengeId,
      signedTransaction: signChallenge(challenge.unsignedTransaction, this.walletAuth),
    }
    const verified = await fetchJson<AuthVerifyResponse>(
      `${this.worldBaseUrl}/auth/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(verifyRequest),
      },
      "World auth verify failed"
    )
    this.accessToken = verified.accessToken
    this.expiresAt = verified.expiresAt
    return verified.accessToken
  }
}
