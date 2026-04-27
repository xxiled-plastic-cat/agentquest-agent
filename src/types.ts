export interface AgentAbilities {
  intelligence: number
  strength: number
  endurance: number
  agility: number
}

export interface AgentPersonality {
  confidence: number
  caution: number
}

export interface AgentConfig {
  name: string
  class: string
  abilities: AgentAbilities
  personality: AgentPersonality
  instructions?: string
}

export interface ClientBuildMetadata {
  protocolVersion?: string
  clientVersion?: string
  buildHash?: string
}

export type AlgorandNetwork = "localnet" | "testnet" | "mainnet" | "custom"

export interface WalletAuthConfig {
  walletAddress: string
  privateKey: Uint8Array
  network: AlgorandNetwork
  protocolVersion?: string
  clientVersion?: string
  buildHash?: string
}

export interface AuthChallengeRequest extends ClientBuildMetadata {
  walletAddress: string
  network?: AlgorandNetwork
}

export interface AuthChallengePayload {
  challengeId: string
  walletAddress: string
  worldBaseUrl: string
  purpose: "agentquest-session-auth"
  network: AlgorandNetwork
  issuedAt: string
  expiresAt: string
  clientVersion?: string
  protocolVersion?: string
  buildHash?: string
}

export interface AuthChallengeResponse {
  apiVersion: string
  challengeId: string
  walletAddress: string
  unsignedTransaction: string
  txId: string
  payload: AuthChallengePayload
  expiresAt: string
}

export interface AuthVerifyRequest {
  challengeId: string
  signedTransaction: string
}

export interface AuthVerifyResponse {
  apiVersion: string
  accessToken: string
  walletAddress: string
  expiresAt: string
}

export interface AgentDecision {
  action: "move" | "action"
  direction?: string
  actionName?: string
  target?: string
  reason?: string
}

export interface DecisionContext {
  previousResponseId?: string
}

export interface DecisionResult {
  decision: AgentDecision
  responseId?: string
}

export type ActionToolName =
  | "move"
  | "search"
  | "inspect"
  | "talk"
  | "attack"
  | "eat"
  | "rest"
  | "equip"
  | "unequip"
  | "buy"
  | "sell"
  | "craft"
  | "use"
  | "mine"
  | "chop"
  | "forage"
  | "fish"
  | "salvage"

export interface ActionToolParameterSchema {
  type: "object"
  properties: Record<
    string,
    {
      type: "string" | "number" | "integer" | "boolean"
      description?: string
      enum?: Array<string | number | boolean>
      minimum?: number
      maximum?: number
    }
  >
  required?: string[]
  additionalProperties?: boolean
}

export interface ActionToolTarget {
  id: string
  name: string
  description?: string
  metadata?: Record<string, string | number | boolean>
}

export interface ActionToolDefinition {
  name: ActionToolName
  description: string
  parameters: ActionToolParameterSchema
  validTargets?: ActionToolTarget[]
  requiresPayment: boolean
  consumesTurn: boolean
}

export interface TurnObservation {
  turn: number
  worldTick: number
  status: "alive" | "dead"
  terminal: boolean
  endReason?: "max_turns" | "death"
  currentRoom: string
  currentRoomName: string
  roomDescription: string
  vitality: {
    maxHealth: number
    health: number
    maxStamina: number
    stamina: number
  }
  marks: number
  conditions: string[]
  inventory: {
    bag: {
      maxSlots: number
      usedSlots: number
      items: Record<string, number>
    }
    equipped: {
      head: string | null
      chest: string | null
      arms: string | null
      legs: string | null
      feet: string | null
      leftHand: string | null
      rightHand: string | null
      cloak: string | null
      quiver: string | null
    }
  }
  visitedRooms: string[]
  knownExits: string[]
  unexploredExits: string[]
  availableActions: string[]
  discoveredPOIs: string[]
  resourceNodes: Array<{
    id: string
    name: string
    actionType: "mine" | "chop" | "forage" | "fish" | "salvage"
  }>
  craftingRecipes: Array<{
    id: string
    name: string
    outputItemId: string
    outputQuantity: number
    ingredients: Array<{
      itemId: string
      quantity: number
    }>
  }>
  actionTools: ActionToolDefinition[]
  talkTargets: string[]
  merchantOffers: Array<{
    merchantId: string
    merchantName: string
    merchantDescription: string
    balanceMarks: number
    inventory: Array<{
      itemId: string
      stock: number
      maxStock: number
      buyPriceMarks: number
      sellPriceMarks: number
    }>
  }>
  activeQuest: {
    npcName: string
    npcRoomId: string
    questType: "retrieval" | "combat"
    requiredItemId: string
    status: "assigned" | "completed"
  } | null
  activeCombat: {
    npcId: string
    npcName: string
    npcHealth: number
    npcMaxHealth: number
    npcArmorClass: number
    agentArmorClass: number
    lockedByAnotherAgent: boolean
  } | null
  roomsWithUnexploredExits: string
  roomsSearchExhausted: string
  worldMapText: string
  survivalStatusText: string
  lastSessionLogbook: string
  questbook: string
}

export interface SessionCreateResponse {
  apiVersion: string
  sessionId: string
  agentInstanceId: string
  observation: TurnObservation
}

export interface SessionStepResponse {
  apiVersion: string
  sessionId: string
  observation: TurnObservation
  lastResult: string
  fallbackApplied: boolean
  intentAccepted: boolean
  rejectReason?: string
  settlementTransaction?: string
}

export type PaidActionType = "move_toll" | "buy" | "sell" | "craft" | "event"

export interface SplitPaymentRecipient {
  role: "merchant" | "platform"
  address: string
  amount: string
}

export interface PaymentQuoteRequest {
  actionType: PaidActionType
  direction?: string
  actionName?: string
  target?: string
  quantity?: number
  assetId?: string
  network?: AlgorandNetwork
  idempotencyKey?: string
}

export interface PaymentQuoteResponse {
  apiVersion: string
  sessionId: string
  quoteId: string
  actionType: PaidActionType
  direction?: string
  actionName?: string
  target?: string
  network: AlgorandNetwork
  assetId: string
  split: SplitPaymentRecipient[]
  totalAmount: string
  nonce: string
  expiresAt: string
  actionFingerprint: string
  x402Note?: string
}

export interface PaidActionExecuteRequest {
  quoteId: string
  idempotencyKey: string
  actionType: PaidActionType
  direction?: string
  actionName?: string
  target?: string
}

export interface SettlementProof {
  version: "aq-settlement-proof-v1"
  quoteId: string
  actionFingerprint: string
  network: AlgorandNetwork
  assetId: string
  payer: string
  transaction: string
  split: SplitPaymentRecipient[]
  nonce: string
  expiresAt: string
  settledAt: string
  signature: string
}

export interface QuestbookEntry {
  sessionId: string
  completedAt: string
  endReason: "max_turns" | "death"
  turns: number
  explorationPoints: number
  exitsDiscovered: number
  roomsVisited: string[]
  itemsFound: string[]
  importantFindings: string[]
  chronicleEntry?: string
}

export interface AgentJournal {
  agentInstanceId: string
  agentMemoryKey: string
  lastSessionLogbook: Array<{
    turn: number
    room: string
    roomName: string
    action: string
    resultSummary: string
    reason?: string
    health: number
    stamina: number
    conditions: string[]
    food: number
    treasure: number
  }>
  questbook: QuestbookEntry[]
}

export interface AgentJournalResponse {
  agentInstanceId: string
  agentMemoryKey: string
  journal: AgentJournal
  lastSessionLogbook: string
  questbook: string
}
