/**
 * OpenAI SDK Tools for Groq via OpenAI-Compatible API
 * 
 * This uses the OpenAI SDK with Groq's OpenAI-compatible endpoint
 * for proper tool/function calling support.
 * Groq supports function calling and is compatible with OpenAI's API format.
 */

import OpenAI from 'openai';
import type { Agent, MarketState, MarketStrategy } from '../core/types';
import { getYESPrice, getNOPrice } from '../engine/amm';
import { getAgentTokenHoldings } from '../agents';
import { log } from '../core/logger';
import {
    getAllDataSources,
    getDataSourceByTicker,
    getDataSourcesByType,
    fetchExchangeRate,
    fetchInflation,
    type DataSource,
} from './dataSources';

import { config } from '../core/config';

// Initialize OpenAI client with Groq's OpenAI-compatible endpoint
const GROQ_API_KEY = config.groq.apiKey;
const GROQ_MODEL = config.groq.model;

export const openai = new OpenAI({
    apiKey: GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    maxRetries: 0, // Disable built-in SDK retries to ensure immediate fallback as requested
});

/**
 * Response type from DIA Data API endpoints
 */
export interface DIADataResponse {
    Ticker: string;
    Name: string;
    Price: number;
    Timestamp: string;
}

/**
 * Fetch real-time price data from DIA Data API
 */
async function fetchDIAData(endpoint: string): Promise<DIADataResponse | null> {
    try {
        const response = await fetch(endpoint);
        if (!response.ok) {
            log('LLM', `DIA Data API request failed: ${response.status}`, 'error');
            return null;
        }
        return await response.json() as DIADataResponse;
    } catch (error) {
        log('LLM', `DIA Data API connection error: ${error instanceof Error ? error.message : error}`, 'error');
        return null;
    }
}

/**
 * OpenAI-format tool definitions for Groq
 */
export const OPENAI_TRADING_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'get_dia_prices',
            description: 'Get current real-time prices for one or more assets from DIA trusted data sources in a single batch call. Returns price, name, type, and last updated timestamp for each ticker. VALID TICKERS: SPY, QQQ, VOO, VTI, TLT, IBIT, FBTC, BTC, ETH, WTI, NG, XBR, CAD, AUD, CNY, GBP. Use ONLY these tickers.',
            parameters: {
                type: 'object',
                properties: {
                    tickers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Array of ticker symbols. VALID: SPY, QQQ, VOO, VTI, TLT, IBIT, FBTC, BTC, ETH, WTI, NG, XBR, CAD, AUD, CNY, GBP'
                    }
                },
                required: ['tickers']
            }
        }
    }
];

/**
 * Fetch batch DIA data for a list of tickers
 */
export async function fetchDIABatch(tickers: string[]): Promise<any[]> {
    return await Promise.all(
        tickers.map(async (ticker: string) => {
            const ds = getDataSourceByTicker(ticker.toUpperCase());
            if (!ds) return { ticker, error: 'Not found' };

            const liveData = await fetchDIAData(ds.endpoint);

            // Current time in ISO format for last updated
            const now = new Date().toISOString();

            if (!liveData) {
                return {
                    ticker: ds.ticker,
                    name: ds.name,
                    type: ds.type,
                    price: parseFloat(ds.price),
                    source: 'cached',
                    lastUpdated: now
                };
            }

            return {
                ticker: liveData.Ticker,
                name: liveData.Name,
                type: ds.type,
                price: liveData.Price,
                source: 'live',
                lastUpdated: liveData.Timestamp || now
            };
        })
    );
}

/**
 * Execute a tool call
 */
export async function executeOpenAIToolCall(
    name: string,
    args: any,
    agents: Agent[],
    marketState: MarketState
): Promise<string> {
    console.log(`[Tool] Executing: ${name}`, args);

    try {
        switch (name) {
            case 'get_dia_prices': {
                const { tickers } = args;
                if (!Array.isArray(tickers)) {
                    return JSON.stringify({ error: 'Tickers must be an array' });
                }

                const results = await fetchDIABatch(tickers);

                return JSON.stringify({
                    count: results.length,
                    prices: results
                });
            }

            default:
                return JSON.stringify({ error: `Unknown function: ${name}` });
        }
    } catch (error) {
        console.error(`[Tool] Error executing ${name}:`, error);
        return JSON.stringify({ error: `Failed: ${error instanceof Error ? error.message : 'Unknown'}` });
    }
}

/**
 * Handle multi-turn conversation with OpenAI SDK + Groq
 */
export async function handleOpenAIToolConversation(
    prompt: string,
    agents: Agent[],
    marketState: MarketState,
    maxIterations: number = 5
): Promise<string | null> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'user', content: prompt }
    ];

    let iteration = 0;
    const toolsUsed: string[] = [];

    console.log('\n===============================================================');
    console.log('TOOL-ENABLED CONVERSATION STARTED');
    console.log('===============================================================\n');

    while (iteration < maxIterations) {
        iteration++;
        console.log(`📡 [Iteration ${iteration}/${maxIterations}] Calling Groq via OpenAI SDK...`);

        try {
            const response = await openai.chat.completions.create({
                model: GROQ_MODEL,
                messages,
                tools: OPENAI_TRADING_TOOLS,
                tool_choice: 'auto'
            });

            const choice = response.choices[0];
            if (!choice) {
                console.error('No choice in response');
                return null;
            }
            const message = choice.message;

            // Check for tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                // Add assistant message with tool calls
                messages.push(message);

                console.log(`\n--- AI CALLED ${message.tool_calls.length} TOOL(S) ---`);

                // Process each tool call
                for (const toolCall of message.tool_calls) {
                    const fn = (toolCall as any).function;
                    if (!fn) continue;

                    const args = JSON.parse(fn.arguments || '{}');

                    // PROMINENT TOOL CALL LOG
                    console.log(`\n+-----------------------------------------------------+`);
                    console.log(`| TOOL CALL: ${fn.name.padEnd(40)} |`);
                    console.log(`+-----------------------------------------------------+`);
                    console.log(`| Arguments:                                         |`);
                    console.log(JSON.stringify(args, null, 2).replace(/^/gm, '| '));
                    console.log(`+-----------------------------------------------------+`);

                    toolsUsed.push(`${fn.name}(${JSON.stringify(args)})`);

                    const result = await executeOpenAIToolCall(
                        fn.name,
                        args,
                        agents,
                        marketState
                    );

                    console.log(`   📤 Result (${result.length} chars):`);
                    console.log(result.length > 500 ? result.substring(0, 500) + '...' : result);

                    // Add tool result
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: result
                    });
                }
                // Loop continues for the next turn
            } else {
                // No tool calls - return final text
                const finalText = message.content || '';

                console.log('\n===============================================================');
                console.log(`CONVERSATION COMPLETE - ${toolsUsed.length} TOOL(S) USED:`);
                if (toolsUsed.length > 0) {
                    toolsUsed.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
                } else {
                    console.log('   (No tools were called)');
                }
                console.log('===============================================================\n');

                console.log('📝 Final Response Length:', finalText.length, 'chars');
                return finalText;
            }
        } catch (error) {
            console.error('[OpenAI Tool Conversation] Error:', error);
            return null;
        }
    }

    console.warn('Max iterations reached without final response');
    console.log(`🔧 Tools used before timeout: ${toolsUsed.join(', ')}`);
    return null;
}

/**
 * Simple chat completion without tools
 */
export async function simpleGroqCompletion(prompt: string): Promise<string | null> {
    try {
        const response = await openai.chat.completions.create({
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: prompt }]
        });

        return response.choices[0]?.message?.content || null;
    } catch (error) {
        console.error('[Groq Completion] Error:', error);
        return null;
    }
}
