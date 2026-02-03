import {
  getAllDataSources,
  getDataSourceById,
  validateCurrencyPair,
  SUPPORTED_EXCHANGE_RATE_CURRENCIES,
  fetchExchangeRate as getExchangeRate, // Alias to avoid confusion
} from '../llm/dataSources';
import {
  getGraduatedProposals,
} from '../core/db';
import { getLogs } from '../core/logger';
import type { Agent, MarketState } from '../core/types';

/**
 * Create API server
 */
export function createServer(
  agents: Agent[],
  marketState: MarketState,
  tradingLoopInterval: { id: any }
) {
  return Bun.serve({
    port: 3000,
    idleTimeout: 120, // 120 seconds timeout for long-running operations like balance reset
    async fetch(req) {
      const url = new URL(req.url);

      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Serve static files
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(Bun.file('public/index.html'), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      if (url.pathname === '/app.js') {
        return new Response(Bun.file('public/app.js'), {
          headers: { 'Content-Type': 'application/javascript' },
        });
      }

      if (url.pathname === '/styles.css') {
        return new Response(Bun.file('public/styles.css'), {
          headers: { 'Content-Type': 'text/css' },
        });
      }

      // API Endpoints
      if (url.pathname === '/api/data-sources' && req.method === 'GET') {
        return new Response(JSON.stringify(getAllDataSources()), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/data-sources/ticker' && req.method === 'GET') {
        const ticker = url.searchParams.get('ticker');
        if (!ticker) {
          return new Response(JSON.stringify({ error: 'Ticker required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { getDataSourceByTicker } = await import('../llm/dataSources');
        const ds = getDataSourceByTicker(ticker.toUpperCase());
        if (ds) {
          return new Response(JSON.stringify(ds), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: 'Ticker not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname.startsWith('/api/data-sources/') && req.method === 'GET') {
        const id = parseInt(url.pathname.split('/').pop() || '0');
        const ds = getDataSourceById(id);

        if (ds) {
          // If live data requested
          if (url.searchParams.get('live') === 'true') {
            try {
              const response = await fetch(ds.endpoint);
              const liveData = await response.json();
              return new Response(JSON.stringify({ ...ds, liveData }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
            } catch (error) {
              return new Response(
                JSON.stringify({ ...ds, error: 'Failed to fetch live data' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }

          return new Response(JSON.stringify(ds), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: 'Data source not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fetch exchange rate from API Ninjas
      if (url.pathname === '/api/exchange-rate' && req.method === 'GET') {
        const pair = url.searchParams.get('pair');
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        const apiKey = url.searchParams.get('apiKey') || undefined;

        let result = null;
        let validationError: string | null = null;

        if (pair) {
          // Use pair format (e.g., USD_GBP)
          const parts = pair.split('_');
          const t1 = parts[0];
          const t2 = parts[1];
          if (t1 && t2) {
            validationError = validateCurrencyPair(t1, t2);
            if (!validationError) {
              result = await getExchangeRate(pair, apiKey);
            }
          } else {
            return new Response(
              JSON.stringify({
                error: 'Invalid pair format. Expected: CURRENCY1_CURRENCY2 (e.g., USD_GBP)',
                supported_currencies: Object.entries(SUPPORTED_EXCHANGE_RATE_CURRENCIES).map(
                  ([code, info]) => ({
                    code,
                    name: info.name,
                  })
                ),
              }),
              {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              }
            );
          }
        } else if (from && to) {
          // Use from/to format (e.g., from=USD&to=GBP)
          validationError = validateCurrencyPair(from, to);
          if (!validationError) {
            result = await getExchangeRate(`${from}_${to}`, apiKey);
          }
        } else {
          return new Response(
            JSON.stringify({
              error:
                'Missing parameters. Provide either ?pair=CURRENCY1_CURRENCY2 or ?from=CURRENCY1&to=CURRENCY2',
              supported_currencies: Object.entries(SUPPORTED_EXCHANGE_RATE_CURRENCIES).map(
                ([code, info]) => ({
                  code,
                  name: info.name,
                })
              ),
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        if (validationError) {
          return new Response(
            JSON.stringify({
              error: validationError,
              supported_currencies: Object.entries(SUPPORTED_EXCHANGE_RATE_CURRENCIES).map(
                ([code, info]) => ({
                  code,
                  name: info.name,
                })
              ),
            }),
            {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        if (result) {
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: 'Failed to fetch exchange rate' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get market state
      if (url.pathname === '/api/market' && req.method === 'GET') {
        const { getYESPrice, getNOPrice, getYESPriceInVUSD } = await import('../engine/amm');
        const enrichedStrategies = marketState.strategies.map((s) => {
          // Note: yesPrice/noPrice are probabilities (0-1), not vUSD prices
          const yesPriceProb = getYESPrice(s.yesToken.tokenReserve, s.noToken.tokenReserve);
          const noPriceProb = getNOPrice(s.yesToken.tokenReserve, s.noToken.tokenReserve);
          // Calculate actual vUSD price per YES token for swaps
          const yesPriceVUSD = getYESPriceInVUSD(s.noToken.tokenReserve, s.yesToken.tokenReserve);
          return {
            ...s,
            yesPrice: yesPriceProb, // Probability (0-1)
            noPrice: noPriceProb, // Probability (0-1)
            yesPriceVUSD: yesPriceVUSD, // Actual vUSD price per YES token for swaps
          };
        });

        // Market is active if roundEndTime hasn't been reached (time-based only)
        const now = Date.now();
        const isActive = marketState.roundEndTime > 0 && now < marketState.roundEndTime && marketState.roundStartTime > 0;

        return new Response(
          JSON.stringify({
            ...marketState,
            strategies: enrichedStrategies,
            isActive: isActive, // Explicitly include isActive based on time only
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Get agents
      if (url.pathname === '/api/agents' && req.method === 'GET') {
        const { getAgentVUSDCBalance } = await import('../blockchain');
        const { getYESPrice, getNOPrice } = await import('../engine/amm');
        const agentsData = await Promise.all(
          agents.map(async (agent) => {
            const onChainVUSD = await getAgentVUSDCBalance(agent.wallet.address);

            // Calculate total value
            const totalValue = onChainVUSD + agent.tokenHoldings.reduce((sum, holding) => {
              const strategy = marketState.strategies.find(s => s.id === holding.strategyId);
              if (!strategy) return sum;
              const price = holding.tokenType === 'yes'
                ? getYESPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve)
                : getNOPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
              return sum + (holding.quantity * price);
            }, 0);

            return {
              ...agent,
              vUSD: onChainVUSD,
              totalValue: totalValue,
              tradeCount: agent.trades.length,
              trades: agent.trades,
            };
          })
        );
        return new Response(JSON.stringify(agentsData), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get specific agent
      if (url.pathname.startsWith('/api/agents/') && req.method === 'GET') {
        const id = url.pathname.split('/').pop();
        const agent = agents.find((a) => a.id === id);
        if (agent) {
          const { getAgentVUSDCBalance } = await import('../blockchain');
          const { getYESPrice, getNOPrice } = await import('../engine/amm');
          const onChainVUSD = await getAgentVUSDCBalance(agent.wallet.address);

          // Calculate total value
          const totalValue = onChainVUSD + agent.tokenHoldings.reduce((sum, holding) => {
            const strategy = marketState.strategies.find(s => s.id === holding.strategyId);
            if (!strategy) return sum;
            const price = holding.tokenType === 'yes'
              ? getYESPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve)
              : getNOPrice(strategy.yesToken.tokenReserve, strategy.noToken.tokenReserve);
            return sum + (holding.quantity * price);
          }, 0);

          return new Response(
            JSON.stringify({
              ...agent,
              vUSD: onChainVUSD,
              totalValue: totalValue,
              tradeCount: agent.trades.length,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        return new Response(JSON.stringify({ error: 'Agent not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get history (graduated proposals)
      if ((url.pathname === '/api/history' || url.pathname === '/api/graduated') && req.method === 'GET') {
        const graduated = getGraduatedProposals();
        return new Response(JSON.stringify(graduated), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Inject a custom proposal (before trading starts)
      if (url.pathname === '/api/proposal/inject' && req.method === 'POST') {
        try {
          // Check if AI agents have generated proposals first
          if (marketState.strategies.length === 0) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'Cannot inject proposals before AI agents generate their proposals. Call /api/admin/init or /api/init/proposals first.' 
              }),
              { 
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          // Check if trading has started
          if (tradingLoopInterval.id !== null) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'Cannot inject proposals while trading is active' 
              }),
              { 
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          const body = await req.json() as {
            name?: string;
            description?: string;
            evaluationLogic?: string;
            mathematicalLogic?: string;
            usedDataSources?: any[];
            resolutionDeadline?: number;
            initialLiquidity?: number;
          };
          const { name, description, evaluationLogic, mathematicalLogic, usedDataSources, resolutionDeadline, initialLiquidity } = body;

          // Validate required fields
          if (!name || !description || !evaluationLogic || !mathematicalLogic) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'Missing required fields: name, description, evaluationLogic, mathematicalLogic' 
              }),
              { 
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          // Validate usedDataSources structure (must match AI-generated format)
          if (!Array.isArray(usedDataSources) || usedDataSources.length === 0) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'usedDataSources must be a non-empty array with data source objects' 
              }),
              { 
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          // Validate each data source has required fields
          for (const ds of usedDataSources) {
            if (typeof ds.id !== 'number' || 
                typeof ds.currentValue !== 'number' || 
                typeof ds.targetValue !== 'number' ||
                typeof ds.operator !== 'string') {
              return new Response(
                JSON.stringify({ 
                  success: false, 
                  error: 'Each usedDataSource must have: id (number), currentValue (number), targetValue (number), operator (string)' 
                }),
                { 
                  status: 400,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
                }
              );
            }
          }

          const { createProposalOnChain } = await import('../blockchain');
          
          // Generate unique ID for the proposal
          const proposalId = `custom-${Date.now()}-${Math.random().toString(36).substring(7)}`;
          
          // Default values
          const deadline = resolutionDeadline || Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days default
          const liquidity = initialLiquidity || 2000; // 2000 vUSDC default

          // Create proposal on-chain
          const result = await createProposalOnChain(
            proposalId,
            name,
            description,
            evaluationLogic,
            mathematicalLogic,
            deadline,
            liquidity
          );

          if (!result) {
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: 'Failed to create proposal on-chain' 
              }),
              { 
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              }
            );
          }

          // Add proposal to in-memory market state (matching AI-generated format exactly)
          const now = Date.now();
          const newStrategy = {
            id: proposalId,
            name,
            description,
            evaluationLogic,
            mathematicalLogic,
            usedDataSources: usedDataSources, // Required array with proper structure
            resolutionDeadline: deadline,
            timestamp: now,
            resolved: false,
            winner: null,
            yesToken: {
              tokenReserve: liquidity,
              volume: 0,
              history: [{ price: 0.5, timestamp: now }],
              twap: 0.5,
              twapHistory: [{ twap: 0.5, timestamp: now }]
            },
            noToken: {
              tokenReserve: liquidity,
              volume: 0,
              history: [{ price: 0.5, timestamp: now }],
              twap: 0.5,
              twapHistory: [{ twap: 0.5, timestamp: now }]
            }
          };

          marketState.strategies.push(newStrategy);

          return new Response(
            JSON.stringify({
              success: true,
              message: 'Proposal injected successfully',
              proposal: {
                id: proposalId,
                name,
                yesToken: result.yesToken,
                poolId: result.poolId,
                txHash: result.txHash
              }
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: error.message 
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      // Admin: Initialize market (Generate strategies and agents)
      if (url.pathname === '/api/admin/init' && req.method === 'POST') {
        try {
          const { generateAndSetStrategies } = await import('../engine/market');
          const { generateAndSetAgents } = await import('../agents');

          // 1. Generate strategies and update market state
          await generateAndSetStrategies(marketState);

          // 2. Generate agents and update agents array (handles on-chain registration)
          await generateAndSetAgents(agents);

          return new Response(
            JSON.stringify({
              success: true,
              message: 'Market and agents initialized',
              strategiesCount: marketState.strategies.length,
              agentsCount: agents.length,
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Handle individual init steps from frontend
      if (url.pathname === '/api/init/proposals' && req.method === 'POST') {
        try {
          const { generateAndSetStrategies } = await import('../engine/market');
          await generateAndSetStrategies(marketState);
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Proposals generated',
              count: marketState.strategies.length,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.pathname === '/api/init/agents' && req.method === 'POST') {
        try {
          const { generateAndSetAgents } = await import('../agents');
          await generateAndSetAgents(agents);
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Agents generated',
              count: agents.length,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      if (url.pathname === '/api/trade/start' && req.method === 'POST') {
        try {
          const { startTradingLoop } = await import('../engine/trading');
          const { resetAgentBalancesTo100, getAgentVUSDCBalance } = await import('../blockchain');
          const { log } = await import('../core/logger');

          if (marketState.roundStartTime === 0) {
            // Set roundStartTime FIRST to prevent concurrent calls
            marketState.roundStartTime = Date.now();
            marketState.roundEndTime = marketState.roundStartTime + marketState.roundDuration;
            // Reset rate limit flag for new round
            marketState.isLLMRateLimited = false;
            // Set isExecutingTrades to true for the entire round duration
            marketState.isExecutingTrades = true;

            // New round starting - reset agent balances to 100 vUSDC
            if (agents.length > 0) {
              log('Trading', `Resetting ${agents.length} agent balances to 100 vUSDC for new round...`);
              try {
                const resetResult = await resetAgentBalancesTo100(agents);
                if (resetResult.success) {
                  log('Trading', `✅ Agent balances reset to 100 vUSDC via batch contract function`);
                  if (resetResult.txHash) {
                    log('Trading', `   Transaction: ${resetResult.txHash}`, 'debug');
                  }
                  
                  // Verify all balances are reset (wait a bit for blockchain to update)
                  log('Trading', `Verifying agent balances...`);
                  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds for blockchain to update
                  
                  let allBalancesReset = true;
                  for (const agent of agents) {
                    const balance = await getAgentVUSDCBalance(agent.wallet.address);
                    if (Math.abs(balance - 100) > 0.1) {
                      log('Trading', `⚠️ ${agent.personality.name} balance is ${balance.toFixed(2)}, expected ~100`, 'warn');
                      allBalancesReset = false;
                    }
                  }
                  
                  if (allBalancesReset) {
                    log('Trading', `✅ All agent balances verified at 100 vUSDC`);
                  } else {
                    log('Trading', `⚠️ Some agent balances may not be exactly 100, but proceeding`, 'warn');
                  }
                } else {
                  log('Trading', `⚠️ Balance reset failed, continuing anyway`, 'warn');
                }
              } catch (error: any) {
                log('Trading', `⚠️ Balance reset failed: ${error.message}, continuing anyway`, 'warn');
              }
            }
          }

          // Start trading loop AFTER balance reset is complete
          startTradingLoop(marketState, agents, tradingLoopInterval);
          
          return new Response(
            JSON.stringify({
              success: true,
              message: 'Trading started',
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      // Admin: Stop trading
      if (url.pathname === '/api/admin/stop' && req.method === 'POST') {
        if (tradingLoopInterval.id) {
          clearInterval(tradingLoopInterval.id);
          tradingLoopInterval.id = null;
        }
        return new Response(JSON.stringify({ success: true, message: 'Trading stopped' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get system logs
      if (url.pathname === '/api/logs' && req.method === 'GET') {
        const logs = getLogs();
        return new Response(JSON.stringify(logs), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Health check
      if (url.pathname === '/health' && req.method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
}
