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
