import "dotenv/config"
import { loadAgentConfig, loadWalletAuthConfig } from "./config.js"
import { WorldSessionAuth } from "./auth.js"
import { createSession, executePaidAction, issuePaymentQuote, stepSession } from "./world-client.js"

const WORLD_BASE_URL = process.env.WORLD_BASE_URL ?? "http://localhost:8080"
const TEST_INITIAL_ROOM = process.env.TEST_INITIAL_ROOM ?? "HL001"
const TEST_MERCHANT_ID = process.env.TEST_MERCHANT_ID ?? "hl_merchant_01"
const TEST_ITEM_ID = process.env.TEST_ITEM_ID ?? "ration"
const TEST_QUANTITY = Math.max(1, parseInt(process.env.TEST_QUANTITY ?? "1", 10) || 1)

function requirePaymentSummary(worldAuth: WorldSessionAuth): string {
  const paymentSummary = worldAuth.getLastX402Summary()
  if (!paymentSummary) {
    throw new Error("Missing signed payload summary from x402 retry")
  }
  return `network=${paymentSummary.network} asset=${paymentSummary.asset} amount=${paymentSummary.amount} paymentGroupLen=${paymentSummary.paymentGroupLength} paymentIndex=${paymentSummary.paymentIndex}`
}

async function run(): Promise<void> {
  const config = loadAgentConfig()
  const walletAuth = loadWalletAuthConfig()
  const worldAuth = new WorldSessionAuth(WORLD_BASE_URL, walletAuth)

  console.log("=== Deterministic Paid Buy Test ===")
  console.log(`World URL: ${WORLD_BASE_URL}`)
  console.log(`Buyer wallet: ${walletAuth.walletAddress}`)
  console.log(`Target: ${TEST_MERCHANT_ID}:${TEST_ITEM_ID}:${TEST_QUANTITY}`)

  const created = await createSession(WORLD_BASE_URL, config, worldAuth, 1337)
  const sessionId = created.sessionId
  console.log(`Session: ${sessionId} room=${created.observation.currentRoom}`)

  const pre = await stepSession(
    WORLD_BASE_URL,
    sessionId,
    { action: "action", actionName: "search", reason: "deterministic paid buy pre-check" },
    worldAuth
  )
  const preRations = pre.observation.inventory.bag.items[TEST_ITEM_ID] ?? 0
  console.log(`Before buy: marks=${pre.observation.marks} ${TEST_ITEM_ID}=${preRations}`)

  const target = `${TEST_MERCHANT_ID}:${TEST_ITEM_ID}:${TEST_QUANTITY}`

  const quote = await issuePaymentQuote(
    WORLD_BASE_URL,
    sessionId,
    {
      actionType: "buy",
      actionName: "buy",
      target,
      idempotencyKey: `buy-quote-${Date.now()}`,
    },
    worldAuth
  )
  console.log(
    `Buy quote: quoteId=${quote.quoteId} total=${quote.totalAmount} asset=${quote.assetId} split=${quote.split
      .map((s) => `${s.role}:${s.amount}`)
      .join(",")}`
  )
  if (quote.x402Note) {
    console.log(`Buy tx note: ${quote.x402Note}`)
  }

  const paidResult = await executePaidAction(
    WORLD_BASE_URL,
    sessionId,
    {
      quoteId: quote.quoteId,
      idempotencyKey: `pay-${Date.now()}`,
      actionType: "buy",
      actionName: "buy",
      target,
    },
    worldAuth
  )
  console.log(`Buy signed payload summary: ${requirePaymentSummary(worldAuth)}`)

  const postRations = paidResult.observation.inventory.bag.items[TEST_ITEM_ID] ?? 0
  console.log(`Paid action result: ${paidResult.lastResult}`)
  if (paidResult.settlementTransaction) {
    console.log(`Settlement txid: ${paidResult.settlementTransaction}`)
  }
  console.log(`After buy: marks=${paidResult.observation.marks} ${TEST_ITEM_ID}=${postRations}`)
  if (!/bought/i.test(paidResult.lastResult)) {
    throw new Error(`Expected paid buy success, got: ${paidResult.lastResult}`)
  }
  if (postRations < preRations + TEST_QUANTITY) {
    throw new Error("Paid buy did not increase inventory as expected")
  }
  if (paidResult.observation.marks !== pre.observation.marks) {
    throw new Error("Paid x402 buy should not modify in-game marks")
  }
  console.log("PASS deterministic paid buy flow completed via Caddy x402 path")
}

run().catch((err) => {
  if (err instanceof Error) {
    console.error("FAIL deterministic paid buy flow:", err.message)
    if (err.stack) {
      console.error(err.stack)
    }
  } else {
    console.error("FAIL deterministic paid buy flow:", err)
  }
  process.exit(1)
})
