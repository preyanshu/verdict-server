import { ethers } from 'ethers';
import type { MarketState, MarketStrategy } from '../core/types';
import { log } from '../core/logger';
import { getYESPrice, getNOPrice } from './amm';
import { config } from '../core/config';

/**
 * Initialize market with LLM-generated strategies based on trusted data sources
 * Initial state: 2000 YES tokens and 2000 NO tokens (equal reserves = 0.5 price each)
 * Price of YES = NO tokens / (YES tokens + NO tokens) = 2000 / 4000 = 0.5
 * Price of NO = YES tokens / (YES tokens + NO tokens) = 2000 / 4000 = 0.5
 * YES + NO = 0.5 + 0.5 = 1.0 ✓
 */
/**
 * Initialize empty market state
 */
export function initializeMarket(): MarketState {
  const now = Date.now();
  return {
    strategies: [],
    timestamp: now,
    roundNumber: 0,
    roundStartTime: 0, // Not started yet
    roundEndTime: 0, // Not started yet
    roundDuration: config.market.roundDuration,
    roundsUntilResolution: 1, // Single round before resolution
    lastRoundEndTime: null, // No previous round ended yet
    tradeQueue: [], // Empty trade queue
    lastBatchLLMCallTime: null, // No batch LLM call made yet
    isExecutingTrades: false, // Not executing trades initially
    isMakingBatchLLMCall: false, // No batch LLM call in progress initially
  };
}

/**
 * Generate strategies using LLM or fallbacks and set them in marketState
 */
export async function generateAndSetStrategies(marketState: MarketState): Promise<void> {
  const initialTokenReserve = 2000;
  let strategies: MarketStrategy[] = [];

  try {
    const llmModule = await import('../llm');
    if (llmModule.generateStrategiesFromDataSources) {
      strategies = await llmModule.generateStrategiesFromDataSources(5);
    }
  } catch (error) {
    log('Market', `LLM generation failed, proceeding with fallbacks: ${error instanceof Error ? error.message : error}`, 'warn');
  }

  if (strategies.length === 0) {
    log('Market', 'LLM strategy generation unavailable, initializing default strategies');
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    strategies = [
      {
        id: `strategy-1-${now}`,
        name: 'S&P 500 Index Growth',
        description: 'S&P 500 price exceeds $700',
        evaluationLogic: 'SPY > 700',
        mathematicalLogic: 'price > 700',
        usedDataSources: [
          {
            id: 12245,
            currentValue: 693.99,
            targetValue: 700,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (30 * MS_PER_DAY),
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        timestamp: now,
        resolved: false,
        winner: null,
      },
      {
        id: `strategy-2-${now}`,
        name: 'Oil Price Surge',
        description: 'Crude Oil (WTI) price exceeds $70',
        evaluationLogic: 'WTI > 70',
        mathematicalLogic: 'price > 70',
        usedDataSources: [
          {
            id: 12288,
            currentValue: 58.78,
            targetValue: 70,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (15 * MS_PER_DAY),
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        timestamp: now,
        resolved: false,
        winner: null,
      },
      {
        id: `strategy-3-${now}`,
        name: 'Bitcoin ETF Stability',
        description: 'iShares Bitcoin Trust (IBIT) stays above $50',
        evaluationLogic: 'IBIT >= 50',
        mathematicalLogic: 'price >= 50',
        usedDataSources: [
          {
            id: 12251,
            currentValue: 51.17,
            targetValue: 50,
            operator: '>='
          }
        ],
        resolutionDeadline: now + (7 * MS_PER_DAY),
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        timestamp: now,
        resolved: false,
        winner: null,
      },
      {
        id: `strategy-4-${now}`,
        name: 'Nasdaq Momentum',
        description: 'QQQ Trust Invesco exceeds $650',
        evaluationLogic: 'QQQ > 650',
        mathematicalLogic: 'price > 650',
        usedDataSources: [
          {
            id: 12249,
            currentValue: 626.66,
            targetValue: 650,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (30 * MS_PER_DAY),
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        timestamp: now,
        resolved: false,
        winner: null,
      },
      {
        id: `strategy-5-${now}`,
        name: 'Natural Gas Recovery',
        description: 'Natural Gas (NG) price stays above $3',
        evaluationLogic: 'NG > 3.0',
        mathematicalLogic: 'price > 3.0',
        usedDataSources: [
          {
            id: 12292,
            currentValue: 3.17,
            targetValue: 3.0,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (10 * MS_PER_DAY),
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: now }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: now }],
        },
        timestamp: now,
        resolved: false,
        winner: null,
      },
    ];
  }

  // Register proposals on-chain FIRST (before adding to memory)
  log('Market', `Registering ${strategies.length} proposals on blockchain via atomic batch transaction`);
  try {
    const blockchain = await import('../blockchain') as any;
    const { config } = await import('../core/config');
    const durationSeconds = Math.floor(marketState.roundDuration / 1000);
    const result = await blockchain.initializeMarketWithProposalsBatch(durationSeconds, strategies);

    if (!result.success) {
      log('Market', 'Atomic batch initialization failed on-chain', 'error');
      throw new Error('Failed to create proposals on-chain');
    }

    log('Market', `Successfully registered ${strategies.length} proposals on blockchain`);
    result.txHashes.forEach((hash: string) => {
      log('Market', `Transaction confirmed: ${config.blockchain.blockExplorerUrl}/tx/${hash}`, 'debug');
    });

    // Only add to memory AFTER blockchain operation succeeds
    marketState.strategies = strategies;
    marketState.timestamp = Date.now();
    marketState.roundStartTime = 0;
    marketState.roundEndTime = 0;
  } catch (error) {
    log('Market', `On-chain registration failed: ${error instanceof Error ? error.message : error}`, 'error');
    marketState.strategies = [];
    throw error; // Re-throw to let caller know it failed
  }
}

/**
 * Reconstruct active market state from on-chain data
 * NOTE: This syncs proposals but NOT round timing (server-side only)
 */
export async function syncActiveMarketFromChain(marketState: MarketState): Promise<void> {
  const { getProposalStatus, getRouter } = await import('../blockchain');
  const router = getRouter();
  
  // Get round info but only use it for proposal IDs, not timing
  // NOTE: We do NOT sync roundStartTime, roundEndTime, or roundDuration (server-side only)
  let info;
  try {
    info = await router.getRoundInfo();
  } catch (e) {
    log('Market', `Failed to fetch round info: ${e}`, 'warn');
    return;
  }

  if (info && info.active && info.proposalIds && info.proposalIds.length > 0) {
    log('Market', `Syncing ${info.proposalIds.length} active proposals from chain...`);

    const strategies: MarketStrategy[] = [];
    const now = Date.now();

    for (const id of info.proposalIds) {
      try {
        const p = await getProposalStatus(id);
        strategies.push({
          id: p.id || id,
          name: p.name,
          description: p.description,
          evaluationLogic: p.evaluationLogic,
          mathematicalLogic: p.mathematicalLogic,
          usedDataSources: [], // Data sources are not stored on-chain in detail
          resolutionDeadline: Number(p.resolutionDeadline) * 1000,
          timestamp: now,
          resolved: p.resolved,
          winner: p.resolved ? (p.isWinner ? 'yes' : 'no') : null,
          yesToken: {
            tokenReserve: 0, // Will be synced by syncReservesFromChain
            volume: 0,
            history: [],
            twap: parseFloat(ethers.formatUnits(p.yesTWAP || 0, 18)),
            twapHistory: []
          },
          noToken: {
            tokenReserve: 0,
            volume: 0,
            history: [],
            twap: 1 - parseFloat(ethers.formatUnits(p.yesTWAP || 0, 18)),
            twapHistory: []
          }
        });
      } catch (e) {
        log('Market', `Failed to fetch proposal ${id}: ${e}`, 'warn');
      }
    }

    // This function is no longer used - we generate strategies fresh via /api/admin/init
    log('Market', 'Note: syncActiveMarketFromChain is deprecated - use /api/admin/init instead', 'warn');
  }
}

/**
 * Reset strategies for a new round
 */
export function resetStrategiesForNewRound(marketState: MarketState): void {
  for (const strategy of marketState.strategies) {
    strategy.resolved = false;
    strategy.winner = null;
    // Keep price history and TWAP, but reset resolution status
  }
}

/**
 * Sync in-memory market state with on-chain round data
 */
/**
 * Sync in-memory market state with on-chain data
 */
export async function syncReservesFromChain(marketState: MarketState): Promise<void> {
  const { getPoolReserves } = await import('../blockchain');

  // Loop through all strategies and update reserves
  for (const strategy of marketState.strategies) {
    const { getRouter } = await import('../blockchain');
    const router = getRouter();

    // Fetch reserves and proposal status
    const [reserves, status] = await Promise.all([
      router.getPoolReserves(strategy.id),
      router.getProposalStatus(strategy.id)
    ]);

    // Update resolution status from chain
    if (status && status.resolved !== undefined) {
      if (status.resolved && !strategy.resolved) {
        log('Market', `Sync: Strategy "${strategy.name}" has been resolved on-chain`);
      }
      strategy.resolved = status.resolved;
      if (status.resolved) {
        strategy.winner = status.isWinner ? 'yes' : 'no';
      }
    }

    const vUSDC = parseFloat(ethers.formatUnits(reserves.vUSDCReserve, 18));
    const yes = parseFloat(ethers.formatUnits(reserves.yesReserve, 18));

    // On-chain: reserves.yes = YES tokens, reserves.vUSDC = vUSDC tokens
    if (yes > 0 || vUSDC > 0) {
      strategy.yesToken.tokenReserve = yes;
      strategy.noToken.tokenReserve = vUSDC;

      // Update price history from chain directly for better accuracy
      const { getYESPriceFromChain } = await import('../blockchain');
      const currentYesPrice = await getYESPriceFromChain(strategy.id);
      const currentNoPrice = 1 - currentYesPrice;
      const now = Date.now();

      strategy.yesToken.history.push({ price: currentYesPrice, timestamp: now });
      strategy.noToken.history.push({ price: currentNoPrice, timestamp: now });

      // Keep history to last 100 points
      if (strategy.yesToken.history.length > 100) strategy.yesToken.history.shift();
      if (strategy.noToken.history.length > 100) strategy.noToken.history.shift();
    }
  }
}

/**
 * Update market state (no random price changes - AMM handles pricing)
 */
export async function updateMarketPrice(marketState: MarketState): Promise<void> {
  // Sync reserves from blockchain (Single Source of Truth for liquidity)
  // NOTE: Round timing is managed server-side, not synced from blockchain
  await syncReservesFromChain(marketState);

  // Update TWAPs for all strategies
  for (const strategy of marketState.strategies) {
    if (!strategy.resolved) {
      // TWAP updates happen in resolveAllStrategies
    }

    strategy.timestamp = Date.now();
  }

  marketState.timestamp = Date.now();
}

