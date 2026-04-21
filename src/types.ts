export interface AgentAbilities {
  intelligence: number
  perception: number
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

export interface AgentDecision {
  action: "move" | "action"
  direction?: string
  actionName?: string
  target?: string
  reason?: string
}

export interface TurnObservation {
  turn: number
  status: "alive" | "dead"
  terminal: boolean
  endReason?: "max_turns" | "death" | "treasure"
  currentRoom: string
  roomDescription: string
  health: number
  hunger: number
  inventory: {
    food: number
    treasure: number
  }
  visitedRooms: string[]
  knownExits: string[]
  unexploredExits: string[]
  availableActions: string[]
  discoveredPOIs: string[]
  roomsWithUnexploredExits: string
  roomsSearchExhausted: string
  worldMapText: string
  survivalStatusText: string
}

export interface SessionCreateResponse {
  apiVersion: string
  sessionId: string
  observation: TurnObservation
}

export interface SessionStepResponse {
  apiVersion: string
  sessionId: string
  observation: TurnObservation
  lastResult: string
  fallbackApplied: boolean
}
