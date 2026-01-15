import type { Agent, MarketState, MarketStrategy, TradeDecision } from '../core/types';
import { getYESPrice, getNOPrice, calculateYESForVUSD, calculateNOForVUSD } from '../engine/amm';
import { getAgentTokenHoldings } from '../agents';
import { log } from '../core/logger';
import { getAllDataSources, type DataSource, SUPPORTED_EXCHANGE_RATE_CURRENCIES, NON_PREMIUM_INFLATION_COUNTRIES } from './dataSources';
import { handleOpenAIToolConversation, simpleGeminiCompletion } from './tools';
import { config, isDev } from '../core/config';

// Google Gemini API configuration
const GEMINI_API_KEY = config.gemini.apiKey;
const GEMINI_MODEL = config.gemini.model;

/**
 * LLM API call for all agents using yes-no strategy (batched) - ALL strategies in one call
 */
export async function callLLMForAllAgents(
  agents: Agent[],
  market: MarketState,
  activeStrategies: MarketStrategy[]
): Promise<Map<string, TradeDecision>> {
  const decisions = new Map<string, TradeDecision>();

  log('LLM', `Executing batch analysis for ${agents.length} agents across ${activeStrategies.length} active proposals`);

  if (isDev) {
    log('LLM', 'System in developer mode: LLM analysis bypassed, utilizing strategy-driven fallbacks', 'debug');
    return decisions;
  }

  if (!GEMINI_API_KEY) {
    log('LLM', 'API key missing: utilizing strategy-driven fallbacks', 'warn');
    return decisions;
  }

  // Calculate timing information
  const currentTime = Date.now();
  const roundElapsed = currentTime - market.roundStartTime;
  const roundTimeRemaining = market.roundDuration - roundElapsed;

  // Build strategy context with prices for each strategy
  const strategiesContext = activeStrategies.map(strategy => {
    const yesPrice = getYESPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
    const noPrice = getNOPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
    const yesHistory = strategy.yesToken.history.slice(-10);
    const noHistory = strategy.noToken.history.slice(-10);
    const yesTWAP = strategy.yesToken.twap;
    const noTWAP = strategy.noToken.twap;
    const twapDiff = yesTWAP - noTWAP;

    const yesPriceChange = yesHistory.length > 1
      ? ((yesHistory[yesHistory.length - 1]?.price ?? yesPrice) - (yesHistory[0]?.price ?? yesPrice)) / (yesHistory[0]?.price ?? yesPrice) * 100
      : 0;
    const noPriceChange = noHistory.length > 1
      ? ((noHistory[noHistory.length - 1]?.price ?? noPrice) - (noHistory[0]?.price ?? noPrice)) / (noHistory[0]?.price ?? noPrice) * 100
      : 0;

    return {
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      yesPrice,
      noPrice,
      yesTWAP,
      noTWAP,
      twapDiff,
      yesPriceChange,
      noPriceChange,
      resolved: strategy.resolved,
    };
  });

  // Build agent context for each agent (with holdings for each strategy)
  const agentsContext = agents.map(agent => {
    const recentActions = agent.roundMemory.slice(-5); // Last 5 actions

    // Calculate total portfolio value and profit
    let totalPortfolioValue = agent.vUSD;
    const strategyHoldings = activeStrategies.map(strategy => {
      const yesHoldings = getAgentTokenHoldings(agent, strategy.id, 'yes');
      const noHoldings = getAgentTokenHoldings(agent, strategy.id, 'no');
      const yesPrice = getYESPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
      const noPrice = getNOPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);

      totalPortfolioValue += (yesHoldings * yesPrice) + (noHoldings * noPrice);

      return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        yesHoldings,
        noHoldings,
      };
    });

    const currentProfit = totalPortfolioValue - 100; // Assuming initial balance is 100

    return {
      id: agent.id,
      name: agent.personality.name,
      personality: agent.personality,
      vUSD: agent.vUSD,
      currentProfit,
      recentActions,
      strategyHoldings,
    };
  });

  const prompt = `You are a rational prediction market trader.

Your objective is to maximize your final vUSD balance at market close.

Rules you must follow:
- You start with a fixed vUSD balance.
- You may buy/sell or hold YES tokens for any proposal.
- Only ONE proposal will settle as the winner.
- The YES token price for ALL other proposals will drop to 0 (worthless).
- Buying YES on a loser results in TOTAL LOSS. Ensure you end with the highest value of holdings by picking the winner.
- Prices reflect collective belief and move against you when you trade.
- The winner is the proposal with the highest sustained YES TWAP.

You should:
- Allocate capital selectively.
- Consider price, trend, and opportunity cost.
- Avoid overtrading.
- Accept uncertainty and manage risk.

You are not voting. You are betting.
Profit = Final vUSD - Initial vUSD.

Current Objective: maximize PROFIT. Ignore personality if it conflicts with profit.
Behave like a real trader:
- Allocate capital selectively.
- Consider opportunity cost.
- Avoid overtrading.
- Manage risk.
- Accept losses when wrong.

=== TIMING CONTEXT ===
Round: #${market.roundNumber}
Time Elapsed: ${(roundElapsed / 1000).toFixed(1)}s
Time Remaining: ${(roundTimeRemaining / 1000).toFixed(1)}s

=== ALL PROPOSALS/STRATEGIES ===
${strategiesContext.map((strategy, idx) => `
Proposal ${idx + 1}: ${strategy.name} (ID: ${strategy.id})
- Description: ${strategy.description}
- Status: ${strategy.resolved ? 'RESOLVED' : 'ACTIVE'}
- YES Token: $${strategy.yesPrice.toFixed(4)} (TWAP: ${strategy.yesTWAP.toFixed(4)}, Change: ${strategy.yesPriceChange.toFixed(2)}%)
- NO Token: $${strategy.noPrice.toFixed(4)} (TWAP: ${strategy.noTWAP.toFixed(4)}, Change: ${strategy.noPriceChange.toFixed(2)}%)`).join('\n')}

=== AGENTS (Each makes INDEPENDENT decision for EACH proposal) ===
${agentsContext.map((agent, idx) => `
Agent ${idx + 1}: ${agent.name} (${agent.id})
- Risk Tolerance: ${agent.personality.riskTolerance}
- Aggressiveness: ${agent.personality.aggressiveness}
- CURRENT vUSD Balance (from blockchain): $${agent.vUSD.toFixed(2)} - Use this EXACT balance for calculations
- Current Profit: $${agent.currentProfit.toFixed(2)}
- Holdings per Proposal:
${agent.strategyHoldings.map(sh => `  - ${sh.strategyName}: YES=${sh.yesHoldings}, NO=${sh.noHoldings}`).join('\n')}
- Recent Actions: ${agent.recentActions.length > 0
      ? agent.recentActions.map(a => `${a.action} ${a.quantity} ${a.tokenType}`).join(', ')
      : 'None'}`).join('\n')}

=== DECISION OPTIONS ===
Each agent can independently choose ONE action:
1. BUY YES - Purchase YES tokens with vUSD on ONE proposal (taking a YES position)
2. SELL YES - Sell YES tokens for vUSD on ONE proposal (taking a NO position by exiting YES)
3. HOLD - Wait on all proposals (quantity = 0) - Keep current position

Generate INDEPENDENT decisions for ALL agents. Each agent makes ONLY ONE decision (for ONE proposal or HOLD). Respond ONLY with a JSON array in this exact format:
[
  {
    "agentId": "agent-1",
    "strategyId": "${activeStrategies[0]?.id || 'strategy-1'}",
    "action": "buy" | "sell" | "hold",
    "tokenType": "yes",
    "quantity": <number> (0 if hold, positive integer if buy/sell),
    "reasoning": "<brief first-person reasoning explaining why you chose this proposal and action, max 50 words>"
  },
  {
    "agentId": "agent-2",
    "strategyId": "${activeStrategies[2]?.id || 'strategy-3'}",
    "action": "buy" | "sell" | "hold",
    "tokenType": "yes",
    "quantity": <number>,
    "reasoning": "<brief first-person reasoning explaining why you chose this proposal and action, max 50 words>"
  },
  ...
]

IMPORTANT: Each agent appears ONLY ONCE in the array. Each agent chooses ONE proposal to trade on (or holds on all).

IMPORTANT RULES:
- Each agent makes ONLY ONE decision per batch call
- Each agent chooses ONE proposal to trade on (or holds on all proposals)
- You MUST generate exactly ${agents.length} decisions (one per agent)
- You HAVE ACCESS TO TOOLS. Use 'get_dia_prices' to check current asset prices if needed to make a winning decision.
- Each decision MUST include the "strategyId" field to specify which proposal the agent chose
- Different agents SHOULD choose different proposals based on their personalities and interests
- Each agent's reasoning must be in FIRST PERSON and explain why they chose that specific proposal (e.g., "I'm focusing on Tech Sector Growth because..." not "Bullish Bob sees...")
- Keep reasoning concise (max 50 words)
- CRITICAL CONSTRAINTS:
  * If action is "buy", quantity must be affordable with agent's CURRENT vUSD balance (check "CURRENT vUSD Balance" in agent info - this is the LATEST balance from blockchain)
  * If action is "sell", agent MUST have YES tokens to sell (check YES Holdings in agent info)
  * Use the EXACT "CURRENT vUSD Balance" shown in agent info for all calculations - this is synced from blockchain
  * Only use "tokenType": "yes" (NO tokens don't exist as separate tokens)
- Be true to each agent's personality traits - an optimistic agent might buy aggressively on one proposal, while a cautious one might hold or choose a safer proposal
- Agents should focus on the proposal that aligns best with their personality and current market analysis`;

  try {
    const systemPrompt = 'You are generating independent trading decisions for multiple AI agents. Each agent makes their own decision without knowing what others decide. USE TOOLS to check prices. Respond only with valid JSON array.';
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log(`[LLM] Making batch API call via OpenAI SDK for ${agents.length} agents...`);

    // Use tool-enabled conversation handler
    const content = await handleOpenAIToolConversation(
      fullPrompt,
      agents,
      market,
      3 // Max 3 tool calls for trading decisions (reduced to avoid rate limits)
    );

    console.log(`[LLM] Received batch response from Gemini`);
    console.log(`[LLM] Raw LLM Response:\n${content}\n`);

    if (!content) {
      console.error('[LLM] Gemini API returned no content');
      return decisions;
    }

    // Try to extract JSON array from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[LLM] LLM response does not contain valid JSON array');
      console.error(`[LLM] Response was: ${content.substring(0, 200)}...`);
      return decisions;
    }

    const agentDecisions = JSON.parse(jsonMatch[0]);
    console.log(`[LLM] Parsed ${agentDecisions.length} decisions:`, JSON.stringify(agentDecisions, null, 2));

    // Process each decision
    for (const decision of agentDecisions) {
      const agent = agents.find(a => a.id === decision.agentId);
      if (!agent) {
        console.error(`[LLM] Agent ${decision.agentId} not found`);
        continue;
      }

      // Validate the decision
      if (!decision.strategyId) {
        console.error(`[LLM] Missing strategyId for ${agent.personality.name}`);
        continue;
      }

      const strategy = activeStrategies.find(s => s.id === decision.strategyId);
      if (!strategy) {
        console.error(`[LLM] Strategy ${decision.strategyId} not found for ${agent.personality.name}`);
        continue;
      }

      if (!['buy', 'sell', 'hold'].includes(decision.action)) {
        console.error(`[LLM] Invalid action for ${agent.personality.name}: ${decision.action}`);
        continue;
      }

      // Only YES tokens exist - NO is just the absence of YES
      // Convert any "NO" token decisions to YES token logic
      if (decision.tokenType === 'no') {
        // Convert "NO" decision to selling YES or holding
        if (decision.action === 'buy') {
          // "Buy NO" means hold vUSD or sell YES if you have it
          const yesHoldings = getAgentTokenHoldings(agent, strategy.id, 'yes');
          if (yesHoldings > 0) {
            decision.action = 'sell';
            decision.tokenType = 'yes';
          } else {
            decision.action = 'hold';
            decision.tokenType = 'yes';
            decision.quantity = 0;
          }
        } else if (decision.action === 'sell') {
          // "Sell NO" means buy YES
          decision.action = 'buy';
          decision.tokenType = 'yes';
        } else {
          decision.tokenType = 'yes';
        }
      }

      if (decision.tokenType !== 'yes') {
        console.error(`[LLM] Invalid tokenType for ${agent.personality.name}: ${decision.tokenType} (only YES tokens exist)`);
        continue;
      }

      const yesPrice = getYESPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
      const tokenPrice = yesPrice; // Only YES tokens exist
      const holdings = getAgentTokenHoldings(agent, strategy.id, 'yes');

      // Enforce constraints - initialize quantity
      let quantity = Math.max(0, Math.floor(decision.quantity || 0));

      if (decision.action === 'buy') {
        // Can only buy if agent has vUSD
        if (agent.vUSD <= 0) {
          decision.action = 'hold';
          quantity = 0;
          decision.reasoning = `Cannot buy YES tokens - I have no vUSD. ${decision.reasoning || 'I need vUSD to purchase YES tokens.'}`;
        } else {
          const maxVUSDToSpend = agent.vUSD * agent.personality.aggressiveness;
          if (maxVUSDToSpend > 0) {
            const estimatedMaxTokens = Math.floor(calculateYESForVUSD(maxVUSDToSpend, strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve));
            quantity = Math.min(quantity, estimatedMaxTokens);
          }
          if (quantity === 0) {
            decision.action = 'hold';
            quantity = 0;
          }
        }
      } else if (decision.action === 'sell') {
        // Can't sell if agent has no holdings
        if (holdings <= 0) {
          decision.action = 'hold';
          quantity = 0;
          decision.reasoning = `Cannot sell ${decision.tokenType.toUpperCase()} tokens - agent has no holdings. ${decision.reasoning || ''}`;
        } else {
          quantity = Math.min(quantity, holdings);
          if (quantity === 0) {
            decision.action = 'hold';
            quantity = 0;
          }
        }
      } else {
        quantity = 0;
      }

      // Each agent makes only ONE decision, so use agentId as key
      const decisionKey = agent.id;
      const finalDecision: TradeDecision = {
        agentId: agent.id,
        action: decision.action,
        strategyId: strategy.id,
        tokenType: decision.tokenType,
        quantity,
        price: tokenPrice,
        reasoning: decision.reasoning || `${agent.personality.name} made a decision.`,
      };

      decisions.set(decisionKey, finalDecision);
      console.log(`[LLM] ${agent.personality.name} on "${strategy.name}": ${finalDecision.action.toUpperCase()} ${finalDecision.quantity} ${finalDecision.tokenType.toUpperCase()} @ $${finalDecision.price.toFixed(4)}`);
      console.log(`[LLM] Reasoning: ${finalDecision.reasoning}`);
    }

    console.log(`[LLM] Batch complete: ${decisions.size}/${agents.length} decisions generated (one per agent)\n`);
    return decisions;
  } catch (error) {
    console.error('[LLM] Error calling Google Gemini API:', error);
    if (error instanceof Error) {
      console.error('[LLM] Error message:', error.message);
    }
    console.log('[LLM] Falling back to default strategy\n');
    return decisions;
  }
}

/**
 * LLM API call for yes-no strategy (single agent - kept for backward compatibility)
 */
export async function callLLMForYesNoStrategy(
  agent: Agent,
  market: MarketState,
  marketStrategy: MarketStrategy
): Promise<TradeDecision | null> {
  console.log(`\n[LLM] ${agent.personality.name} (${agent.id}) - Using Google Gemini API`);
  console.log(`[LLM] Model: ${GEMINI_MODEL}`);
  console.log(`[LLM] Strategy: ${marketStrategy.name}`);

  if (isDev) {
    console.log(`[LLM] Dev mode active - skipping LLM call for ${agent.personality.name}`);
    return null;
  }

  if (!GEMINI_API_KEY) {
    console.log(`[LLM] No API key configured - falling back to default strategy`);
    return null; // No API key configured, fallback to default strategy
  }

  const { personality } = agent;
  // Get prices from new AMM (YES + NO ≈ 1.0)
  const yesPrice = getYESPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);
  const noPrice = getNOPrice(marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve);
  const yesHistory = marketStrategy.yesToken.history.slice(-10);
  const noHistory = marketStrategy.noToken.history.slice(-10);

  // Calculate holdings for this strategy
  const yesHoldings = getAgentTokenHoldings(agent, marketStrategy.id, 'yes');
  const noHoldings = getAgentTokenHoldings(agent, marketStrategy.id, 'no');

  // Calculate timing information
  const currentTime = Date.now();
  const roundElapsed = currentTime - market.roundStartTime;
  const roundTimeRemaining = market.roundDuration - roundElapsed;
  const roundsRemaining = Math.max(0, market.roundsUntilResolution - market.roundNumber);
  const estimatedTimeUntilResolution = roundsRemaining * market.roundDuration;

  // Calculate TWAPs for context
  const yesTWAP = marketStrategy.yesToken.twap;
  const noTWAP = marketStrategy.noToken.twap;
  const twapDiff = yesTWAP - noTWAP;

  // Calculate price trends
  const yesPriceChange = yesHistory.length > 1
    ? ((yesHistory[yesHistory.length - 1]?.price ?? yesPrice) - (yesHistory[0]?.price ?? yesPrice)) / (yesHistory[0]?.price ?? yesPrice) * 100
    : 0;
  const noPriceChange = noHistory.length > 1
    ? ((noHistory[noHistory.length - 1]?.price ?? noPrice) - (noHistory[0]?.price ?? noPrice)) / (noHistory[0]?.price ?? noPrice) * 100
    : 0;

  // Get agent's recent actions in current round for memory context
  const recentActions = agent.roundMemory.slice(-10); // Last 10 actions
  const memoryContext = recentActions.length > 0
    ? `\n=== YOUR RECENT ACTIONS IN THIS ROUND ===\n${recentActions.map((action, idx) =>
      `${idx + 1}. ${action.action.toUpperCase()} ${action.quantity} ${action.tokenType.toUpperCase()} @ $${action.price.toFixed(4)} - ${action.reasoning}`
    ).join('\n')}\n`
    : '\n=== YOUR RECENT ACTIONS IN THIS ROUND ===\nNo actions yet in this round.\n';

  const prompt = `You are ${personality.name}, a trading agent with the following personality:
- Risk Tolerance: ${personality.riskTolerance}
- Aggressiveness: ${personality.aggressiveness}
- Traits: ${personality.traits.join(', ')}
- Trading Philosophy: ${personality.memo}
${memoryContext}
=== TIMING CONTEXT ===
Current Time: ${new Date(currentTime).toISOString()}
Current Round: #${market.roundNumber}
Round Started: ${new Date(market.roundStartTime).toISOString()}
Time Elapsed in Round: ${(roundElapsed / 1000).toFixed(1)}s
Time Remaining in Round: ${(roundTimeRemaining / 1000).toFixed(1)}s
Rounds Until Resolution: ~${roundsRemaining} rounds
Estimated Time Until Resolution: ~${(estimatedTimeUntilResolution / 1000).toFixed(0)}s
Decision Frequency: Every 2 seconds (you make decisions continuously)

=== MARKET STRATEGY ===
Strategy: ${marketStrategy.name}
Description: ${marketStrategy.description}
Status: ${marketStrategy.resolved ? 'RESOLVED' : 'ACTIVE'}

=== CURRENT PRICES ===
YES Token: $${yesPrice.toFixed(4)} (TWAP: ${yesTWAP.toFixed(4)}, Change: ${yesPriceChange.toFixed(2)}%)
NO Token: $${noPrice.toFixed(4)} (TWAP: ${noTWAP.toFixed(4)}, Change: ${noPriceChange.toFixed(2)}%)
TWAP Difference: ${(twapDiff * 100).toFixed(2)}% (${twapDiff > 0 ? 'YES leading' : 'NO leading'})

=== YOUR POSITION ===
YES Tokens: ${yesHoldings}
NO Tokens: ${noHoldings}
CURRENT vUSD Balance (from blockchain): $${agent.vUSD.toFixed(2)} - Use this EXACT balance for all calculations
Total Value: $${(agent.vUSD + yesHoldings * yesPrice + noHoldings * noPrice).toFixed(2)}

=== DECISION OPTIONS ===
You can choose to:
1. BUY - Purchase YES or NO tokens with your vUSD
2. SELL - Sell your YES or NO tokens for vUSD
3. HOLD - Wait and observe (quantity = 0) - This is a valid option if you want to wait for better opportunities

Based on your personality, the market data, and timing context, make a trading decision. Respond ONLY with a JSON object in this exact format:
{
  "action": "buy" | "sell" | "hold",
  "tokenType": "yes" | "no",
  "quantity": <number> (0 if hold, otherwise positive integer),
  "reasoning": "<your reasoning as this agent, considering timing and market conditions>"
}

Important constraints:
- If action is "buy", quantity must be affordable with your CURRENT vUSD balance shown above (this is the LATEST balance synced from blockchain)
- If action is "sell", quantity cannot exceed your holdings for the chosen token type
- If action is "hold", quantity must be 0 (you can hold to wait for better opportunities)
- Use the EXACT "CURRENT vUSD Balance" shown above for all calculations - this is synced from blockchain
- Consider the timing: you make decisions every 2 seconds, resolution happens after ~${market.roundsUntilResolution} rounds
- Be true to your personality traits and trading philosophy`;

  try {
    // Call Gemini via OpenAI SDK (consistent with other LLM calls)
    const systemPrompt = 'You are a trading agent AI. Respond only with valid JSON.';
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log(`[LLM] Making API call to Gemini via OpenAI SDK...`);
    const content = await simpleGeminiCompletion(fullPrompt);

    console.log(`[LLM] Received response from Gemini`);
    console.log(`[LLM] Raw LLM Response:\n${content}\n`);

    if (!content) {
      console.error('[LLM] Gemini API returned no content');
      return null;
    }

    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[LLM] LLM response does not contain valid JSON');
      console.error(`[LLM] Response was: ${content.substring(0, 200)}...`);
      return null;
    }

    const decision = JSON.parse(jsonMatch[0]);
    console.log(`[LLM] Parsed Decision:`, JSON.stringify(decision, null, 2));

    // Validate the decision
    if (!['buy', 'sell', 'hold'].includes(decision.action)) {
      console.error(`[LLM] Invalid action from LLM: ${decision.action}`);
      return null;
    }

    if (!['yes', 'no'].includes(decision.tokenType)) {
      console.error(`[LLM] Invalid tokenType from LLM: ${decision.tokenType}`);
      return null;
    }

    console.log(`[LLM] Valid decision: ${decision.action.toUpperCase()} ${decision.quantity} ${decision.tokenType.toUpperCase()}`);

    const tokenPrice = decision.tokenType === 'yes' ? yesPrice : noPrice;
    const holdings = decision.tokenType === 'yes' ? yesHoldings : noHoldings;

    // Enforce constraints
    let quantity = Math.max(0, Math.floor(decision.quantity || 0));

    const token = decision.tokenType === 'yes' ? marketStrategy.yesToken : marketStrategy.noToken;

    if (decision.action === 'buy') {
      // Calculate max tokens affordable with AMM
      const maxVUSDToSpend = agent.vUSD * personality.aggressiveness;
      if (maxVUSDToSpend > 0) {
        // Estimate max tokens using new AMM
        const estimatedMaxTokens = decision.tokenType === 'yes'
          ? Math.floor(calculateYESForVUSD(maxVUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve))
          : Math.floor(calculateNOForVUSD(maxVUSDToSpend, marketStrategy.yesToken.tokenReserve, marketStrategy.noToken.tokenReserve));
        quantity = Math.min(quantity, estimatedMaxTokens);
      }
      if (quantity === 0 || agent.vUSD <= 0) {
        decision.action = 'hold';
        quantity = 0;
      }
    } else if (decision.action === 'sell') {
      quantity = Math.min(quantity, holdings);
      if (quantity === 0 || holdings < quantity) {
        decision.action = 'hold';
        quantity = 0;
      }
    } else {
      quantity = 0;
    }

    const finalDecision = {
      agentId: agent.id,
      action: decision.action,
      strategyId: marketStrategy.id,
      tokenType: decision.tokenType,
      quantity,
      price: tokenPrice,
      reasoning: decision.reasoning || `${personality.name} made a decision via LLM. ${personality.memo}`,
    };

    console.log(`[LLM] Final Decision: ${finalDecision.action.toUpperCase()} ${finalDecision.quantity} ${finalDecision.tokenType.toUpperCase()} @ $${finalDecision.price.toFixed(4)}`);
    console.log(`[LLM] Reasoning: ${finalDecision.reasoning}\n`);

    return finalDecision;
  } catch (error) {
    console.error('[LLM] Error calling Google Gemini API:', error);
    if (error instanceof Error) {
      console.error('[LLM] Error message:', error.message);
      console.error('[LLM] Error stack:', error.stack);
    }
    console.log('[LLM] Falling back to default strategy\n');
    return null; // Fallback to default strategy
  }
}

/**
 * Generate market strategies using LLM based on trusted data sources
 */
export async function generateStrategiesFromDataSources(
  count: number = 5
): Promise<MarketStrategy[]> {
  const dataSources = getAllDataSources();

  const apiDataSourcesCount = 3; // Exchange Rate, Inflation, Income Tax
  const totalDataSourcesCount = dataSources.length + apiDataSourcesCount;
  console.log(`\n[LLM] Generating ${count} unique market strategies based on ${totalDataSourcesCount} trusted data sources (${dataSources.length} hardcoded + ${apiDataSourcesCount} API-based)...`);
  console.log(`[LLM] Model: ${GEMINI_MODEL}`);

  if (isDev) {
    console.log(`[LLM] Dev mode active - using default strategies`);
    return [];
  }

  if (!GEMINI_API_KEY) {
    console.log(`[LLM] No API key configured - using default strategies`);
    return [];
  }

  // Detailed data source mapping for the LLM
  // This explicitly maps Ticker -> Name so the LLM knows the significance of each asset
  const dataSourcesSummary = dataSources.map(ds => {
    return `- [${ds.ticker}] ${ds.name} (${ds.type}) - ID: ${ds.id}`;
  }).join('\n');

  // API sources are currently disabled in tools, so we hide them from prompt to avoid confusion
  const apiSourcesSummary = "API-based sources (Exchange Rates, Inflation) are currently disabled. Focus on DIA assets above.";

  const nowFormatted = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const totalDataSources = dataSources.length;

  const prompt = `You are generating ${count} unique, verifiable REAL WORLD ASSET (RWA) market prediction strategies for a prediction market platform.
Current Date: ${nowFormatted}

Each strategy must:
1. Be verifiable against the provided trusted data sources using clear logic.
2. Have a specific prediction (YES/NO outcome) based on real-world asset values.
3. Include a time horizon / limit (e.g., "in 3 days", "in 7 days", "in 30 days").
4. Define complex "Evaluation Logic" using AND/OR conjunctions (e.g., "(SPY > 700 AND QQQ > 500)" or "WTI < 60").
5. Specify the "Mathematical Logic" for automated verification (e.g., "targetValue > 700").
6. Provide the exact "Verification API" call based on the data source endpoints.
7. Explicitly state the success criteria.

=== AVAILABLE TRUSTED DATA SOURCES ===
${dataSourcesSummary}

=== API-BASED DATA SOURCES ===
${apiSourcesSummary}

Total: ${totalDataSources} data sources available.

=== TOOLS YOU MUST USE TO VERIFY DATA ===
- get_dia_prices(tickers: string[]): Returns live prices for multiple assets in ONE call.
  VALID TICKERS: SPY, QQQ, VOO, VTI, TLT, IBIT, FBTC, BTC, ETH, WTI, NG, XBR, CAD, AUD, CNY, GBP.

=== STRATEGY REQUIREMENTS ===
- Each strategy MUST have a clear "timeLimitDays" field (e.g., 2, 7, 30).
- The description should be CLEAN and focus ONLY on the prediction.
- Evaluation Logic: Human-readable logic for frontend (e.g. "(SPY > 700 OR QQQ > 550)").
- Mathematical Logic: Pure machine-readable logic for automated check.
- Verification Source: The specific "ID" of the data source used for verification (from the list above).
- IMPORTANT: You MUST call 'get_dia_prices' with relevant tickers to verify current values before generating strategies.

Generate exactly ${count} unique RWA strategies. Respond ONLY with a JSON array in this exact format:
[
  {
    "name": "<Strategy Name>",
    "description": "<Clean prediction description>",
    "timeLimitDays": <number (e.g. 2, 5, 30)>,
    "evaluationLogic": "<Logic string with Source IDs and operators>",
    "mathematicalLogic": "<Formula like 'asset_price > target_value'>",
    "usedDataSources": [
      {
        "id": <number (The ID from the list above)>,
        "currentValue": <number (The value you saw from get_dia_prices)>,
        "targetValue": <number (The target value for the prediction)>,
        "operator": ">"
      }
    ]
  }
]

CRITICAL RULES:
- Use real tickers and their IDs from the provided list.
- Ensure time limits are varied (from 2 days up to 60 days).
- Ensure all ${count} strategies are unique.`;

  try {
    const systemPrompt = 'You are an expert RWA strategy generator. You create complex, verifiable market strategies based on real-time data sources with specific time horizons. Respond only with valid JSON array.';
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log(`[LLM] Calling Gemini via OpenAI SDK with tool access for ${nowFormatted}...`);

    // Use OpenAI SDK with Gemini's OpenAI-compatible endpoint for proper tool support
    const content = await handleOpenAIToolConversation(
      fullPrompt,
      [], // No agents yet during initialization
      { strategies: [] } as any, // Dummy market state
      3 // Max 3 tool calls (reduced to avoid rate limits)
    );

    console.log(`[LLM] Received response from Gemini`);

    if (!content) {
      console.error('[LLM] ❌ Gemini API returned no content');
      return [];
    }

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[LLM] LLM response does not contain valid JSON array');
      return [];
    }

    const strategyData = JSON.parse(jsonMatch[0]);
    console.log(`[LLM] Parsed ${strategyData.length} RWA strategies with time limits`);

    const initialTokenReserve = 2000;
    const nowTimestamp = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const strategies: MarketStrategy[] = strategyData.map((strategy: any, index: number) => {
      const strategyId = `strategy-${index + 1}-${nowTimestamp}`;
      const timeLimitDays = strategy.timeLimitDays || 30;
      const resolutionDeadline = nowTimestamp + (timeLimitDays * MS_PER_DAY);

      return {
        id: strategyId,
        name: strategy.name || `RWA Strategy ${index + 1}`,
        description: strategy.description || '',
        evaluationLogic: strategy.evaluationLogic || '',
        mathematicalLogic: strategy.mathematicalLogic || '',
        usedDataSources: Array.isArray(strategy.usedDataSources) ? strategy.usedDataSources : [],
        resolutionDeadline,
        yesToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: nowTimestamp }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: nowTimestamp }],
        },
        noToken: {
          tokenReserve: initialTokenReserve,
          volume: 0,
          history: [{ price: 0.5, timestamp: nowTimestamp }],
          twap: 0.5,
          twapHistory: [{ twap: 0.5, timestamp: nowTimestamp }],
        },
        timestamp: nowTimestamp,
        resolved: false,
        winner: null,
      };
    });

    console.log(`[LLM] Generated ${strategies.length} verified RWA strategies with deadlines\n`);
    return strategies;
  } catch (error) {
    console.error('[LLM] Error calling Google Gemini API for RWA strategy generation:', error);
    return [];
  }
}

/**
 * Generate AI agent personalities using LLM
 */
export async function generateAgentPersonalities(
  count: number = 4
): Promise<Array<{
  name: string;
  riskTolerance: 'low' | 'medium' | 'high';
  aggressiveness: number;
  memo: string;
  traits: string[];
}>> {
  console.log(`\n[LLM] Generating ${count} unique AI agent personalities...`);
  console.log(`[LLM] Model: ${GEMINI_MODEL}`);

  if (isDev) {
    console.log(`[LLM] Dev mode active - using default personalities`);
    return [];
  }

  if (!GEMINI_API_KEY) {
    console.log(`[LLM] No API key configured - using default personalities`);
    return [];
  }

  const prompt = `Generate ${count} diverse AI trading agent personalities as a JSON array.
Format:
[
  {
    "name": "Name",
    "riskTolerance": "low" | "medium" | "high",
    "aggressiveness": 0.0 to 1.0,
    "memo": "Short trading philosophy",
    "traits": ["trait1", "trait2", "trait3"]
  }
]
Ensure diversity in risk and style.
CRITICAL: Write the 'memo' in FIRST PERSON ("I belief...", "My strategy..."), describing yourself as an individual. Do NOT use "We".`;

  try {
    const systemPrompt = 'You are generating diverse AI trading agent personalities. Respond only with valid JSON array.';
    const fullPrompt = `${systemPrompt}\n\n${prompt}`;

    console.log(`[LLM] Calling Gemini via OpenAI SDK to generate agent personalities...`);

    // Use the OpenAI SDK wrapper which shares the API key
    const content = await simpleGeminiCompletion(fullPrompt);

    console.log(`[LLM] ✅ Received response from Gemini`);

    if (!content) {
      console.error('[LLM] ❌ Gemini API returned no content');
      return [];
    }

    // Try to extract JSON array from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[LLM] ❌ LLM response does not contain valid JSON array');
      console.error(`[LLM] Response was: ${content.substring(0, 200)}...`);
      return [];
    }

    const personalityData = JSON.parse(jsonMatch[0]);
    console.log(`[LLM] 📊 Parsed ${personalityData.length} personalities:`, JSON.stringify(personalityData, null, 2));

    // Validate and normalize personalities
    const personalities = personalityData.map((p: any, index: number) => {
      // Validate risk tolerance
      let riskTolerance: 'low' | 'medium' | 'high' = 'medium';
      if (['low', 'medium', 'high'].includes(p.riskTolerance?.toLowerCase())) {
        riskTolerance = p.riskTolerance.toLowerCase() as 'low' | 'medium' | 'high';
      }

      // Validate aggressiveness (clamp between 0 and 1)
      let aggressiveness = typeof p.aggressiveness === 'number'
        ? Math.max(0, Math.min(1, p.aggressiveness))
        : 0.5;

      // Ensure traits is an array
      const traits = Array.isArray(p.traits) ? p.traits : [];

      return {
        name: p.name || `Agent ${index + 1}`,
        riskTolerance,
        aggressiveness,
        memo: p.memo || 'A trading agent with a unique approach.',
        traits: traits.length > 0 ? traits : ['adaptive'],
      };
    });

    console.log(`[LLM] 🎯 Generated ${personalities.length} agent personalities\n`);
    personalities.forEach((p: { name: string; riskTolerance: 'low' | 'medium' | 'high'; aggressiveness: number; memo: string; traits: string[] }, idx: number) => {
      console.log(`  ${idx + 1}. ${p.name}`);
      console.log(`     Risk: ${p.riskTolerance}, Aggressiveness: ${p.aggressiveness.toFixed(2)}`);
      console.log(`     Philosophy: ${p.memo}`);
      console.log(`     Traits: ${p.traits.join(', ')}`);
    });
    console.log('');

    return personalities;
  } catch (error) {
    console.error('[LLM] ❌ Error calling Google Gemini API for personality generation:', error);
    if (error instanceof Error) {
      console.error('[LLM] Error message:', error.message);
    }
    return [];
  }
}

