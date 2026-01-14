import type { Agent, MarketState, MarketStrategy, TradeDecision } from '../core/types';
import { getYESPrice, getNOPrice, calculateYESForVUSD, calculateNOForVUSD } from './amm';
import { getAgentTokenHoldings, selectStrategyForAgent } from '../agents';
import { callLLMForYesNoStrategy } from '../llm';

/**
 * Fallback yes-no strategy
 */
function executeYesNoStrategyFallback(
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
      reasoning: `${personality.name} sees value in ${marketStrategy.name} YES token at ${yesPrice.toFixed(4)} (Avg: ${avgPrice.toFixed(4)}). ${personality.memo}`,
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
      reasoning: `${personality.name} taking profits on ${marketStrategy.name} YES token at ${yesPrice.toFixed(4)} (Avg: ${avgPrice.toFixed(4)}). ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `${personality.name} holding. Price ${yesPrice.toFixed(4)} is near average ${avgPrice.toFixed(4)}. ${personality.memo}`,
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
  // Try LLM API call first
  const llmDecision = await callLLMForYesNoStrategy(agent, market, marketStrategy);
  if (llmDecision) {
    // Enforce YES only on LLM decision if it somehow returns NO (though LLM prompt was updated, safe to check)
    if (llmDecision.tokenType === 'no') {
      console.log(`[Strategy] LLM returned 'no' token type, forcing fallback to ensure YES compliance.`);
      return executeYesNoStrategyFallback(agent, market, marketStrategy);
    }
    console.log(`[Strategy] ${agent.personality.name} using LLM decision (Google Gemini)`);
    return llmDecision;
  }

  // Fallback to default strategy if LLM API fails
  console.log(`[Strategy] ${agent.personality.name} using fallback strategy (LLM unavailable)`);
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
        reasoning: `${personality.name} TWAP: ${yesTWAP.toFixed(4)}, current: ${yesPrice.toFixed(4)}. Buying YES below TWAP. ${personality.memo}`,
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
        reasoning: `${personality.name} TWAP: ${yesTWAP.toFixed(4)}, current: ${yesPrice.toFixed(4)}. Selling YES above TWAP. ${personality.memo}`,
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
        reasoning: `${personality.name} making initial trade to establish position. ${personality.memo}`,
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
    reasoning: `${personality.name} YES price aligned with TWAP. ${personality.memo}`,
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
          reasoning: `${personality.name} making initial momentum trade on YES. ${personality.memo}`,
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
      reasoning: `${personality.name} needs more data for momentum.`,
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
      reasoning: `${personality.name} detected strong upward momentum (${(momentum * 100).toFixed(2)}%) in YES. ${personality.memo}`,
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
      reasoning: `${personality.name} detected downward momentum (${(momentum * 100).toFixed(2)}%) in YES. ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `${personality.name} no clear momentum signal. ${personality.memo}`,
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
          reasoning: `${personality.name} making initial mean reversion trade on YES. ${personality.memo}`,
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
      reasoning: `${personality.name} YES price ${yesPrice.toFixed(4)} is below mean ${mean.toFixed(4)} (z-score: ${zScore.toFixed(2)}). ${personality.memo}`,
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
      reasoning: `${personality.name} YES price ${yesPrice.toFixed(4)} is above mean ${mean.toFixed(4)} (z-score: ${zScore.toFixed(2)}). ${personality.memo}`,
    };
  }

  return {
    agentId: agent.id,
    action: 'hold',
    strategyId: marketStrategy.id,
    tokenType: 'yes',
    quantity: 0,
    price: yesPrice,
    reasoning: `${personality.name} price near mean. ${personality.memo}`,
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

