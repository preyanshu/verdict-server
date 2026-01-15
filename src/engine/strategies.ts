import type { Agent, MarketState, MarketStrategy, TradeDecision } from '../core/types';
import { getYESPrice, getNOPrice, calculateYESForVUSD, calculateNOForVUSD } from './amm';
import { getAgentTokenHoldings, selectStrategyForAgent } from '../agents';
import { callLLMForYesNoStrategy } from '../llm';

/**
 * Fallback yes-no strategy
 * Note: agent.vUSD is synced from blockchain before this function is called (in processTradingRound)
 */
export function executeYesNoStrategyFallback(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): TradeDecision {
  const { personality } = agent;
  // Get YES price
  const yesPrice = getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);

  // We strictly trade YES tokens.
  const tokenType = 'yes';
  const tokenHistory = marketStrategy.yesToken.history;
  const holdings = getAgentTokenHoldings(agent, marketStrategy.id, 'yes');
  
  // agent.vUSD contains the current blockchain balance (synced in processTradingRound)

  const avgPrice = tokenHistory.length > 0
    ? tokenHistory.reduce((sum, h) => sum + h.price, 0) / tokenHistory.length
    : yesPrice;

  // Strategy: Buy if YES price is below average (undervalued)
  // Sell if YES price is above average (overvalued)
  // Kickstart: Buy if we have no holdings and price is reasonable
  const priceThreshold = tokenHistory.length < 5 ? 1.01 : 0.99;
  const shouldBuy = (holdings === 0 && yesPrice < 0.55) || yesPrice < avgPrice * priceThreshold;
  const shouldSell = yesPrice > avgPrice * 1.01 && holdings > 0;

  if (shouldBuy && agent.vUSD > 0) {
    const vUSDToSpend = agent.vUSD * personality.aggressiveness;
    // Calculate YES tokens we can buy
    const quantity = Math.floor(calculateYESForVUSD(
      vUSDToSpend,
      marketStrategy.yesToken.tokenReserve,
      marketStrategy.noToken.tokenReserve
    ));

    return {
      agentId: agent.id,
      action: 'buy',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm buying YES tokens for ${marketStrategy.name} because the current price of ${yesPrice.toFixed(4)} is below the average price of ${avgPrice.toFixed(4)}, indicating an undervalued opportunity. Based on my analysis, this represents a favorable entry point that aligns with my trading approach. ${personality.memo}`,
    };
  }

  if (shouldSell && holdings > 0) {
    const quantity = Math.floor(holdings * personality.aggressiveness);
    return {
      agentId: agent.id,
      action: 'sell',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm taking profits on ${marketStrategy.name} YES tokens at ${yesPrice.toFixed(4)}, which is above the average price of ${avgPrice.toFixed(4)}. This price action suggests the position has reached an overvalued level relative to historical patterns, making it an appropriate time to realize gains. ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `I'm maintaining my current position on ${marketStrategy.name}. The current price of ${yesPrice.toFixed(4)} is near the average price of ${avgPrice.toFixed(4)}, indicating neither a clear buying nor selling opportunity. I'll wait for more favorable market conditions before adjusting my position. ${personality.memo}`,
  };
}

/**
 * Execute yes-no strategy with LLM API call and fallback
 */
export async function executeYesNoStrategy(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): Promise<TradeDecision> {
  // Skip individual LLM calls - batch processing handles all yes-no agents together
  // Individual calls cause rate limiting issues when batch is already being used
  console.log(`[Strategy] ${agent.personality.name} using fallback strategy (batch processing handles LLM)`);
  return executeYesNoStrategyFallback(agent, market, marketStrategy);
}

/**
 * Execute TWAP strategy
 */
export function executeTWAPStrategy(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): TradeDecision {
  const { personality } = agent;
  const yesPrice = getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);
  const yesTWAP = marketStrategy.yesToken.twap;

  // Calculate deviation for YES token
  const deviation = yesTWAP > 0 ? (yesPrice - yesTWAP) / yesTWAP : 0;
  const holdings = getAgentTokenHoldings(agent, marketStrategy.id, 'yes');

  // Buy if Price < TWAP (Negative deviation means Price < TWAP? No. 
  // (Price - TWAP)/TWAP. If Price < TWAP, numerator is negative. So deviation < 0 is Buy signal (Undervalued)).

  const deviationThreshold = marketStrategy.yesToken.history.length < 5 ? 0.001 : 0.01;

  // Bullish Loop (Buy YES)
  if (deviation < -deviationThreshold && agent.vUSD > 0) {
    const vUSDToSpend = agent.vUSD * personality.aggressiveness * 0.5;
    const quantity = Math.floor(calculateYESForVUSD(
      vUSDToSpend,
      marketStrategy.yesToken.tokenReserve,
      marketStrategy.noToken.tokenReserve
    ));
    if (quantity > 0) {
      return {
        agentId: agent.id,
        action: 'buy',
        strategyId: marketStrategy.id,
        tokenType: 'yes',
        quantity,
        price: yesPrice,
        reasoning: `I'm buying YES tokens because the current price of ${yesPrice.toFixed(4)} is below the Time-Weighted Average Price (TWAP) of ${yesTWAP.toFixed(4)}, indicating the asset is undervalued relative to recent trading patterns. This deviation presents a favorable entry opportunity that aligns with my systematic trading approach. ${personality.memo}`,
      };
    }
  }

  // Bearish Loop (Sell YES)
  if (deviation > deviationThreshold && holdings > 0) {
    const quantity = Math.floor(holdings * personality.aggressiveness * 0.5);
    if (quantity > 0) {
      return {
        agentId: agent.id,
        action: 'sell',
        strategyId: marketStrategy.id,
        tokenType: 'yes',
        quantity,
        price: yesPrice,
        reasoning: `I'm selling YES tokens to realize profits as the current price of ${yesPrice.toFixed(4)} exceeds the Time-Weighted Average Price (TWAP) of ${yesTWAP.toFixed(4)}. This positive deviation suggests the position has appreciated beyond its recent average, making this an appropriate time to take gains according to my systematic trading methodology. ${personality.memo}`,
      };
    }
  }

  // Initial kickstart
  if (marketStrategy.yesToken.history.length < 3 && agent.vUSD > 0 && Math.abs(deviation) < 0.001) {
    const vUSDToSpend = agent.vUSD * personality.aggressiveness * 0.2;
    const quantity = Math.floor(calculateYESForVUSD(vUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
    if (quantity > 0) {
      return {
        agentId: agent.id,
        action: 'buy',
        strategyId: marketStrategy.id,
        tokenType: 'yes',
        quantity,
        price: yesPrice,
        reasoning: `I'm making an initial trade to establish a position in this market. With limited historical data available, I'm entering the market to begin building my position and gather more information about price dynamics. ${personality.memo}`,
      };
    }
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `I'm maintaining my current position as the YES token price of ${yesPrice.toFixed(4)} is closely aligned with the Time-Weighted Average Price (TWAP) of ${yesTWAP.toFixed(4)}. The minimal deviation suggests the market is fairly valued, so I'll wait for a clearer signal before adjusting my position. ${personality.memo}`,
  };
}

/**
 * Execute momentum strategy
 */
export function executeMomentumStrategy(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): TradeDecision {
  const { personality } = agent;
  const yesPrice = getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);
  const yesHistory = marketStrategy.yesToken.history.slice(-5);

  // Initial / Kickstart logic
  if (yesHistory.length < 2) {
    if (agent.vUSD > 0) {
      // Just buy YES to start momentum
      const vUSDToSpend = agent.vUSD * personality.aggressiveness * 0.3;
      const quantity = Math.floor(calculateYESForVUSD(vUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
      if (quantity > 0) {
        return {
          agentId: agent.id,
          action: 'buy',
          strategyId: marketStrategy.id,
          tokenType: 'yes',
          quantity,
          price: yesPrice,
          reasoning: `I'm making an initial momentum trade on YES tokens to establish a position. With limited price history available, I'm entering the market to begin tracking momentum patterns and build my trading position. ${personality.memo}`,
        };
      }
    }
    return {
      agentId: agent.id,
      action: 'hold',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity: 0,
      price: yesPrice,
      reasoning: `I'm holding my position as I need more historical price data to accurately assess momentum trends. Without sufficient data points, I cannot confidently determine the direction and strength of price movements, so I'll wait for more market activity before making a trading decision.`,
    };
  }

  const yesLast = yesHistory[yesHistory.length - 1];
  const yesFirst = yesHistory[0];

  if (!yesLast || !yesFirst) {
    return { agentId: agent.id, action: 'hold', strategyId: marketStrategy.id, tokenType: 'yes', quantity: 0, price: yesPrice, reasoning: 'Insufficient data' };
  }

  const momentum = (yesLast.price - yesFirst.price) / yesFirst.price;
  const holdings = getAgentTokenHoldings(agent, marketStrategy.id, 'yes');

  // Strong upward momentum -> buy YES
  if (momentum > 0.02 && agent.vUSD > 0) {
    const vUSDToSpend = agent.vUSD * personality.aggressiveness;
    const quantity = Math.floor(calculateYESForVUSD(vUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
    return {
      agentId: agent.id,
      action: 'buy',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm buying YES tokens because I've detected strong upward momentum of ${(momentum * 100).toFixed(2)}% in the price action. This positive momentum indicates a favorable trend that aligns with my trading strategy of following market movements. I'm capitalizing on this trend to position myself for potential gains. ${personality.memo}`,
    };
  }

  // Strong downward momentum -> sell YES
  if (momentum < -0.02 && holdings > 0) {
    const quantity = Math.floor(holdings * personality.aggressiveness);
    return {
      agentId: agent.id,
      action: 'sell',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm selling YES tokens because I've detected downward momentum of ${(momentum * 100).toFixed(2)}% in the price action. This negative momentum suggests a weakening trend, so I'm reducing my exposure to protect my capital and potentially re-enter at more favorable levels. ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `I'm maintaining my current position as there's no clear momentum signal in the market. The price movements are insufficient to indicate a strong directional trend, so I'll wait for more definitive momentum before adjusting my position. ${personality.memo}`,
  };
}

/**
 * Execute mean reversion strategy
 */
export function executeMeanReversionStrategy(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): TradeDecision {
  const { personality } = agent;
  const yesPrice = getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);
  const yesPrices = marketStrategy.yesToken.history.map(h => h.price);

  if (yesPrices.length < 3) {
    if (agent.vUSD > 0) {
      const vUSDToSpend = agent.vUSD * personality.aggressiveness * 0.3;
      const quantity = Math.floor(calculateYESForVUSD(vUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
      if (quantity > 0) {
        return {
          agentId: agent.id,
          action: 'buy',
          strategyId: marketStrategy.id,
          tokenType: 'yes',
          quantity,
          price: yesPrice,
          reasoning: `I'm making an initial mean reversion trade on YES tokens to establish a position. With limited historical data, I'm entering the market to begin tracking price patterns relative to the mean and build my trading position. ${personality.memo}`,
        };
      }
    }
  }

  const mean = yesPrices.reduce((sum, p) => sum + p, 0) / yesPrices.length;
  const variance = yesPrices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / yesPrices.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? (yesPrice - mean) / stdDev : 0;
  const holdings = getAgentTokenHoldings(agent, marketStrategy.id, 'yes');

  // Buy if Price < Mean (Oversold)
  const zScoreThresholdBuy = yesPrices.length < 10 ? -0.5 : -1.5;
  if (zScore < zScoreThresholdBuy && agent.vUSD > 0) {
    const vUSDToSpend = agent.vUSD * personality.aggressiveness * 0.7;
    const quantity = Math.floor(calculateYESForVUSD(vUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
    return {
      agentId: agent.id,
      action: 'buy',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm buying YES tokens because the current price of ${yesPrice.toFixed(4)} is below the mean price of ${mean.toFixed(4)}, with a z-score of ${zScore.toFixed(2)} indicating the asset is undervalued. This represents a mean reversion opportunity where I expect the price to return toward its historical average, making this an attractive entry point. ${personality.memo}`,
    };
  }

  // Sell if Price > Mean (Overbought)
  const zScoreThresholdSell = yesPrices.length < 10 ? 0.5 : 1.5;
  if (zScore > zScoreThresholdSell && holdings > 0) {
    const quantity = Math.floor(holdings * personality.aggressiveness * 0.7);
    return {
      agentId: agent.id,
      action: 'sell',
      strategyId: marketStrategy.id,
      tokenType: 'yes',
      quantity,
      price: yesPrice,
      reasoning: `I'm selling YES tokens because the current price of ${yesPrice.toFixed(4)} is above the mean price of ${mean.toFixed(4)}, with a z-score of ${zScore.toFixed(2)} indicating the asset is overvalued. Based on mean reversion principles, I expect the price to decline toward its historical average, so I'm taking profits at this elevated level. ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `I'm maintaining my current position as the YES token price of ${yesPrice.toFixed(4)} is near the mean price of ${mean.toFixed(4)}. With minimal deviation from the mean, there's no clear mean reversion opportunity at this time, so I'll wait for a more significant price deviation before adjusting my position. ${personality.memo}`,
  };
}

/**
 * Execute agent strategy - routes to appropriate strategy function
 */
export async function executeStrategy(agent: Agent, market: MarketState): Promise<TradeDecision> {
  // Select a market strategy for this agent to trade on
  const marketStrategy = selectStrategyForAgent(agent, market);
  if (!marketStrategy) {
    return {
      agentId: agent.id,
      action: 'hold',
      strategyId: '',
      tokenType: 'yes',
      quantity: 0,
      price: 0,
      reasoning: 'No market strategies available',
    };
  }

  switch (agent.strategy) {
    case 'yes-no':
      return await executeYesNoStrategy(agent, market, marketStrategy);
    case 'twap':
      return executeTWAPStrategy(agent, market, marketStrategy);
    case 'momentum':
      return executeMomentumStrategy(agent, market, marketStrategy);
    case 'mean-reversion':
      return executeMeanReversionStrategy(agent, market, marketStrategy);
    default:
      return {
        agentId: agent.id,
        action: 'hold',
        strategyId: marketStrategy.id,
        tokenType: 'yes',
        quantity: 0,
        price: getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve),
        reasoning: 'Unknown strategy',
      };
  }
}

