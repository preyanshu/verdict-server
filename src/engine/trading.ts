import type { Agent, MarketState, TradeDecision } from '../core/types';
import { log } from '../core/logger';
import {
  getYESPrice,
  getNOPrice,
  calculateYESForVUSD,
  calculateNOForVUSD,
  calculateVUSDForYES,
  calculateVUSDForNO,
  calculateYESForNO,
  calculateNOForYES,
  mintDecisionTokens,
  calculateYESForVUSDSwap,
  calculateVUSDForYESSwap,
  getYESPriceInVUSD
} from './amm';
import { getAgentTokenHoldings, updateAgentTokenHoldings } from '../agents';
import { updateTWAP, resolveAllStrategies } from './twap';
import { updateMarketPrice, resetStrategiesForNewRound } from './market';
import { executeStrategy } from './strategies';
import { graduateProposal } from '../core/db';

const BATCH_LLM_GAP_MS = 25000; // 15 seconds between batch LLM calls
const TRADE_EXECUTION_WINDOW_MS = 25000; // 15 seconds to execute all queued trades

/**
 * Execute queued trades over 15 seconds with random gaps
 */
async function executeQueuedTrades(
  marketState: MarketState,
  agents: Agent[]
): Promise<void> {
  // isExecutingTrades now represents the entire round status (true for whole round)
  // Use isExecutingTradeBatch to track if a batch is currently being processed
  if (marketState.tradeQueue.length === 0 || marketState.isExecutingTradeBatch) {
    return;
  }

  marketState.isExecutingTradeBatch = true;
  
  try {
    const totalTrades = marketState.tradeQueue.length;
    log('Trading', `Executing ${totalTrades} queued trades sequentially over ${TRADE_EXECUTION_WINDOW_MS / 1000} seconds`);

    // Import blockchain functions
    let executeSwapOnChain: typeof import('../blockchain').executeSwapOnChain | null = null;
    let ROUTER_ADDRESS: string | null = null;
    try {
      const blockchain = await import('../blockchain');
      executeSwapOnChain = blockchain.executeSwapOnChain;
      ROUTER_ADDRESS = blockchain.ROUTER_ADDRESS;
    } catch (e) {
      log('Trading', 'Blockchain unavailable, running in simulation mode', 'warn');
    }

  // Calculate random delays for each trade, spread over the execution window
  const totalWindow = TRADE_EXECUTION_WINDOW_MS;
  const delays: number[] = [];

  if (totalTrades === 1) {
    delays.push(0);
  } else {
    let remainingTime = totalWindow;
    for (let i = 0; i < totalTrades - 1; i++) {
      const maxDelay = Math.min(4000, remainingTime / (totalTrades - i));
      const delay = Math.random() * maxDelay + 1000;
      delays.push(delay);
      remainingTime -= delay;
    }
    delays.push(Math.max(0, remainingTime));
  }

  let executedCount = 0;
  while (marketState.tradeQueue.length > 0) {
    const trade = marketState.tradeQueue[0];
    if (!trade) {
      marketState.tradeQueue.shift();
      continue;
    }

    const { decision, agent } = trade;
    const delay = delays[executedCount] || 0;

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    marketState.tradeQueue.shift();

    if (decision.action !== 'hold') {
      const strategyName = marketState.strategies.find(s => s.id === decision.strategyId)?.name || decision.strategyId;

      let onChainSuccess = false;
      let currentTxHash: string | undefined = undefined;

      if (executeSwapOnChain && ROUTER_ADDRESS) {
        try {
          const blockchain = await import('../blockchain');
          const vUSDCAddress = blockchain.VUSDCADDRESS;

          if (decision.tokenType === 'no') {
            log('Trading', `[${agent.personality.name}] On-chain NO token trading pending implementation, simulating locally`, 'debug');
            onChainSuccess = true;
          } else {
            let tokenIn = vUSDCAddress;
            let amountIn = decision.quantity;

            if (decision.action === 'buy') {
              tokenIn = vUSDCAddress || '0xa16E02E87b7454126E5E10d957A927A7F5B5d2be';
              // For buy: amountIn is vUSD to spend
              // decision.quantity is the number of YES tokens desired
              // We need to calculate how much vUSD is needed to get that many YES tokens
              const strategy = marketState.strategies.find(s => s.id === decision.strategyId);
              if (strategy && decision.quantity > 0) {
                // Use the actual swap calculation to determine vUSD needed
                const { getYESPriceInVUSD } = await import('./amm');
                const actualPricePerYES = getYESPriceInVUSD(strategy.noToken.tokenReserve, strategy.yesToken.tokenReserve);
                // If decision.price is provided and seems reasonable (between 0.1 and 10), use it
                // Otherwise use the actual swap price
                const priceToUse = (decision.price && decision.price >= 0.1 && decision.price <= 10) 
                  ? decision.price 
                  : actualPricePerYES;
                const estimatedVUSD = decision.quantity * priceToUse;
                amountIn = Math.max(1, Math.floor(estimatedVUSD)); // Minimum 1 vUSD
              } else {
                // Fallback: use decision values or minimum
                amountIn = Math.max(1, Math.floor(decision.quantity * (decision.price || 0.5)));
              }
            } else {
              tokenIn = await blockchain.getYesTokenAddress(decision.strategyId);
              amountIn = Math.max(1, Math.floor(decision.quantity)); // Minimum 1 token
            }

            log('Trading', `[${agent.personality.name}] Initiating on-chain ${decision.action.toUpperCase()} for ${decision.tokenType.toUpperCase()}: quantity=${decision.quantity}, price=${decision.price?.toFixed(4) || 'N/A'}, amountIn=${amountIn}`);

            if (!tokenIn) {
              throw new Error(`Could not determine token address for ${decision.tokenType}`);
            }

            // Validate amountIn before attempting swap
            if (amountIn <= 0 || decision.quantity <= 0) {
              log('Trading', `[${agent.personality.name}] Invalid swap parameters: amountIn=${amountIn}, quantity=${decision.quantity}, skipping swap`, 'warn');
              onChainSuccess = false;
            } else {
              const swapResult = await executeSwapOnChain(
                agent,
                decision.strategyId,
                tokenIn,
                amountIn,
                0
              );

              if (swapResult.success && swapResult.txHash) {
                onChainSuccess = true;
                currentTxHash = swapResult.txHash;
                const { config } = await import('../core/config');
                log('Trading', `[${agent.personality.name}] Transaction confirmed: ${config.blockchain.blockExplorerUrl}/tx/${currentTxHash}`);
                
                // Sync agent balance from chain before executing trade
                try {
                  const { getAgentVUSDCBalance } = await import('../blockchain');
                  const updatedBalance = await getAgentVUSDCBalance(agent.wallet.address);
                  agent.vUSD = updatedBalance;
                  log('Trading', `[${agent.personality.name}] Synced balance from chain: ${updatedBalance.toFixed(2)} vUSD`, 'debug');
                } catch (err) {
                  log('Trading', `[${agent.personality.name}] Failed to sync balance: ${err}`, 'warn');
                }
                
                // Only add trade to agent.trades AFTER transaction is confirmed on-chain
                log('Trading', `[${agent.personality.name}] Calling executeTrade with txHash: ${currentTxHash}`, 'debug');
                executeTrade(decision, agents, marketState, currentTxHash);
                
                // Verify trade was added
                const agentAfterTrade = agents.find(a => a.id === decision.agentId);
                if (agentAfterTrade) {
                  const lastTrade = agentAfterTrade.trades[agentAfterTrade.trades.length - 1];
                  if (lastTrade && lastTrade.txHash === currentTxHash) {
                    log('Trading', `[${agent.personality.name}] ✅ Trade successfully added to agent.trades (total trades: ${agentAfterTrade.trades.length})`, 'debug');
                  } else {
                    log('Trading', `[${agent.personality.name}] ⚠️ Trade NOT found in agent.trades after executeTrade call!`, 'warn');
                  }
                }
                
                executedCount++;
                log('Trading', `[${executedCount}/${totalTrades}] Execution complete for ${agent.personality.name} on "${strategyName}"`);
              } else {
                log('Trading', `[${agent.personality.name}] Transaction failed on-chain`, 'error');
              }
            }
          }
        } catch (err) {
          log('Trading', `[${agent.personality.name}] Execution error: ${err}`, 'error');
          onChainSuccess = false;
        }
      } else {
        onChainSuccess = true;
        // For simulation mode, execute trade without txHash
        executeTrade(decision, agents, marketState);
        executedCount++;
        log('Trading', `[${executedCount}/${totalTrades}] Execution complete for ${agent.personality.name} on "${strategyName}"`);
      }

      if (!onChainSuccess) {
        log('Trading', `[${agent.personality.name}] Aborted local state update due to execution failure`, 'warn');
      }
    } else {
      executedCount++;
      const strategyName = marketState.strategies.find(s => s.id === decision.strategyId)?.name || decision.strategyId;
      log('Trading', `[${executedCount}/${totalTrades}] Hold: ${agent.personality.name} on "${strategyName}"`);
    }
    }

    log('Trading', `Batch execution complete: ${executedCount} operations processed`);
  } catch (error) {
    log('Trading', `Error in executeQueuedTrades: ${error}`, 'error');
  } finally {
    marketState.isExecutingTradeBatch = false;
    // Don't set isExecutingTrades to false here - it should remain true for the entire round
    // isExecutingTrades represents round status, not individual batch execution status
  }
}

/**
 * Execute trade using Constant Product AMM
 * @param txHash Optional transaction hash - if provided, trade is only added after on-chain confirmation
 */
export function executeTrade(
  decision: TradeDecision,
  agents: Agent[],
  marketState: MarketState,
  txHash?: string
): void {
  const agent = agents.find(a => a.id === decision.agentId);
  if (!agent) {
    log('Trading', `[executeTrade] Agent not found: ${decision.agentId}`, 'warn');
    return;
  }

  const marketStrategy = marketState.strategies.find(s => s.id === decision.strategyId);
  if (!marketStrategy || marketStrategy.resolved) {
    log('Trading', `[executeTrade] Strategy not found or resolved: ${decision.strategyId}`, 'warn');
    return;
  }

  const yesToken = marketStrategy.yesToken;
  const noToken = marketStrategy.noToken;

  if (decision.action === 'buy' && decision.quantity > 0) {
    if (decision.tokenType === 'yes') {
      // Calculate vUSD needed - for on-chain swaps, use actual swap price
      let estimatedVUSD: number;
      if (txHash) {
        // On-chain swap: use actual swap calculation to estimate price
        const actualPricePerYES = getYESPriceInVUSD(noToken.tokenReserve, yesToken.tokenReserve);
        estimatedVUSD = decision.quantity * actualPricePerYES;
      } else {
        estimatedVUSD = decision.quantity * getYESPrice(yesToken.tokenReserve, noToken.tokenReserve);
      }

      // If txHash is provided, on-chain transaction already succeeded - skip balance check
      const shouldExecute = txHash ? true : (agent.vUSD >= estimatedVUSD && estimatedVUSD > 0);
      
      if (shouldExecute) {
        log('Trading', `[executeTrade] Executing BUY YES: agent.vUSD=${agent.vUSD.toFixed(2)}, estimatedVUSD=${estimatedVUSD.toFixed(2)}, quantity=${decision.quantity}`, 'debug');
        
        let totalYESReceived: number;
        if (txHash) {
          // On-chain swap: calculate actual tokens received using swap formula
          totalYESReceived = calculateYESForVUSDSwap(estimatedVUSD, noToken.tokenReserve, yesToken.tokenReserve);
          // Update reserves based on actual swap
          noToken.tokenReserve += estimatedVUSD;
          yesToken.tokenReserve -= totalYESReceived;
        } else {
          // In-memory swap: use existing logic
          const minted = mintDecisionTokens(estimatedVUSD, yesToken.tokenReserve, noToken.tokenReserve);
          yesToken.tokenReserve += minted.yesTokensOut;
          noToken.tokenReserve += minted.noTokensOut;
          const noToSwap = minted.noTokensOut;
          const additionalYES = calculateYESForNO(noToSwap, yesToken.tokenReserve, noToken.tokenReserve);
          yesToken.tokenReserve -= additionalYES;
          noToken.tokenReserve += noToSwap;
          totalYESReceived = minted.yesTokensOut + additionalYES;
          agent.vUSD -= estimatedVUSD;
        }
        
        updateAgentTokenHoldings(agent, decision.strategyId, 'yes', totalYESReceived);

        // Calculate actual vUSD price per YES token (vUSD spent / tokens received)
        const actualPricePerToken = totalYESReceived > 0 ? estimatedVUSD / totalYESReceived : 0;

        const tradeEntry = {
          type: 'buy' as const,
          strategyId: decision.strategyId,
          tokenType: 'yes' as const,
          price: actualPricePerToken, // Actual vUSD price per token, not probability
          quantity: totalYESReceived,
          timestamp: Date.now(),
          reasoning: decision.reasoning || `${agent.personality.name} acquired YES tokens`,
          txHash: txHash, // Add txHash when trade is added (only after on-chain confirmation)
        };
        
        agent.trades.push(tradeEntry);
        log('Trading', `[executeTrade] Added trade for ${agent.personality.name}: ${tradeEntry.type} ${tradeEntry.quantity} ${tradeEntry.tokenType} @ $${tradeEntry.price.toFixed(4)} vUSD/token (txHash: ${txHash || 'none'})`, 'debug');

        yesToken.volume += totalYESReceived;
        const currentPrice = getYESPrice(yesToken.tokenReserve, noToken.tokenReserve);
        yesToken.history.push({ price: currentPrice, timestamp: Date.now() });
        if (yesToken.history.length > 100) yesToken.history.shift();
        updateTWAP(yesToken);
      } else {
        log('Trading', `[executeTrade] BUY YES condition failed: agent.vUSD=${agent.vUSD.toFixed(2)}, estimatedVUSD=${estimatedVUSD.toFixed(2)}, quantity=${decision.quantity}`, 'warn');
      }
    } else {
      const estimatedVUSD = decision.quantity * getNOPrice(yesToken.tokenReserve, noToken.tokenReserve);

      // If txHash is provided, on-chain transaction already succeeded - skip balance check
      const shouldExecute = txHash ? true : (agent.vUSD >= estimatedVUSD && estimatedVUSD > 0);
      
      if (shouldExecute) {
        log('Trading', `[executeTrade] Executing BUY NO: agent.vUSD=${agent.vUSD.toFixed(2)}, estimatedVUSD=${estimatedVUSD.toFixed(2)}, quantity=${decision.quantity}`, 'debug');
        const minted = mintDecisionTokens(estimatedVUSD, yesToken.tokenReserve, noToken.tokenReserve);
        yesToken.tokenReserve += minted.yesTokensOut;
        noToken.tokenReserve += minted.noTokensOut;

        const yesToSwap = minted.yesTokensOut;
        const additionalNO = calculateNOForYES(yesToSwap, yesToken.tokenReserve, noToken.tokenReserve);

        yesToken.tokenReserve += yesToSwap;
        noToken.tokenReserve -= additionalNO;

        const totalNOReceived = minted.noTokensOut + additionalNO;

        // Only deduct vUSD if not already done on-chain (when txHash is provided, balance already synced)
        if (!txHash) {
          agent.vUSD -= estimatedVUSD;
        }
        updateAgentTokenHoldings(agent, decision.strategyId, 'no', totalNOReceived);

        // Calculate actual vUSD price per NO token (vUSD spent / tokens received)
        const actualPricePerToken = totalNOReceived > 0 ? estimatedVUSD / totalNOReceived : 0;

        const tradeEntry = {
          type: 'buy' as const,
          strategyId: decision.strategyId,
          tokenType: 'no' as const,
          price: actualPricePerToken, // Actual vUSD price per token, not probability
          quantity: totalNOReceived,
          timestamp: Date.now(),
          reasoning: decision.reasoning || `${agent.personality.name} acquired NO tokens`,
          txHash: txHash, // Add txHash when trade is added (only after on-chain confirmation)
        };
        
        agent.trades.push(tradeEntry);
        log('Trading', `[executeTrade] Added trade for ${agent.personality.name}: ${tradeEntry.type} ${tradeEntry.quantity} ${tradeEntry.tokenType} @ $${tradeEntry.price.toFixed(4)} vUSD/token (txHash: ${txHash || 'none'})`, 'debug');

        noToken.volume += totalNOReceived;
        const currentPrice = getNOPrice(yesToken.tokenReserve, noToken.tokenReserve);
        noToken.history.push({ price: currentPrice, timestamp: Date.now() });
        if (noToken.history.length > 100) noToken.history.shift();
        updateTWAP(noToken);
      } else {
        log('Trading', `[executeTrade] BUY NO condition failed: agent.vUSD=${agent.vUSD.toFixed(2)}, estimatedVUSD=${estimatedVUSD.toFixed(2)}, quantity=${decision.quantity}`, 'warn');
      }
    }
  } else if (decision.action === 'sell' && decision.quantity > 0) {
    const holdings = getAgentTokenHoldings(agent, decision.strategyId, decision.tokenType);

    // If txHash is provided, on-chain transaction already succeeded - skip holdings check
    const shouldExecute = txHash ? true : (holdings >= decision.quantity);
    
    if (shouldExecute) {
      log('Trading', `[executeTrade] Executing SELL: holdings=${holdings.toFixed(2)}, quantity=${decision.quantity}, tokenType=${decision.tokenType}`, 'debug');
      if (decision.tokenType === 'yes') {
        let vUSDReceived: number;
        
        if (txHash) {
          // On-chain swap: use actual swap calculation
          vUSDReceived = calculateVUSDForYESSwap(decision.quantity, noToken.tokenReserve, yesToken.tokenReserve);
          // Update reserves based on actual swap (YES in, vUSD out)
          yesToken.tokenReserve += decision.quantity;
          noToken.tokenReserve -= vUSDReceived;
        } else {
          // In-memory swap: use existing logic
          const noTokensReceived = calculateNOForYES(decision.quantity, yesToken.tokenReserve, noToken.tokenReserve);
          yesToken.tokenReserve += decision.quantity;
          noToken.tokenReserve -= noTokensReceived;
          vUSDReceived = Math.min(decision.quantity, noTokensReceived);
          yesToken.tokenReserve -= vUSDReceived;
          noToken.tokenReserve -= vUSDReceived;
          agent.vUSD += vUSDReceived;
        }

        // Only add vUSD if not already done on-chain (when txHash is provided, balance already synced)
        updateAgentTokenHoldings(agent, decision.strategyId, 'yes', -decision.quantity);

        // Calculate actual vUSD price per YES token (vUSD received / tokens sold)
        const actualPricePerToken = decision.quantity > 0 ? vUSDReceived / decision.quantity : 0;

        const tradeEntry = {
          type: 'sell' as const,
          strategyId: decision.strategyId,
          tokenType: 'yes' as const,
          price: actualPricePerToken, // Actual vUSD price per token, not probability
          quantity: decision.quantity,
          timestamp: Date.now(),
          reasoning: decision.reasoning || `${agent.personality.name} liquidated YES tokens`,
          txHash: txHash, // Add txHash when trade is added (only after on-chain confirmation)
        };
        
        agent.trades.push(tradeEntry);
        log('Trading', `[executeTrade] Added trade for ${agent.personality.name}: ${tradeEntry.type} ${tradeEntry.quantity} ${tradeEntry.tokenType} @ $${tradeEntry.price.toFixed(4)} vUSD/token (txHash: ${txHash || 'none'})`, 'debug');

        yesToken.volume += decision.quantity;
        // Store probability price for history (for charts/TWAP)
        const currentPrice = getYESPrice(yesToken.tokenReserve, noToken.tokenReserve);
        yesToken.history.push({ price: currentPrice, timestamp: Date.now() });
        if (yesToken.history.length > 100) yesToken.history.shift();
        updateTWAP(yesToken);
      } else {
        // Sell NO tokens
        const yesTokensReceived = calculateYESForNO(decision.quantity, yesToken.tokenReserve, noToken.tokenReserve);

        yesToken.tokenReserve -= yesTokensReceived;
        noToken.tokenReserve += decision.quantity;

        const vUSDReceived = Math.min(decision.quantity, yesTokensReceived);

        yesToken.tokenReserve -= vUSDReceived;
        noToken.tokenReserve -= vUSDReceived;

        // Only add vUSD if not already done on-chain (when txHash is provided, balance already synced)
        if (!txHash) {
          agent.vUSD += vUSDReceived;
        }
        updateAgentTokenHoldings(agent, decision.strategyId, 'no', -decision.quantity);

        // Calculate actual vUSD price per NO token (vUSD received / tokens sold)
        const actualPricePerToken = decision.quantity > 0 ? vUSDReceived / decision.quantity : 0;

        const tradeEntry = {
          type: 'sell' as const,
          strategyId: decision.strategyId,
          tokenType: 'no' as const,
          price: actualPricePerToken, // Actual vUSD price per token, not probability
          quantity: decision.quantity,
          timestamp: Date.now(),
          reasoning: decision.reasoning || `${agent.personality.name} liquidated NO tokens`,
          txHash: txHash, // Add txHash when trade is added (only after on-chain confirmation)
        };
        
        agent.trades.push(tradeEntry);
        log('Trading', `[executeTrade] Added trade for ${agent.personality.name}: ${tradeEntry.type} ${tradeEntry.quantity} ${tradeEntry.tokenType} @ $${tradeEntry.price.toFixed(4)} vUSD/token (txHash: ${txHash || 'none'})`, 'debug');

        noToken.volume += decision.quantity;
        // Store probability price for history (for charts/TWAP)
        const currentPrice = getNOPrice(yesToken.tokenReserve, noToken.tokenReserve);
        noToken.history.push({ price: currentPrice, timestamp: Date.now() });
        if (noToken.history.length > 100) noToken.history.shift();
        updateTWAP(noToken);
      }
    } else {
      log('Trading', `[executeTrade] SELL condition failed: holdings=${holdings.toFixed(2)}, quantity=${decision.quantity}, tokenType=${decision.tokenType}`, 'warn');
    }
  } else if (decision.action !== 'hold') {
    log('Trading', `[executeTrade] Invalid action or quantity: action=${decision.action}, quantity=${decision.quantity}`, 'warn');
  }

  marketStrategy.timestamp = Date.now();
}

/**
 * Process a single trading round
 */
export async function processTradingRound(
  marketState: MarketState,
  agents: Agent[],
  tradingLoopInterval: { id: any }
): Promise<void> {
  // Wrap entire function in try-catch to ensure errors never stop the trading loop
  try {
    const currentTime = Date.now();
    const ROUND_GAP_MS = 15000;

    // Ensure isExecutingTrades is true if round is active (time hasn't expired)
    const roundIsActive = marketState.roundEndTime > 0 && currentTime < marketState.roundEndTime && marketState.roundStartTime > 0;
    if (roundIsActive && !marketState.isExecutingTrades) {
      marketState.isExecutingTrades = true;
      log('Trading', `Round #${marketState.roundNumber} is active - setting isExecutingTrades to true`);
    }

    if (marketState.lastRoundEndTime !== null) {
      const timeSinceLastRound = currentTime - marketState.lastRoundEndTime;
      if (timeSinceLastRound < ROUND_GAP_MS) {
        return;
      } else {
        marketState.lastRoundEndTime = null;
        log('Trading', `Gap period complete. Round #${marketState.roundNumber} trading active`);
      }
    }

    // Update market price - errors here shouldn't stop trading
    try {
      await updateMarketPrice(marketState);
    } catch (err) {
      log('Trading', `Market price update error (continuing): ${err}`, 'warn');
    }

    try {
      const { getAgentVUSDCBalance, getTokenBalance, getYesTokenAddress } = await import('../blockchain');
    const { getAgentTokenHoldings, updateAgentTokenHoldings } = await import('../agents');

    await Promise.all(agents.map(async (agent) => {
      const balance = await getAgentVUSDCBalance(agent.wallet.address);
      agent.vUSD = balance;

      for (const strategy of marketState.strategies) {
        if (!strategy.resolved) {
          try {
            const yesTokenAddress = await getYesTokenAddress(strategy.id);
            if (yesTokenAddress && yesTokenAddress !== '0x0000000000000000000000000000000000000000') {
              const currentOnChainBalance = await getTokenBalance(yesTokenAddress, agent.wallet.address);
              const inMemoryBalance = getAgentTokenHoldings(agent, strategy.id, 'yes');

              if (Math.abs(currentOnChainBalance - inMemoryBalance) > 0.000001) {
                updateAgentTokenHoldings(agent, strategy.id, 'yes', currentOnChainBalance - inMemoryBalance);
              }
            }
          } catch (e) { }
        }
      }
    }));
  } catch (err) {
    log('Trading', `Agent synchronization error: ${err}`, 'error');
  }

  const roundHasEnded = marketState.roundEndTime > 0 && currentTime >= marketState.roundEndTime;

  if (roundHasEnded) {
    const previousRoundNumber = marketState.roundNumber;
    resolveAllStrategies(marketState, true);

    const winningStrategy = marketState.strategies.find(s => s.resolved && s.winner === 'yes');
    if (winningStrategy) {
      log('Trading', `Round #${previousRoundNumber} finalized. Winner: ${winningStrategy.name} (YES TWAP: ${winningStrategy.yesToken.twap.toFixed(4)})`);
    }

    log('Trading', `Generating performance report for Round #${previousRoundNumber}`);

    if (winningStrategy) {
      graduateProposal(winningStrategy);
      const { graduateProposalOnChain } = await import('../blockchain');
      const { config } = await import('../core/config');
      try {
        const finalPrice = winningStrategy.winner === 'yes' ? 1.0 : 0.0;
        const txHash = await graduateProposalOnChain(winningStrategy.id, finalPrice);
        if (txHash) {
          log('Trading', `Successfully graduated strategy "${winningStrategy.name}" on-chain`);
          log('Trading', `Graduation confirmed: ${config.blockchain.blockExplorerUrl}/tx/${txHash}`, 'debug');
        } else {
          log('Trading', `On-chain graduation failed for "${winningStrategy.name}"`, 'error');
        }
      } catch (err) {
        log('Trading', `On-chain graduation failed for "${winningStrategy.name}": ${err}`, 'error');
      }
    }

    log('Market', 'Clearing active session data');
    marketState.strategies = [];
    agents.length = 0;
    marketState.roundStartTime = 0;
    marketState.roundEndTime = 0;
    marketState.roundNumber++;
    // Set isExecutingTrades to false when round ends
    marketState.isExecutingTrades = false;
    stopTradingLoop(tradingLoopInterval);
    return;
  }

  updateMarketPrice(marketState);
  resolveAllStrategies(marketState);

  const yesNoAgents = agents.filter(a => a.strategy === 'yes-no');
  const otherAgents = agents.filter(a => a.strategy !== 'yes-no');

  const shouldMakeBatchCall = (marketState.lastBatchLLMCallTime === null ||
    (currentTime - marketState.lastBatchLLMCallTime) >= BATCH_LLM_GAP_MS) &&
    !marketState.isMakingBatchLLMCall;

  // Always try to make decisions for yes-no agents, even if strategies are resolved
  // Use all strategies (not just unresolved) so fallback can still work near round end
  const strategiesForLLM = marketState.strategies.filter(s => !s.resolved);
  const allStrategiesForFallback = marketState.strategies.length > 0 ? marketState.strategies : [];

  if (yesNoAgents.length > 0 && shouldMakeBatchCall && !marketState.isExecutingTradeBatch) {
    // Try LLM batch call if there are unresolved strategies
    if (strategiesForLLM.length > 0) {
      marketState.lastBatchLLMCallTime = currentTime;
      marketState.isMakingBatchLLMCall = true;

      try {
        const { callLLMForAllAgents } = await import('../llm');
        log('Trading', `Orchestrating batch LLM analysis for ${yesNoAgents.length} agents across ${strategiesForLLM.length} active proposals`);
        const batchDecisions = await callLLMForAllAgents(yesNoAgents, marketState, strategiesForLLM);

        for (const [agentId, decision] of batchDecisions.entries()) {
          const agent = yesNoAgents.find(a => a.id === agentId);
          if (!agent) continue;

          agent.roundMemory.push({
            action: decision.action,
            strategyId: decision.strategyId,
            tokenType: decision.tokenType,
            quantity: decision.quantity,
            price: decision.price,
            reasoning: decision.reasoning,
            timestamp: currentTime,
          });

          if (agent.roundMemory.length > 100) agent.roundMemory.shift();

          if (decision.action !== 'hold') {
            marketState.tradeQueue.push({ decision, agent });
          }
        }

        for (const agent of yesNoAgents) {
          if (!batchDecisions.has(agent.id)) {
            // Use fallback strategy directly - don't retry LLM calls (already rate limited or batch failed)
            const { executeYesNoStrategyFallback } = await import('./strategies');
            const { selectStrategyForAgent } = await import('../agents');
            const marketStrategy = selectStrategyForAgent(agent, marketState);
            const fallbackDecision = marketStrategy 
              ? executeYesNoStrategyFallback(agent, marketState, marketStrategy)
              : {
                  agentId: agent.id,
                  action: 'hold' as const,
                  strategyId: '',
                  tokenType: 'yes' as const,
                  quantity: 0,
                  price: 0,
                  reasoning: 'No active strategies available',
                };

            agent.roundMemory.push({
              action: fallbackDecision.action,
              strategyId: fallbackDecision.strategyId,
              tokenType: fallbackDecision.tokenType,
              quantity: fallbackDecision.quantity,
              price: fallbackDecision.price,
              reasoning: fallbackDecision.reasoning,
              timestamp: currentTime,
            });

            if (agent.roundMemory.length > 100) agent.roundMemory.shift();

            if (fallbackDecision.action !== 'hold') {
              marketState.tradeQueue.push({ decision: fallbackDecision, agent });
            }
          }
        }

        executeQueuedTrades(marketState, agents).catch(err => {
          log('Trading', `Trade execution queue error: ${err}`, 'error');
          // Reset batch flag on error, but keep isExecutingTrades true (round is still active)
          marketState.isExecutingTradeBatch = false;
        });
      } catch (error) {
        // Log error but don't stop trading - market remains active
        log('Trading', `Batch LLM orchestration error (market remains active): ${error}`, 'error');
        // Continue with fallback strategies for ALL agents when LLM fails
        for (const agent of yesNoAgents) {
          try {
            const { executeYesNoStrategyFallback } = await import('./strategies');
            const { selectStrategyForAgent } = await import('../agents');
            
            // Try to get unresolved strategy first
            let marketStrategy = selectStrategyForAgent(agent, marketState);
            
            // If no unresolved strategies (near round end), use all strategies including resolved ones
            if (!marketStrategy && allStrategiesForFallback.length > 0) {
              const randomIndex = Math.floor(Math.random() * allStrategiesForFallback.length);
              marketStrategy = allStrategiesForFallback[randomIndex];
              log('Trading', `[${agent.personality.name}] LLM failed, no unresolved strategies, using resolved strategy "${marketStrategy.name}" for fallback`, 'debug');
            }
            
            if (marketStrategy) {
              const fallbackDecision = executeYesNoStrategyFallback(agent, marketState, marketStrategy);
              agent.roundMemory.push({
                action: fallbackDecision.action,
                strategyId: fallbackDecision.strategyId,
                tokenType: fallbackDecision.tokenType,
                quantity: fallbackDecision.quantity,
                price: fallbackDecision.price,
                reasoning: fallbackDecision.reasoning || 'LLM API failed, using fallback strategy',
                timestamp: currentTime,
              });
              if (agent.roundMemory.length > 100) agent.roundMemory.shift();
              if (fallbackDecision.action !== 'hold') {
                marketState.tradeQueue.push({ decision: fallbackDecision, agent });
              }
            }
          } catch (fallbackError) {
            log('Trading', `Fallback strategy error for ${agent.personality.name}: ${fallbackError}`, 'warn');
          }
        }
      } finally {
        marketState.isMakingBatchLLMCall = false;
      }
    }
    
    // ALWAYS execute fallback strategies for agents that didn't get LLM decisions
    // This ensures fallback runs even when:
    // 1. LLM batch call wasn't attempted (no unresolved strategies)
    // 2. LLM batch call failed (rate limit, etc.)
    // 3. Round is near completion (strategies resolved)
    if (yesNoAgents.length > 0 && !marketState.isMakingBatchLLMCall) {
      // Check which agents need fallback decisions
      const agentsNeedingFallback = yesNoAgents.filter(agent => {
        // Agent needs fallback if they don't have a recent decision in roundMemory
        const recentDecision = agent.roundMemory.find(m => 
          currentTime - m.timestamp < 10000 // Within last 10 seconds
        );
        return !recentDecision;
      });

      if (agentsNeedingFallback.length > 0 && allStrategiesForFallback.length > 0) {
        log('Trading', `Executing fallback strategies for ${agentsNeedingFallback.length} agents (${allStrategiesForFallback.length} strategies available)`);
        for (const agent of agentsNeedingFallback) {
          try {
            const { executeYesNoStrategyFallback } = await import('./strategies');
            const { selectStrategyForAgent } = await import('../agents');
            
            // Try to get unresolved strategy first
            let marketStrategy = selectStrategyForAgent(agent, marketState);
            
            // If no unresolved strategies (near round end), use all strategies including resolved ones
            if (!marketStrategy && allStrategiesForFallback.length > 0) {
              const randomIndex = Math.floor(Math.random() * allStrategiesForFallback.length);
              marketStrategy = allStrategiesForFallback[randomIndex];
              log('Trading', `[${agent.personality.name}] No unresolved strategies, using resolved strategy "${marketStrategy.name}" for fallback`, 'debug');
            }
            
            if (marketStrategy) {
              const fallbackDecision = executeYesNoStrategyFallback(agent, marketState, marketStrategy);
              agent.roundMemory.push({
                action: fallbackDecision.action,
                strategyId: fallbackDecision.strategyId,
                tokenType: fallbackDecision.tokenType,
                quantity: fallbackDecision.quantity,
                price: fallbackDecision.price,
                reasoning: fallbackDecision.reasoning || 'Using fallback strategy',
                timestamp: currentTime,
              });
              if (agent.roundMemory.length > 100) agent.roundMemory.shift();
              if (fallbackDecision.action !== 'hold') {
                marketState.tradeQueue.push({ decision: fallbackDecision, agent });
              }
            }
          } catch (fallbackError) {
            log('Trading', `Fallback strategy error for ${agent.personality.name}: ${fallbackError}`, 'warn');
          }
        }
        
        // Execute queued trades from fallback decisions
        if (marketState.tradeQueue.length > 0) {
          executeQueuedTrades(marketState, agents).catch(err => {
            log('Trading', `Fallback trade execution queue error: ${err}`, 'error');
            marketState.isExecutingTradeBatch = false;
          });
        }
      }
    }
  }

  // Process other agents (non-yes-no strategies) with error handling
  for (const agent of otherAgents) {
    try {
      const { executeStrategy } = await import('./strategies');
      const decision = await executeStrategy(agent, marketState);

      agent.roundMemory.push({
        action: decision.action,
        strategyId: decision.strategyId,
        tokenType: decision.tokenType,
        quantity: decision.quantity,
        price: decision.price,
        reasoning: decision.reasoning,
        timestamp: currentTime,
      });

      if (agent.roundMemory.length > 100) agent.roundMemory.shift();

      if (decision.action !== 'hold') {
        executeTrade(decision, agents, marketState);
      }
    } catch (error) {
      // Log error but continue processing other agents - market remains active
      log('Trading', `Error processing agent ${agent.personality.name} (market remains active): ${error}`, 'error');
    }
  }

    // Don't stop the trading loop even if all strategies are resolved early
    // The loop should continue until roundEndTime expires
    // This ensures the market remains active even if strategies resolve or API calls fail
    const allResolved = marketState.strategies.every(s => s.resolved);
    if (allResolved && marketState.strategies.length > 0) {
      log('Trading', `All strategies resolved, but continuing trading loop until round ends (${new Date(marketState.roundEndTime).toLocaleTimeString()})`);
    }
  } catch (error) {
    // Catch any unexpected errors - log but don't stop the trading loop
    // Market remains active as long as roundEndTime hasn't been reached
    log('Trading', `Unexpected error in processTradingRound (market remains active): ${error}`, 'error');
    // Reset flags to ensure loop continues
    marketState.isMakingBatchLLMCall = false;
    // Don't set isExecutingTrades to false - keep it true if round is still active
    const currentTime = Date.now();
    const roundIsActive = marketState.roundEndTime > 0 && currentTime < marketState.roundEndTime && marketState.roundStartTime > 0;
    if (!roundIsActive) {
      marketState.isExecutingTrades = false;
    }
  }
}

/**
 * Start trading loop
 */
export function startTradingLoop(
  marketState: MarketState,
  agents: Agent[],
  tradingLoopInterval: { id: any }
): void {
  if (tradingLoopInterval.id) {
    return;
  }

  log('Trading', `System heartbeat started (5s interval)`);
  tradingLoopInterval.id = setInterval(() => {
    processTradingRound(marketState, agents, tradingLoopInterval).catch(err => {
      log('Trading', `Round processing error: ${err}`, 'error');
    });
  }, 5000);
}

/**
 * Stop trading loop
 */
export function stopTradingLoop(tradingLoopInterval: { id: any }): void {
  if (tradingLoopInterval.id) {
    clearInterval(tradingLoopInterval.id);
    tradingLoopInterval.id = null;
    log('Trading', `System heartbeat terminated`);
  }
}
