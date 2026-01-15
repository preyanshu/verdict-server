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
        log('System', 'Ready for proposal generation via /api/admin/init');
    } else {
        log('System', 'Blockchain connectivity failed; entering simulation fallback mode', 'warn');
    }
});
