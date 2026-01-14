import type { MarketStrategy, MarketState } from '../core/types';

/**
 * Calculate TWAP (Time-Weighted Average Price) from price history
 */
export function calculateTWAP(history: Array<{ price: number; timestamp: number }>): number {
  if (history.length < 2) {
    return history.length === 1 ? (history[0]?.price ?? 0.5) : 0.5;
  }

  let totalWeightedPrice = 0;
  let totalWeight = 0;

  for (let i = 1; i < history.length; i++) {
    const current = history[i];
    const previous = history[i - 1];
    if (!current || !previous) continue;

    const timeDiff = current.timestamp - previous.timestamp;
    if (timeDiff <= 0) continue;

    // Weight by time duration
    const weight = timeDiff;
    totalWeightedPrice += current.price * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalWeightedPrice / totalWeight : 0.5;
}

/**
 * Update TWAP for a strategy token
 */
export function updateTWAP(token: MarketStrategy['yesToken']): void {
  const twap = calculateTWAP(token.history);
  token.twap = twap;
  token.twapHistory.push({ twap, timestamp: Date.now() });

  // Keep TWAP history to last 100 points
  if (token.twapHistory.length > 100) {
    token.twapHistory.shift();
  }
}

/**
 * Resolve all strategies - only ONE strategy can win
 * The winning strategy is the one with the highest YES TWAP (most market confidence)
 * Resolves when round time has elapsed (15 minutes)
 */
export function resolveAllStrategies(market: MarketState, forceResolve: boolean = false): void {
  // Check if already resolved
  const alreadyResolved = market.strategies.some(s => s.resolved);
  if (alreadyResolved) return;

  // Update TWAPs for all strategies
  for (const strategy of market.strategies) {
    updateTWAP(strategy.yesToken);
    updateTWAP(strategy.noToken);
  }

  // Check if round has ended (15 minutes elapsed) or force resolve
  const currentTime = Date.now();
  const roundHasEnded = currentTime >= market.roundEndTime;

  if (!forceResolve && !roundHasEnded) {
    return; // Round hasn't ended yet, don't resolve
  }

  // Find the strategy with the highest YES TWAP (most market confidence)
  let winningStrategy: MarketStrategy | null = null;
  let highestYesTWAP = -1;

  for (const strategy of market.strategies) {
    if (strategy.yesToken.twap > highestYesTWAP) {
      highestYesTWAP = strategy.yesToken.twap;
      winningStrategy = strategy;
    }
  }

  // Resolve: mark winning strategy, mark others as losers
  if (winningStrategy) {
    for (const strategy of market.strategies) {
      strategy.resolved = true;
      if (strategy.id === winningStrategy!.id) {
        // Winner: YES token wins (highest YES TWAP)
        strategy.winner = 'yes';
      } else {
        // Loser: NO token wins (this strategy didn't win)
        strategy.winner = 'no';
      }
    }
  }
}

