import type { MarketStrategy } from './types';

// In-memory "database" for graduated proposals
export const graduatedProposals: MarketStrategy[] = [];

/**
 * Add a winning strategy to the graduated proposals list
 */
export function graduateProposal(strategy: MarketStrategy): void {
    console.log(`Graduating proposal: ${strategy.name}`);
    graduatedProposals.push({ ...strategy });
}

/**
 * Sync graduated proposals (usually from blockchain on startup)
 */
export function syncGraduatedProposals(strategies: MarketStrategy[]): void {
    console.log(`Syncing ${strategies.length} graduated proposals into database...`);
    strategies.forEach(s => {
        if (!graduatedProposals.find(p => p.id === s.id && p.timestamp === s.timestamp)) {
            graduatedProposals.push(s);
        }
    });
}

/**
 * Get all graduated proposals
 */
export function getGraduatedProposals(): MarketStrategy[] {
    return graduatedProposals;
}
