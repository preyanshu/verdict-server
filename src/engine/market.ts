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
    isExecutingTradeBatch: false, // Not executing a trade batch initially
    isMakingBatchLLMCall: false, // No batch LLM call in progress initially
    isLLMRateLimited: false, // LLM API is not rate limited initially
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
        name: 'Tech & Crypto Rally',
        description: 'This strategy predicts a rally in the tech and crypto markets, with the S&P 500 exceeding 700 and Bitcoin ETF exceeding 50. This prediction matters as it signals a potential shift in investor sentiment towards riskier assets. The current market conditions, with the S&P 500 at 687.725 and Bitcoin ETF at 42.51, suggest a potential uptrend.',
        evaluationLogic: '(SPY > 700 AND IBIT > 50)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 50',
        usedDataSources: [
          {
            id: 12245,
            currentValue: 687.725,
            targetValue: 700,
            operator: '>'
          },
          {
            id: 12251,
            currentValue: 42.51,
            targetValue: 50,
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
        name: 'Energy Sector Downturn',
        description: 'This strategy predicts a downturn in the energy sector, with WTI oil dropping below 60 and natural gas dropping below 3. This prediction matters as it signals a potential shift in investor sentiment towards safer assets. The current market conditions, with WTI oil at 62.91871 and natural gas at 3.34076, suggest a potential downtrend.',
        evaluationLogic: '(WTI < 60 AND NG < 3)',
        mathematicalLogic: 'asset1_price < 60 AND asset2_price < 3',
        usedDataSources: [
          {
            id: 12288,
            currentValue: 62.91871,
            targetValue: 60,
            operator: '<'
          },
          {
            id: 12292,
            currentValue: 3.34076,
            targetValue: 3,
            operator: '<'
          }
        ],
        resolutionDeadline: now + (14 * MS_PER_DAY),
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
        name: 'Broad Market Growth',
        description: 'This strategy predicts broad market growth, with the S&P 500 exceeding 700, the QQQ exceeding 550, and the VTI exceeding 300. This prediction matters as it signals a potential shift in investor sentiment towards riskier assets. The current market conditions, with the S&P 500 at 687.725, the QQQ at 615.32, and the VTI at 338.87, suggest a potential uptrend.',
        evaluationLogic: '(SPY > 700 AND QQQ > 550 AND VTI > 300)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 550 AND asset3_price > 300',
        usedDataSources: [
          {
            id: 12245,
            currentValue: 687.725,
            targetValue: 700,
            operator: '>'
          },
          {
            id: 12249,
            currentValue: 615.32,
            targetValue: 550,
            operator: '>'
          },
          {
            id: 12247,
            currentValue: 338.87,
            targetValue: 300,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (60 * MS_PER_DAY),
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
        name: 'Market Divergence',
        description: 'This strategy predicts market divergence, with either the QQQ exceeding 550 or the TLT exceeding 95. This prediction matters as it signals a potential shift in investor sentiment towards safer assets. The current market conditions, with the QQQ at 615.32 and the TLT at 86.46, suggest a potential uptrend.',
        evaluationLogic: '(QQQ > 550 OR TLT > 95)',
        mathematicalLogic: 'asset1_price > 550 OR asset2_price > 95',
        usedDataSources: [
          {
            id: 12249,
            currentValue: 615.32,
            targetValue: 550,
            operator: '>'
          },
          {
            id: 12276,
            currentValue: 86.46,
            targetValue: 95,
            operator: '>'
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
        id: `strategy-5-${now}`,
        name: 'Currency Fluctuation',
        description: 'This strategy predicts a fluctuation in the currency markets, with the Canadian dollar exceeding 0.735 and the Australian dollar exceeding 0.705. This prediction matters as it signals a potential shift in investor sentiment towards safer assets. The current market conditions, with the Canadian dollar at 0.7328154770628755 and the Australian dollar at 0.7011098569034783, suggest a potential uptrend.',
        evaluationLogic: '(CAD > 0.735 AND AUD > 0.705)',
        mathematicalLogic: 'asset1_price > 0.735 AND asset2_price > 0.705',
        usedDataSources: [
          {
            id: 12283,
            currentValue: 0.7328154770628755,
            targetValue: 0.735,
            operator: '>'
          },
          {
            id: 12281,
            currentValue: 0.7011098569034783,
            targetValue: 0.705,
            operator: '>'
          }
        ],
        resolutionDeadline: now + (2 * MS_PER_DAY),
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

    // Fetch reserves only - don't sync resolution status from chain
    // Resolution is determined server-side when round ends
    // Only graduated proposals (via getGraduatedProposals()) matter for history
    const reserves = await router.getPoolReserves(strategy.id);

    const vUSDC = parseFloat(ethers.formatUnits(reserves.vUSDCReserve, 18));
    const yes = parseFloat(ethers.formatUnits(reserves.yesReserve, 18));

    // On-chain: reserves.yes = YES tokens, reserves.vUSDC = vUSDC tokens
    // Note: In the backend, we store:
    // - yesToken.tokenReserve = YES tokens (from contract's reserveB)
    // - noToken.tokenReserve = vUSDC tokens (from contract's reserveA)
    // This matches the contract's pool structure where:
    // - reserveA = vUSDC
    // - reserveB = YES tokens
    if (yes > 0 || vUSDC > 0) {
      strategy.yesToken.tokenReserve = yes;  // YES tokens (contract's reserveB)
      strategy.noToken.tokenReserve = vUSDC;  // vUSDC (contract's reserveA, stored as "noToken" for compatibility)

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

