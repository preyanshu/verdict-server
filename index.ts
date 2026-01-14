import { initializeMarket } from './src/engine/market';
import { initializeAgents } from './src/agents';
import { getYESPrice, getNOPrice } from './src/engine/amm';
import { createServer } from './src/server';
import { initBlockchain } from './src/blockchain';
import { log } from './src/core/logger';

// Initialize market and agents (start empty)
const marketState = initializeMarket();
const agents = initializeAgents();

// Trading loop interval tracker
const tradingLoopInterval = { id: null as any };

// Create and start server
const server = createServer(agents, marketState, tradingLoopInterval);

log('System', 'Infrastructure initialized in latent state; awaiting proposal generation');

// Initialize blockchain connection
log('System', 'Establishing blockchain connection layer...');
initBlockchain().then(async success => {
    if (success) {
        log('System', 'Blockchain connectivity established');

        // Fetch graduated proposals from contract on startup
        try {
            const { fetchGraduatedProposalsOnChain } = await import('./src/blockchain');
            const { syncGraduatedProposals } = await import('./src/core/db');

            const historicalGraduated = await fetchGraduatedProposalsOnChain();
            if (historicalGraduated.length > 0) {
                syncGraduatedProposals(historicalGraduated);
                log('System', `Synchronized ${historicalGraduated.length} historical graduated proposals from on-chain state`);
            } else {
                log('System', 'No historical graduated proposals detected on-chain');
            }
        } catch (err) {
            log('System', `Historical state synchronization error: ${err}`, 'error');
        }
    } else {
        log('System', 'Blockchain connectivity failed; entering simulation fallback mode', 'warn');
    }
});
