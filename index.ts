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
        
        // Hydrate in-memory history with on-chain graduated proposals
        try {
            const { fetchGraduatedProposalsOnChain } = await import('./src/blockchain');
            const { syncGraduatedProposals } = await import('./src/core/db');
            
            log('System', 'Fetching graduated proposals from blockchain...');
            const onChainGraduated = await fetchGraduatedProposalsOnChain();
            
            if (onChainGraduated.length > 0) {
                syncGraduatedProposals(onChainGraduated);
                log('System', `Hydrated ${onChainGraduated.length} graduated proposals from blockchain`);
            } else {
                log('System', 'No graduated proposals found on-chain');
            }
        } catch (error) {
            log('System', `Failed to hydrate graduated proposals: ${error}`, 'warn');
        }
        
        log('System', 'Ready for proposal generation via /api/admin/init');
    } else {
        log('System', 'Blockchain connectivity failed; entering simulation fallback mode', 'warn');
    }
});
