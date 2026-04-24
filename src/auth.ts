import {
  Algodv2,
  assignGroupID,
  decodeUnsignedTransaction,
  encodeUnsignedTransaction,
  isValidAddress,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  signTransaction,
} from "algosdk"
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
  private lastX402Summary?: {
    network: string
    asset: string
    amount: string
    paymentGroupLength: number
    paymentIndex: number
  }

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

  private resolveAlgodUrl(): string {
    const fromEnv = process.env.ALGORAND_RPC_URL?.trim()
    if (fromEnv) return fromEnv
    if (this.walletAuth.network === "testnet") return "https://testnet-api.algonode.cloud"
    if (this.walletAuth.network === "mainnet") return "https://mainnet-api.algonode.cloud"
    if (this.walletAuth.network === "localnet") return "http://localhost:4001"
    return "https://testnet-api.algonode.cloud"
  }

  getLastX402Summary():
    | {
        network: string
        asset: string
        amount: string
        paymentGroupLength: number
        paymentIndex: number
      }
    | undefined {
    return this.lastX402Summary
  }

  async createX402PaymentSignature(
    quoteBoundPaymentRequired: unknown,
    challengePaymentRequired?: unknown
  ): Promise<string> {
    const challenge = (challengePaymentRequired ?? quoteBoundPaymentRequired ?? {}) as {
      resource?: Record<string, unknown>
      accepts?: Array<Record<string, unknown>>
    }
    const accept = challenge.accepts?.[0] ?? {}
    const split = Array.isArray(accept.split) ? (accept.split as Array<Record<string, unknown>>) : []
    const extra =
      accept.extra && typeof accept.extra === "object" && !Array.isArray(accept.extra)
        ? (accept.extra as Record<string, unknown>)
        : {}
    const payTo =
      (typeof accept.payTo === "string" && accept.payTo) ||
      (typeof accept.pay_to === "string" && accept.pay_to) ||
      (typeof split[0]?.address === "string" ? split[0].address : "")
    const asset =
      (typeof accept.asset === "string" && accept.asset) ||
      (typeof accept.assetId === "string" && accept.assetId) ||
      process.env.PAYMENT_ASSET_ID ||
      "10458941"
    const amount =
      (typeof accept.amount === "string" && accept.amount) ||
      (typeof accept.totalAmount === "string" && accept.totalAmount) ||
      "1000"
    const noteText =
      (typeof extra.note === "string" && extra.note.trim()) ||
      (typeof accept.x402Note === "string" && accept.x402Note.trim()) ||
      "x402-payment-v2"
    const network = (typeof accept.network === "string" && accept.network) || this.walletAuth.network
    if (!payTo) {
      throw new Error("x402 paymentRequired missing payTo/split recipient")
    }

    const algod = new Algodv2("", this.resolveAlgodUrl(), "")
    const suggested = await algod.getTransactionParams().do()
    let paymentGroup: string[] = []
    let paymentIndex = 0
    const feePayer = typeof extra.feePayer === "string" ? extra.feePayer : undefined
    if (feePayer && isValidAddress(feePayer)) {
      const feeTx = makePaymentTxnWithSuggestedParamsFromObject({
        sender: feePayer,
        receiver: feePayer,
        amount: 0,
        suggestedParams: {
          ...suggested,
          fee: 2000,
          flatFee: true,
        },
        note: new TextEncoder().encode("x402-fee-payer"),
      })
      const paymentTx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: this.walletAuth.walletAddress,
        receiver: payTo,
        amount: BigInt(amount),
        assetIndex: BigInt(asset),
        suggestedParams: {
          ...suggested,
          fee: 0,
          flatFee: true,
        },
        note: new TextEncoder().encode(noteText.slice(0, 220)),
      })
      assignGroupID([feeTx, paymentTx])
      const signedPayment = signTransaction(paymentTx, this.walletAuth.privateKey)
      paymentGroup = [
        Buffer.from(encodeUnsignedTransaction(feeTx)).toString("base64"),
        Buffer.from(signedPayment.blob).toString("base64"),
      ]
      paymentIndex = 1
    } else {
      const paymentTx = makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: this.walletAuth.walletAddress,
        receiver: payTo,
        amount: BigInt(amount),
        assetIndex: BigInt(asset),
        suggestedParams: {
          ...suggested,
          fee: 1000,
          flatFee: true,
        },
        note: new TextEncoder().encode(noteText.slice(0, 220)),
      })
      const signedPayment = signTransaction(paymentTx, this.walletAuth.privateKey)
      paymentGroup = [Buffer.from(signedPayment.blob).toString("base64")]
      paymentIndex = 0
    }
    const paymentPayload = {
      x402Version: 2,
      scheme: "exact",
      network,
      resource: challenge.resource ?? {},
      accepted: {
        scheme: (typeof accept.scheme === "string" && accept.scheme) || "exact",
        network,
        asset: String(asset),
        amount: String(amount),
        payTo,
        maxTimeoutSeconds:
          typeof accept.maxTimeoutSeconds === "number" && Number.isFinite(accept.maxTimeoutSeconds)
            ? Math.max(1, Math.floor(accept.maxTimeoutSeconds))
            : 60,
        extra,
      },
      extensions: {},
      outputSchema: null,
      payload: {
        paymentGroup,
        paymentIndex,
      },
      payer: this.walletAuth.walletAddress,
      paymentRequired: quoteBoundPaymentRequired,
      signedAt: new Date().toISOString(),
    }
    this.lastX402Summary = {
      network,
      asset: String(asset),
      amount: String(amount),
      paymentGroupLength: paymentGroup.length,
      paymentIndex,
    }
    return Buffer.from(JSON.stringify(paymentPayload)).toString("base64")
  }
}
