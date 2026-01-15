// Virtual Token Minting AMM
// Model: 1 vUSD → 1 YES + 1 NO (1:1:1 minting ratio)
// YES and NO tokens trade against each other, maintaining YES + NO ≈ 1.0

/**
 * Calculate YES token price from reserves
 * Price of YES = NO tokens / YES tokens
 * This ensures YES + NO ≈ 1.0
 */
export function getYESPrice(yesTokenReserve: number, noTokenReserve: number): number {
  if (yesTokenReserve === 0) return 0.5; // Default if empty
  return noTokenReserve / (yesTokenReserve + noTokenReserve);
}

/**
 * Calculate NO token price from reserves
 * Price of NO = YES tokens / (YES tokens + NO tokens)
 */
export function getNOPrice(yesTokenReserve: number, noTokenReserve: number): number {
  if (noTokenReserve === 0) return 0.5; // Default if empty
  return yesTokenReserve / (yesTokenReserve + noTokenReserve);
}

/**
 * Mint decision tokens: Burn 1 vUSD → Mint 1 YES + 1 NO
 * This maintains the 1:1:1 ratio
 */
export function mintDecisionTokens(
  vUSDAmount: number,
  yesTokenReserve: number,
  noTokenReserve: number
): { yesTokensOut: number; noTokensOut: number } {
  // 1 vUSD → 1 YES + 1 NO
  return {
    yesTokensOut: vUSDAmount,
    noTokensOut: vUSDAmount,
  };
}

/**
 * Calculate how many NO tokens you get for YES tokens (selling YES for NO)
 * Uses constant product: YES * NO = k
 */
export function calculateNOForYES(
  yesTokensIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (yesTokenReserve === 0 || noTokenReserve === 0 || yesTokensIn <= 0) return 0;
  const k = yesTokenReserve * noTokenReserve; // Constant product
  const newYesReserve = yesTokenReserve + yesTokensIn;
  const newNoReserve = k / newYesReserve;
  return noTokenReserve - newNoReserve;
}

/**
 * Calculate how many YES tokens you get for NO tokens (selling NO for YES)
 * Uses constant product: YES * NO = k
 */
export function calculateYESForNO(
  noTokensIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (yesTokenReserve === 0 || noTokenReserve === 0 || noTokensIn <= 0) return 0;
  const k = yesTokenReserve * noTokenReserve; // Constant product
  const newNoReserve = noTokenReserve + noTokensIn;
  const newYesReserve = k / newNoReserve;
  return yesTokenReserve - newYesReserve;
}

/**
 * Calculate how many YES tokens you get when buying with vUSD
 * First mints YES+NO tokens, then swaps NO for more YES
 */
export function calculateYESForVUSD(
  vUSDIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (vUSDIn <= 0) return 0;
  
  // Step 1: Mint 1 YES + 1 NO for each vUSD
  const mintedYES = vUSDIn;
  const mintedNO = vUSDIn;
  
  // Step 2: Swap the minted NO tokens for more YES tokens
  const additionalYES = calculateYESForNO(mintedNO, yesTokenReserve + mintedYES, noTokenReserve);
  
  return mintedYES + additionalYES;
}

/**
 * Calculate how many NO tokens you get when buying with vUSD
 * First mints YES+NO tokens, then swaps YES for more NO
 */
export function calculateNOForVUSD(
  vUSDIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (vUSDIn <= 0) return 0;
  
  // Step 1: Mint 1 YES + 1 NO for each vUSD
  const mintedYES = vUSDIn;
  const mintedNO = vUSDIn;
  
  // Step 2: Swap the minted YES tokens for more NO tokens
  const additionalNO = calculateNOForYES(mintedYES, yesTokenReserve, noTokenReserve + mintedNO);
  
  return mintedNO + additionalNO;
}

/**
 * Calculate vUSD you get when selling YES tokens
 * Swaps YES for NO, then burns NO+YES to get vUSD back
 */
export function calculateVUSDForYES(
  yesTokensIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (yesTokensIn <= 0 || yesTokenReserve === 0 || noTokenReserve === 0) return 0;
  
  // Step 1: Swap YES tokens for NO tokens
  const noTokensReceived = calculateNOForYES(yesTokensIn, yesTokenReserve, noTokenReserve);
  
  // Step 2: Burn NO tokens to get vUSD (1 NO → 1 vUSD, but we need matching YES)
  // Actually, we need to find matching YES tokens to burn
  // For simplicity, we'll use the NO tokens received as the vUSD amount
  // In a real system, you'd need matching YES tokens to burn together
  
  // Simplified: Use the NO tokens as vUSD (since 1 NO + 1 YES = 1 vUSD)
  // But we need to account for the YES we're selling
  // The vUSD returned = min(yesTokensIn, noTokensReceived) since we need pairs
  return Math.min(yesTokensIn, noTokensReceived);
}

/**
 * Calculate vUSD you get when selling NO tokens
 * Swaps NO for YES, then burns YES+NO to get vUSD back
 */
export function calculateVUSDForNO(
  noTokensIn: number,
  yesTokenReserve: number,
  noTokenReserve: number
): number {
  if (noTokensIn <= 0 || yesTokenReserve === 0 || noTokenReserve === 0) return 0;
  
  // Step 1: Swap NO tokens for YES tokens
  const yesTokensReceived = calculateYESForNO(noTokensIn, yesTokenReserve, noTokenReserve);
  
  // Step 2: Burn YES+NO pairs to get vUSD
  // Simplified: Use the minimum of what we have
  return Math.min(noTokensIn, yesTokensReceived);
}

/**
 * Calculate how many YES tokens you get for a given amount of vUSD
 * Uses the same constant product formula as the contract
 * @param vUSDIn Amount of vUSD to swap
 * @param vUSDReserve Current vUSDC reserve in the pool
 * @param yesReserve Current YES token reserve in the pool
 * @returns Number of YES tokens received
 */
export function calculateYESForVUSDSwap(
  vUSDIn: number,
  vUSDReserve: number,
  yesReserve: number
): number {
  if (vUSDIn <= 0 || vUSDReserve <= 0 || yesReserve <= 0) return 0;
  
  // Contract constants
  const FEE_BPS = 30;
  const BPS_DENOMINATOR = 10000;
  
  // Work with BigInt for precision (values are in wei = 18 decimals)
  // Use string conversion to avoid precision loss
  const amountInWei = BigInt(Math.floor(vUSDIn * 1e18));
  const reserveInWei = BigInt(Math.floor(vUSDReserve * 1e18));
  const reserveOutWei = BigInt(Math.floor(yesReserve * 1e18));
  
  // Contract formula: amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS)
  // Note: This is NOT divided by BPS_DENOMINATOR yet - that happens in the denominator
  const amountInWithFee = amountInWei * BigInt(BPS_DENOMINATOR - FEE_BPS);
  
  // Contract formula: amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee)
  const numerator = amountInWithFee * reserveOutWei;
  const denominator = reserveInWei * BigInt(BPS_DENOMINATOR) + amountInWithFee;
  
  // Avoid division by zero
  if (denominator === 0n) return 0;
  
  const amountOutWei = numerator / denominator;
  
  // Convert back to number (divide by 1e18)
  // Use Number() conversion which handles BigInt correctly
  return Number(amountOutWei) / 1e18;
}

/**
 * Calculate the effective vUSD price per YES token
 * This is the actual price you pay when swapping vUSD for YES tokens
 * @param vUSDReserve Current vUSDC reserve in the pool
 * @param yesReserve Current YES token reserve in the pool
 * @returns Price in vUSD per YES token
 */
export function getYESPriceInVUSD(vUSDReserve: number, yesReserve: number): number {
  if (yesReserve === 0 || vUSDReserve === 0) return 1.0; // Default to 1:1 if no liquidity
  
  // Calculate how many YES tokens you get for 1 vUSD
  const yesTokensFor1VUSD = calculateYESForVUSDSwap(1.0, vUSDReserve, yesReserve);
  
  if (yesTokensFor1VUSD === 0) return 1.0;
  
  // Price per YES token = 1 vUSD / YES tokens received
  return 1.0 / yesTokensFor1VUSD;
}

/**
 * Calculate how many vUSD you get for selling YES tokens
 * Uses the same constant product formula as the contract
 * @param yesTokensIn Amount of YES tokens to sell
 * @param vUSDReserve Current vUSDC reserve in the pool
 * @param yesReserve Current YES token reserve in the pool
 * @returns Amount of vUSD received
 */
export function calculateVUSDForYESSwap(
  yesTokensIn: number,
  vUSDReserve: number,
  yesReserve: number
): number {
  if (yesTokensIn <= 0 || vUSDReserve <= 0 || yesReserve <= 0) return 0;
  
  // Contract constants
  const FEE_BPS = 30;
  const BPS_DENOMINATOR = 10000;
  
  // Work with BigInt for precision
  const amountInWei = BigInt(Math.floor(yesTokensIn * 1e18));
  const reserveInWei = BigInt(Math.floor(yesReserve * 1e18));
  const reserveOutWei = BigInt(Math.floor(vUSDReserve * 1e18));
  
  // Contract formula: amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS)
  const amountInWithFee = amountInWei * BigInt(BPS_DENOMINATOR - FEE_BPS);
  
  // Contract formula: amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee)
  const numerator = amountInWithFee * reserveOutWei;
  const denominator = reserveInWei * BigInt(BPS_DENOMINATOR) + amountInWithFee;
  
  if (denominator === 0n) return 0;
  const amountOutWei = numerator / denominator;
  
  return Number(amountOutWei) / 1e18;
}

// Legacy function names for backward compatibility (will be updated in strategies)
export function getAMMPrice(vUSDReserve: number, tokenReserve: number): number {
  // This is a legacy function - should use getYESPrice/getNOPrice instead
  if (tokenReserve === 0) return 0.5;
  return vUSDReserve / (vUSDReserve + tokenReserve);
}
