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
 */
export function selectStrategyForAgent(agent: Agent, market: MarketState): MarketStrategy | null {
  // Simple selection: agents can trade on any strategy
  // For now, randomly select or use agent's preference
  if (market.strategies.length === 0) return null;

  // Agents with yes-no strategy prefer certain strategies based on their personality
  const strategyIndex = agent.id.charCodeAt(agent.id.length - 1) % market.strategies.length;
  const strategy = market.strategies[strategyIndex];
  return strategy ?? null;
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
        name: 'Bullish Bob',
        riskTolerance: 'high',
        aggressiveness: 0.8,
        memo: 'Always optimistic. Believes in long-term growth and buys on any dip.',
        traits: ['optimistic', 'risk-taker', 'trend-follower'],
      },
      {
        name: 'TWAP Tina',
        riskTolerance: 'medium',
        aggressiveness: 0.5,
        memo: 'Patient trader using Time-Weighted Average Price. Splits orders over time to minimize market impact.',
        traits: ['patient', 'systematic', 'risk-aware'],
      },
      {
        name: 'Momentum Max',
        riskTolerance: 'high',
        aggressiveness: 0.9,
        memo: 'Rides the wave! Follows strong trends and jumps on momentum. Quick to enter and exit.',
        traits: ['impulsive', 'trend-chaser', 'volatile'],
      },
      {
        name: 'Mean Reversion Mary',
        riskTolerance: 'low',
        aggressiveness: 0.3,
        memo: 'Believes prices return to mean. Buys low, sells high. Contrarian approach.',
        traits: ['contrarian', 'cautious', 'value-oriented'],
      },
    ];
  }

  personalities.forEach((personality, index) => {
    // Derive wallet for this agent from master seed
    const wallet = deriveWallet(index);

    log('Agents', `Configuration complete: ${personality.name} (${wallet.address})`);

    agents.push({
      id: `agent-${index + 1}`,
      personality,
      strategy: 'yes-no' as const,
      vUSD: 100,
      tokenHoldings: [],
      wallet,
      trades: [],
      roundMemory: [],
    });
  });

  log('Agents', `${agents.length} agent identities derived from master seed`);

  // Register agents on-chain (ALL OR NOTHING with nonce management)
  log('Agents', 'Synchronizing agent identities with blockchain...');
  try {
    const blockchain = await import('../blockchain') as any;
    const { config } = await import('../core/config');

    const txHashes = await blockchain.registerAllAgents(agents);

    // If we get here but agents is empty, registration failed
    if (agents.length === 0) {
      throw new Error('On-chain identity synchronization failed');
    }

    log('Agents', `Successfully synchronized ${agents.length} agent identities with blockchain`);
    txHashes.forEach((hash: string) => {
      log('Agents', `Synchronization confirmed: ${config.blockchain.blockExplorerUrl}/tx/${hash}`, 'debug');
    });
  } catch (error) {
    log('Agents', `On-chain identity synchronization failed: ${error instanceof Error ? error.message : error}`, 'error');
    agents.length = 0;
  }
}
