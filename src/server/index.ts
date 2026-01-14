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
        const { getYESPrice, getNOPrice } = await import('../engine/amm');
        const enrichedStrategies = marketState.strategies.map((s) => ({
          ...s,
          yesPrice: getYESPrice(s.yesToken.tokenReserve, s.noToken.tokenReserve),
          noPrice: getNOPrice(s.yesToken.tokenReserve, s.noToken.tokenReserve),
        }));

        return new Response(
          JSON.stringify({
            ...marketState,
            strategies: enrichedStrategies,
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

          if (marketState.roundStartTime === 0) {
            marketState.roundStartTime = Date.now();
            marketState.roundEndTime = marketState.roundStartTime + marketState.roundDuration;
          }

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
