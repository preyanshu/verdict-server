import { ethers } from 'ethers';
import type { Agent, AgentTokenHoldings, MarketStrategy, MarketState } from '../core/types';
import { log } from '../core/logger';
import { config } from '../core/config';

/**
 * Derive an Ethereum wallet from the master seed using BIP-44 path
 * Path format: m/44'/60'/0'/0/{index}
 * - 44' = BIP-44 standard
 * - 60' = Ethereum coin type
 * - 0' = account
 * - 0 = external chain
 * - {index} = address index
 */
/**
 * Derive an Ethereum wallet address from the master seed using BIP-44 path
 */
function deriveWallet(index: number): { address: string; derivationPath: string } {
  const derivationPath = `m/44'/60'/0'/0/${index}`;

  // Create HD wallet from mnemonic to get the address
  const hdNode = ethers.HDNodeWallet.fromPhrase(
    config.blockchain.masterSeed,
    undefined,
    derivationPath
  );

  return {
    address: hdNode.address,
    derivationPath,
  };
}

/**
 * Get an ethers Signer (Wallet) for an agent on-the-fly
 * This ensures private keys are not stored in memory long-term
 */
export function getAgentSigner(agent: Agent, provider?: ethers.Provider): ethers.HDNodeWallet {
  const wallet = ethers.HDNodeWallet.fromPhrase(
    config.blockchain.masterSeed,
    undefined,
    agent.wallet.derivationPath
  );

  return provider ? wallet.connect(provider) : wallet;
}

/**
 * Helper function to get agent's holdings for a specific token
 */
export function getAgentTokenHoldings(agent: Agent, strategyId: string, tokenType: 'yes' | 'no'): number {
  const holding = agent.tokenHoldings.find(
    h => h.strategyId === strategyId && h.tokenType === tokenType
  );
  return holding?.quantity || 0;
}

/**
 * Helper function to update agent's token holdings
 */
export function updateAgentTokenHoldings(
  agent: Agent,
  strategyId: string,
  tokenType: 'yes' | 'no',
  quantityChange: number
): void {
  const existing = agent.tokenHoldings.find(
    h => h.strategyId === strategyId && h.tokenType === tokenType
  );

  if (existing) {
    existing.quantity += quantityChange;
    if (existing.quantity <= 0) {
      agent.tokenHoldings = agent.tokenHoldings.filter(
        h => !(h.strategyId === strategyId && h.tokenType === tokenType)
      );
    }
  } else if (quantityChange > 0) {
    agent.tokenHoldings.push({
      strategyId,
      tokenType,
      quantity: quantityChange,
    });
  }
}

/**
 * Helper function to select a strategy for an agent to trade on
 * Randomly selects from unresolved strategies to ensure all proposals get trading activity
 */
export function selectStrategyForAgent(agent: Agent, market: MarketState): MarketStrategy | null {
  // Filter to only unresolved strategies
  const availableStrategies = market.strategies.filter(s => !s.resolved);
  
  if (availableStrategies.length === 0) return null;

  // Randomly select a strategy (ensures all proposals get trading activity)
  const randomIndex = Math.floor(Math.random() * availableStrategies.length);
  const selected = availableStrategies[randomIndex];
  return selected || null;
}

/**
 * Initialize empty agents array
 */
export function initializeAgents(): Agent[] {
  return [];
}

/**
 * Get all agent wallet addresses (for registering with smart contract)
 */
export function getAgentWalletAddresses(agents: Agent[]): string[] {
  return agents.map(agent => agent.wallet.address);
}

/**
 * Generate agents and populate the agents array with derived wallets
 */
export async function generateAndSetAgents(agents: Agent[]): Promise<void> {
  // Clear existing agents if any
  agents.length = 0;

  let personalities: Array<{
    name: string;
    riskTolerance: 'low' | 'medium' | 'high';
    aggressiveness: number;
    memo: string;
    traits: string[];
  }> = [];

  try {
    const { generateAgentPersonalities } = await import('../llm');
    personalities = await generateAgentPersonalities(4);
  } catch (error) {
    log('Agents', `LLM personality generation unavailable, proceeding with fallbacks: ${error instanceof Error ? error.message : error}`, 'warn');
  }

  if (personalities.length === 0) {
    log('Agents', 'Initializing default agent personalities');
    personalities = [
      {
        name: 'Sarah Chen',
        riskTolerance: 'high',
        aggressiveness: 0.8,
        memo: 'I believe in long-term growth and market resilience. I buy on dips and hold through volatility, focusing on fundamental value.',
        traits: ['optimistic', 'risk-taker', 'trend-follower'],
      },
      {
        name: 'Michael Rodriguez',
        riskTolerance: 'medium',
        aggressiveness: 0.5,
        memo: 'I use systematic approaches and time-weighted strategies to minimize market impact. Patience and discipline guide my decisions.',
        traits: ['patient', 'systematic', 'risk-aware'],
      },
      {
        name: 'Priya Patel',
        riskTolerance: 'high',
        aggressiveness: 0.9,
        memo: 'I follow momentum and trends closely. When I see strong signals, I act quickly to capitalize on market movements.',
        traits: ['impulsive', 'trend-chaser', 'volatile'],
      },
      {
        name: 'James Wilson',
        riskTolerance: 'low',
        aggressiveness: 0.3,
        memo: 'I believe markets revert to mean values. I buy when prices are low and sell when they peak, using a contrarian approach.',
        traits: ['contrarian', 'cautious', 'value-oriented'],
      },
    ];
  }

  // Prepare agent objects (but don't add to array yet)
  const agentObjects = personalities.map((personality, index) => {
    // Derive wallet for this agent from master seed
    const wallet = deriveWallet(index);

    return {
      id: `agent-${index + 1}`,
      personality,
      strategy: 'yes-no' as const,
      vUSD: 100,
      tokenHoldings: [],
      wallet,
      trades: [],
      roundMemory: [],
    };
  });

  log('Agents', `${agentObjects.length} agent identities prepared`);

  // Register agents on-chain FIRST using batch function (atomic - all or nothing)
  log('Agents', 'Synchronizing agent identities with blockchain via batch registration...');
  try {
    const blockchain = await import('../blockchain') as any;
    const { config } = await import('../core/config');

    // Extract agent addresses for batch registration
    const agentAddresses = agentObjects.map(agent => agent.wallet.address);

    // Register all agents in one atomic batch transaction
    const result = await blockchain.registerAllAgentsBatch(agentAddresses);

    if (!result.success) {
      throw new Error('Batch agent registration failed on-chain');
    }

    log('Agents', `Successfully synchronized ${agentObjects.length} agent identities with blockchain`);
    if (result.txHash) {
      log('Agents', `Batch registration confirmed: ${config.blockchain.blockExplorerUrl}/tx/${result.txHash}`, 'debug');
    }

    // Only add to memory AFTER blockchain operation succeeds
    agents.length = 0;
    agentObjects.forEach((agent) => {
      log('Agents', `Configuration complete: ${agent.personality.name} (${agent.wallet.address})`);
      agents.push(agent);
    });

    log('Agents', `${agents.length} agent identities added to memory`);
  } catch (error) {
    log('Agents', `On-chain identity synchronization failed: ${error instanceof Error ? error.message : error}`, 'error');
    agents.length = 0;
    throw error; // Re-throw to let caller know it failed
  }
}
