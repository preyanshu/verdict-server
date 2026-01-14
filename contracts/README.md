# Prediction Market Smart Contracts

## Complete Contract Architecture

### Contracts Overview

| Contract | Purpose | Deployed By |
|----------|---------|-------------|
| **vUSDC.sol** | Virtual USD token for trading | Once |
| **YESToken.sol** | YES outcome token template | Factory (per proposal) |
| **YESTokenFactory.sol** | Creates YES tokens for proposals | Once |
| **MarketRegistry.sol** | Stores proposals + graduated winners | Once |
| **PredictionMarketHook.sol** | Uniswap V4 hook for swap validation | Once |
| **PredictionMarket.sol** | Main orchestrator (backend calls this) | Once |

### Pool Architecture (Per Proposal)

```
┌─────────────────────────────────────────────────────────┐
│                   PROPOSAL (e.g., "SPY > $700")         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────────┐         ┌──────────────────────┐    │
│   │   vUSDC      │ ◄─────► │  Uniswap V4 Pool     │    │
│   │   (ERC20)    │         │  (PoolManager)        │    │
│   └──────────────┘         └──────────────────────┘    │
│          │                          │                   │
│          │                          │                   │
│   ┌──────────────┐         ┌──────────────────────┐    │
│   │  YES Token   │ ◄─────► │  Trading happens     │    │
│   │  (ERC20)     │         │  here               │    │
│   └──────────────┘         └──────────────────────┘    │
│                                     │                   │
│                    ┌────────────────┴────────────────┐  │
│                    │  PredictionMarketHook           │  │
│                    │  - Validates trader eligibility │  │
│                    │  - Ensures vUSDC is involved   │  │
│                    │  - Blocks non-authorized swaps │  │
│                    └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

NO Token is IMPLICIT: NO Price = 1 - YES Price
```

## Deployment Order

```bash
# 1. Deploy vUSDC
vUSDC = deploy(vUSDC)

# 2. Deploy YES Token Factory
factory = deploy(YESTokenFactory)

# 3. Deploy Market Registry
registry = deploy(MarketRegistry)

# 4. Deploy Uniswap V4 Hook (needs PoolManager address)
hook = deploy(PredictionMarketHook, poolManager, vUSDC)

# 5. Deploy Main Market Contract
market = deploy(PredictionMarket, vUSDC, registry, hook, factory, backendSigner)

# 6. Setup permissions
vUSDC.authorizeMinter(market)
factory.setMarketContract(market)
registry.setMarketContract(market)
hook.setMarketRegistry(registry)
```

## Backend Integration Flow

### 1. Initialize Market Round
```typescript
await predictionMarket.initializeMarket(roundNumber, durationSeconds);
```

### 2. Create Proposals (for each proposal)
```typescript
// This creates YES token + Uniswap pool + registers in registry
await predictionMarket.createProposal(
  proposalId,
  name,
  description,
  evaluationLogic,
  mathematicalLogic,
  resolutionDeadline
);
```

### 3. Register AI Agents
```typescript
await predictionMarket.batchRegisterAgents(
  agentAddresses,
  agentNames
);
// Each agent gets 100 vUSDC and is authorized in hook
```

### 4. Trading (Agents swap via Uniswap V4)
```typescript
// Agent buys YES tokens with vUSDC
await uniswapRouter.swap({
  poolKey: yesVusdPoolKey,
  amountIn: vusdAmount,
  // Hook validates trader is authorized
});
```

### 5. Resolve Round
```typescript
// Graduate winner
await predictionMarket.graduateProposal(winningProposalId, yesTWAP);

// Clear market for next round
await predictionMarket.resolveAndClearMarket(winningProposalId);
```

## Contract Functions Summary

### PredictionMarket.sol (Backend calls these)
- `initializeMarket(roundNumber, duration)` - Start new round
- `createProposal(...)` - Add proposal with YES token + pool
- `registerAgent(address, name)` - Register single agent
- `batchRegisterAgents(addresses, names)` - Register multiple agents
- `graduateProposal(proposalId, yesTWAP)` - Mark winner
- `resolveAndClearMarket(winningId)` - End round, clear data

### MarketRegistry.sol (Data storage)
- `getGraduatedProposals()` - Get all winners
- `getActiveProposals()` - Get current proposals
- `getProposal(proposalId)` - Get proposal details
- `getCurrentMarket()` - Get market state

### PredictionMarketHook.sol (Uniswap V4)
- `beforeSwap(...)` - Validates every swap
- `isEligibleTrader(address)` - Check if authorized

### vUSDC.sol
- `faucet(amount)` - Get free vUSDC for testing (max 1000)
- `balanceOf(address)` - Check balance

## Environment Variables

```env
# RPC
RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
CHAIN_ID=11155111

# Deployed Contracts
VUSD_ADDRESS=0x...
FACTORY_ADDRESS=0x...
REGISTRY_ADDRESS=0x...
HOOK_ADDRESS=0x...
MARKET_ADDRESS=0x...

# Uniswap V4
POOL_MANAGER_ADDRESS=0x...

# Backend Wallet (private key for signing txs)
BACKEND_PRIVATE_KEY=0x...
```

## Summary Checklist

✅ vUSDC.sol - Virtual USD token  
✅ YESToken.sol - YES outcome token template  
✅ YESTokenFactory.sol - Creates YES tokens per proposal  
✅ MarketRegistry.sol - On-chain data store  
✅ PredictionMarketHook.sol - Uniswap V4 swap validation  
✅ PredictionMarket.sol - Main contract (backend entry point)  

**You're ready to deploy! 🚀**
