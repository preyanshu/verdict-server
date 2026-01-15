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
 * Preserves usedDataSources from existing in-memory proposals if available
 */
export function syncGraduatedProposals(strategies: MarketStrategy[]): void {
    console.log(`Syncing ${strategies.length} graduated proposals into database...`);
    strategies.forEach(s => {
        const existing = graduatedProposals.find(p => p.id === s.id);
        if (existing) {
            // Preserve usedDataSources from existing in-memory proposal if blockchain version is empty
            if (existing.usedDataSources && existing.usedDataSources.length > 0 && 
                (!s.usedDataSources || s.usedDataSources.length === 0)) {
                s.usedDataSources = existing.usedDataSources;
            }
            // Update other fields from blockchain version
            Object.assign(existing, s);
        } else {
            // New proposal, add it
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
