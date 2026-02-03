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

    // Pool of 25 hardcoded strategies
    const strategyPool: Array<Omit<MarketStrategy, 'id' | 'timestamp' | 'resolutionDeadline' | 'yesToken' | 'noToken'>> = [
      {
        name: 'Tech & Crypto Rally',
        description: 'This strategy predicts a rally in the tech and crypto markets, with the S&P 500 exceeding 700 and Bitcoin ETF exceeding 50. This prediction matters as it signals a potential shift in investor sentiment towards riskier assets.',
        evaluationLogic: '(SPY > 700 AND IBIT > 50)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 50',
        usedDataSources: [
          { id: 12245, currentValue: 687.725, targetValue: 700, operator: '>' },
          { id: 12251, currentValue: 42.51, targetValue: 50, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Energy Sector Downturn',
        description: 'This strategy predicts a downturn in the energy sector, with WTI oil dropping below 60 and natural gas dropping below 3. This prediction matters as it signals a potential shift in investor sentiment towards safer assets.',
        evaluationLogic: '(WTI < 60 AND NG < 3)',
        mathematicalLogic: 'asset1_price < 60 AND asset2_price < 3',
        usedDataSources: [
          { id: 12288, currentValue: 62.91871, targetValue: 60, operator: '<' },
          { id: 12292, currentValue: 3.34076, targetValue: 3, operator: '<' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Broad Market Growth',
        description: 'This strategy predicts broad market growth, with the S&P 500 exceeding 700, the QQQ exceeding 550, and the VTI exceeding 300. This prediction matters as it signals a potential shift in investor sentiment towards riskier assets.',
        evaluationLogic: '(SPY > 700 AND QQQ > 550 AND VTI > 300)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 550 AND asset3_price > 300',
        usedDataSources: [
          { id: 12245, currentValue: 687.725, targetValue: 700, operator: '>' },
          { id: 12249, currentValue: 615.32, targetValue: 550, operator: '>' },
          { id: 12247, currentValue: 338.87, targetValue: 300, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Market Divergence',
        description: 'This strategy predicts market divergence, with either the QQQ exceeding 550 or the TLT exceeding 95. This prediction matters as it signals a potential shift in investor sentiment towards safer assets.',
        evaluationLogic: '(QQQ > 550 OR TLT > 95)',
        mathematicalLogic: 'asset1_price > 550 OR asset2_price > 95',
        usedDataSources: [
          { id: 12249, currentValue: 615.32, targetValue: 550, operator: '>' },
          { id: 12276, currentValue: 86.46, targetValue: 95, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Currency Fluctuation',
        description: 'This strategy predicts a fluctuation in the currency markets, with the Canadian dollar exceeding 0.735 and the Australian dollar exceeding 0.705. This prediction matters as it signals a potential shift in investor sentiment towards safer assets.',
        evaluationLogic: '(CAD > 0.735 AND AUD > 0.705)',
        mathematicalLogic: 'asset1_price > 0.735 AND asset2_price > 0.705',
        usedDataSources: [
          { id: 12283, currentValue: 0.7328154770628755, targetValue: 0.735, operator: '>' },
          { id: 12281, currentValue: 0.7011098569034783, targetValue: 0.705, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'S&P 500 Growth Strategy',
        description: 'This strategy predicts that the S&P 500 ETF Trust will exceed $700 in the next 30 days, indicating a strong market growth. The success of this strategy depends on the ability of the S&P 500 to maintain its current growth trend.',
        evaluationLogic: '(SPY > 700)',
        mathematicalLogic: 'asset_price > 700',
        usedDataSources: [
          { id: 12245, currentValue: 688.1, targetValue: 700, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Commodity Price Drop Strategy',
        description: 'This strategy predicts that the price of WTI crude oil will drop below $60 in the next 7 days, indicating a decrease in global demand. The success of this strategy depends on the ability of the global economy to reduce its reliance on fossil fuels.',
        evaluationLogic: '(WTI < 60)',
        mathematicalLogic: 'asset_price < 60',
        usedDataSources: [
          { id: 12288, currentValue: 63.19666, targetValue: 60, operator: '<' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Treasury Bond Yield Strategy',
        description: 'This strategy predicts that the price of the 20+ Year Treasury Bond ETF will exceed $90 in the next 60 days, indicating a decrease in interest rates. The success of this strategy depends on the ability of the Federal Reserve to maintain its current monetary policy.',
        evaluationLogic: '(TLT > 90)',
        mathematicalLogic: 'asset_price > 90',
        usedDataSources: [
          { id: 12276, currentValue: 86.465, targetValue: 90, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Bitcoin Price Surge Strategy',
        description: 'This strategy predicts that the price of the Bitcoin Trust will exceed $50 in the next 14 days, indicating a significant increase in demand for cryptocurrencies. The success of this strategy depends on the ability of Bitcoin to regain its momentum.',
        evaluationLogic: '(IBIT > 50)',
        mathematicalLogic: 'asset_price > 50',
        usedDataSources: [
          { id: 12251, currentValue: 42.505, targetValue: 50, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Vanguard S&P 500 ETF Growth Strategy',
        description: 'This strategy predicts that the price of the Vanguard S&P 500 ETF will exceed $650 in the next 45 days, indicating a strong market growth. The success of this strategy depends on the ability of the S&P 500 to maintain its current growth trend.',
        evaluationLogic: '(VOO > 650)',
        mathematicalLogic: 'asset_price > 650',
        usedDataSources: [
          { id: 12243, currentValue: 632.95, targetValue: 650, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Nasdaq Tech Momentum',
        description: 'This strategy predicts that the Nasdaq QQQ Trust will exceed $600, indicating strong tech sector momentum. The current market conditions suggest a potential uptrend in technology stocks.',
        evaluationLogic: '(QQQ > 600)',
        mathematicalLogic: 'asset_price > 600',
        usedDataSources: [
          { id: 12249, currentValue: 615.32, targetValue: 600, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Total Stock Market Growth',
        description: 'This strategy predicts that the Vanguard Total Stock Market ETF will exceed $350, indicating broad market strength across all sectors.',
        evaluationLogic: '(VTI > 350)',
        mathematicalLogic: 'asset_price > 350',
        usedDataSources: [
          { id: 12247, currentValue: 338.87, targetValue: 350, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Ethereum ETF Rally',
        description: 'This strategy predicts that the Ethereum ETF will exceed $45, indicating growing institutional interest in Ethereum alongside Bitcoin.',
        evaluationLogic: '(ETH > 45)',
        mathematicalLogic: 'asset_price > 45',
        usedDataSources: [
          { id: 12252, currentValue: 42.0, targetValue: 45, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Oil Price Recovery',
        description: 'This strategy predicts that WTI crude oil will exceed $70, indicating a recovery in energy demand and global economic activity.',
        evaluationLogic: '(WTI > 70)',
        mathematicalLogic: 'asset_price > 70',
        usedDataSources: [
          { id: 12288, currentValue: 62.91871, targetValue: 70, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Natural Gas Surge',
        description: 'This strategy predicts that natural gas will exceed $4, indicating increased demand for energy commodities.',
        evaluationLogic: '(NG > 4)',
        mathematicalLogic: 'asset_price > 4',
        usedDataSources: [
          { id: 12292, currentValue: 3.34076, targetValue: 4, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Tech & Bond Correlation',
        description: 'This strategy predicts that both tech stocks (QQQ) and bonds (TLT) will rise, indicating a risk-on environment with low volatility.',
        evaluationLogic: '(QQQ > 600 AND TLT > 90)',
        mathematicalLogic: 'asset1_price > 600 AND asset2_price > 90',
        usedDataSources: [
          { id: 12249, currentValue: 615.32, targetValue: 600, operator: '>' },
          { id: 12276, currentValue: 86.46, targetValue: 90, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Crypto Dual Rally',
        description: 'This strategy predicts that both Bitcoin and Ethereum ETFs will surge, indicating broad crypto market strength.',
        evaluationLogic: '(IBIT > 50 AND ETH > 45)',
        mathematicalLogic: 'asset1_price > 50 AND asset2_price > 45',
        usedDataSources: [
          { id: 12251, currentValue: 42.51, targetValue: 50, operator: '>' },
          { id: 12252, currentValue: 42.0, targetValue: 45, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Energy Sector Recovery',
        description: 'This strategy predicts that both oil and natural gas will rise, indicating a strong recovery in the energy sector.',
        evaluationLogic: '(WTI > 70 AND NG > 4)',
        mathematicalLogic: 'asset1_price > 70 AND asset2_price > 4',
        usedDataSources: [
          { id: 12288, currentValue: 62.91871, targetValue: 70, operator: '>' },
          { id: 12292, currentValue: 3.34076, targetValue: 4, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Market Breadth Expansion',
        description: 'This strategy predicts that multiple indices will rise together, indicating broad market participation and healthy market conditions.',
        evaluationLogic: '(SPY > 700 AND VOO > 650 AND VTI > 350)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 650 AND asset3_price > 350',
        usedDataSources: [
          { id: 12245, currentValue: 687.725, targetValue: 700, operator: '>' },
          { id: 12243, currentValue: 632.95, targetValue: 650, operator: '>' },
          { id: 12247, currentValue: 338.87, targetValue: 350, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Risk-On Environment',
        description: 'This strategy predicts that either tech stocks or crypto will surge, indicating investor appetite for riskier assets.',
        evaluationLogic: '(QQQ > 600 OR IBIT > 50)',
        mathematicalLogic: 'asset1_price > 600 OR asset2_price > 50',
        usedDataSources: [
          { id: 12249, currentValue: 615.32, targetValue: 600, operator: '>' },
          { id: 12251, currentValue: 42.51, targetValue: 50, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Flight to Safety',
        description: 'This strategy predicts that bonds will rise while stocks decline, indicating a flight to safety scenario.',
        evaluationLogic: '(TLT > 90 OR SPY < 650)',
        mathematicalLogic: 'asset1_price > 90 OR asset2_price < 650',
        usedDataSources: [
          { id: 12276, currentValue: 86.46, targetValue: 90, operator: '>' },
          { id: 12245, currentValue: 687.725, targetValue: 650, operator: '<' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Commodity Inflation Hedge',
        description: 'This strategy predicts that both oil and natural gas will rise, indicating inflationary pressures in energy markets.',
        evaluationLogic: '(WTI > 65 AND NG > 3.5)',
        mathematicalLogic: 'asset1_price > 65 AND asset2_price > 3.5',
        usedDataSources: [
          { id: 12288, currentValue: 62.91871, targetValue: 65, operator: '>' },
          { id: 12292, currentValue: 3.34076, targetValue: 3.5, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Currency Strength',
        description: 'This strategy predicts that both Canadian and Australian dollars will strengthen against USD, indicating commodity-driven currency strength.',
        evaluationLogic: '(CAD > 0.74 AND AUD > 0.71)',
        mathematicalLogic: 'asset1_price > 0.74 AND asset2_price > 0.71',
        usedDataSources: [
          { id: 12283, currentValue: 0.7328154770628755, targetValue: 0.74, operator: '>' },
          { id: 12281, currentValue: 0.7011098569034783, targetValue: 0.71, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Multi-Asset Bull Run',
        description: 'This strategy predicts simultaneous growth across stocks, crypto, and bonds, indicating an extremely bullish market environment.',
        evaluationLogic: '(SPY > 700 AND IBIT > 50 AND TLT > 88)',
        mathematicalLogic: 'asset1_price > 700 AND asset2_price > 50 AND asset3_price > 88',
        usedDataSources: [
          { id: 12245, currentValue: 687.725, targetValue: 700, operator: '>' },
          { id: 12251, currentValue: 42.51, targetValue: 50, operator: '>' },
          { id: 12276, currentValue: 86.46, targetValue: 88, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
      {
        name: 'Tech Sector Dominance',
        description: 'This strategy predicts that tech-heavy indices will outperform, indicating sector rotation towards technology.',
        evaluationLogic: '(QQQ > 620 AND VTI > 340)',
        mathematicalLogic: 'asset1_price > 620 AND asset2_price > 340',
        usedDataSources: [
          { id: 12249, currentValue: 615.32, targetValue: 620, operator: '>' },
          { id: 12247, currentValue: 338.87, targetValue: 340, operator: '>' }
        ],
        resolved: false,
        winner: null,
      },
    ];

    // Randomly select 5 strategies from the pool
    const selectedIndices: number[] = [];
    while (selectedIndices.length < 5) {
      const randomIndex = Math.floor(Math.random() * strategyPool.length);
      if (!selectedIndices.includes(randomIndex)) {
        selectedIndices.push(randomIndex);
      }
    }

    // Create strategies with timestamps and deadlines
    const timeLimits = [2, 7, 14, 30, 45, 60]; // Days
    strategies = selectedIndices.map((index, i) => {
      const template = strategyPool[index];
      if (!template) {
        throw new Error(`Strategy template at index ${index} not found`);
      }
      const timeLimitDays = timeLimits[i % timeLimits.length] || 30;
      
      return {
        id: `strategy-${i + 1}-${now}`,
        name: template.name,
        description: template.description,
        evaluationLogic: template.evaluationLogic,
        mathematicalLogic: template.mathematicalLogic,
        usedDataSources: template.usedDataSources,
        resolutionDeadline: now + (timeLimitDays * MS_PER_DAY),
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
      };
    });

    log('Market', `Selected ${strategies.length} strategies from pool of ${strategyPool.length}`);
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

