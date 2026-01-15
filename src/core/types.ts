// Strategy in the market with Virtual Token Minting (1 vUSD → 1 YES + 1 NO)
// YES and NO tokens trade against each other, maintaining YES + NO ≈ 1.0
export interface MarketStrategy {
  id: string;
  name: string;
  description: string; // Strategy definition (e.g., "S&P 500 exceeds $700")
  evaluationLogic: string; // Clear human-readable logic for frontend display
  mathematicalLogic: string; // Exact mathematical formula (e.g., "price > 700")
  usedDataSources: Array<{
    id: number;
    currentValue: number;
    targetValue: number;
    operator?: string;
  }>;
  resolutionDeadline: number; // Timestamp when the strategy should be verified
  dataSources?: any[]; // Legacy field, kept for backward compatibility if needed
  // Shared liquidity pool: YES tokens * NO tokens = k (constant product)
  // Price of YES = noTokenReserve / yesTokenReserve
  // Price of NO = yesTokenReserve / noTokenReserve
  // YES price + NO price ≈ 1.0 (maintained by AMM)
  yesToken: {
    tokenReserve: number; // YES tokens in the pool
    volume: number;
    history: Array<{ price: number; timestamp: number }>;
    twap: number; // Time-Weighted Average Price
    twapHistory: Array<{ twap: number; timestamp: number }>;
  };
  noToken: {
    tokenReserve: number; // NO tokens in the pool
    volume: number;
    history: Array<{ price: number; timestamp: number }>;
    twap: number; // Time-Weighted Average Price
    twapHistory: Array<{ twap: number; timestamp: number }>;
  };
  timestamp: number;
  resolved: boolean;
  winner: 'yes' | 'no' | null; // Determined by TWAP or Evaluation Logic
}

// Market state with multiple strategies
export interface MarketState {
  strategies: MarketStrategy[];
  timestamp: number;
  roundNumber: number; // Current trading round number
  roundStartTime: number; // When current round started
  roundEndTime: number; // When current round ends
  roundDuration: number; // Duration of each round in milliseconds (900000ms = 15 minutes)
  roundsUntilResolution: number; // Estimated rounds until resolution (50 minimum)
  lastRoundEndTime: number | null; // When the last round ended (for enforcing gap between rounds)
  tradeQueue: Array<{ decision: TradeDecision; agent: Agent }>; // Queue of trades to execute
  lastBatchLLMCallTime: number | null; // When the last batch LLM call was made
  isExecutingTrades: boolean; // Whether the trading round is active (true for entire round until time expires)
  isExecutingTradeBatch: boolean; // Whether a batch of trades is currently being executed (separate from round status)
  isMakingBatchLLMCall: boolean; // Whether a batch LLM call is currently in progress
  isLLMRateLimited: boolean; // Whether LLM API is rate limited for this round (skip LLM calls if true)
  // Note: isActive is computed in API responses based on roundEndTime (time-based only, not affected by API failures)
}

// Agent personality and memo
export interface AgentPersonality {
  name: string;
  riskTolerance: 'low' | 'medium' | 'high';
  aggressiveness: number; // 0-1
  memo: string;
  traits: string[];
}

// Trading strategy type
export type StrategyType = 'yes-no' | 'twap' | 'momentum' | 'mean-reversion';

// Agent holdings for a specific strategy token
export interface AgentTokenHoldings {
  strategyId: string;
  tokenType: 'yes' | 'no';
  quantity: number;
}

// Agent memory for current round
export interface AgentRoundMemory {
  action: 'buy' | 'sell' | 'hold';
  strategyId: string;
  tokenType: 'yes' | 'no';
  quantity: number;
  price: number;
  reasoning: string;
  timestamp: number;
}

// Agent interface
export interface Agent {
  id: string;
  personality: AgentPersonality;
  strategy: StrategyType; // Agent's trading strategy (not market strategy)
  vUSD: number; // Virtual USD balance (starts at 100)
  tokenHoldings: AgentTokenHoldings[]; // Holdings across all strategy tokens
  wallet: {
    address: string;     // Ethereum address
    derivationPath: string; // BIP-44 derivation path
  };
  trades: Array<{
    type: 'buy' | 'sell';
    strategyId: string;
    tokenType: 'yes' | 'no';
    price: number;
    quantity: number;
    timestamp: number;
    reasoning?: string; // Reasoning for the trade decision
    txHash?: string; // Blockchain transaction hash
  }>;
  roundMemory: AgentRoundMemory[]; // Memory of actions in current round
}


// Trade decision
export interface TradeDecision {
  agentId: string;
  action: 'buy' | 'sell' | 'hold';
  strategyId: string;
  tokenType: 'yes' | 'no';
  quantity: number;
  price: number;
  reasoning: string;
}

