# Verdict

**Capital-efficient prediction markets for real-world asset strategies.** Deploy 100% of your capital across unlimited RWA proposals—AI agents propose themselves, humans and bots trade together, and TWAP determines which strategies graduate.

## Architecture Overview

### Smart Contracts

**VerdictPredictionMarketRouter.sol** - Main orchestrator contract
- Manages proposal lifecycle (creation, trading, graduation)
- Handles batch operations (agent registration, balance resets)
- Coordinates with vUSDC, Registry, Factory, and AMM contracts
- Implements TWAP-based winner selection

**VerdictVirtualUSDCToken.sol** - Virtual trading currency
- ERC20-compatible token for trading credits
- Minted/burned by Router contract
- Used as base currency for all swaps

**VerdictSimpleAMM.sol** - Constant product AMM
- YES/NO token pairs per proposal
- vUSD ↔ YES/NO swaps with 0.3% fee
- Price discovery via constant product formula: `x * y = k`

**VerdictYESTokenDeployerFactory.sol** - YES token factory
- Deploys YES/NO token pairs for each proposal
- 1:1:1 minting ratio (1 vUSD → 1 YES + 1 NO)

**VerdictProposalRegistryStorage.sol** - Proposal registry
- Stores proposal metadata and status
- Tracks graduated proposals

### Backend (Bun + TypeScript)

**Core Components:**

- **API Server** (`src/server/index.ts`): Bun.serve() HTTP server with REST endpoints
- **Market Engine** (`src/engine/`): Trading logic, AMM calculations, TWAP tracking
- **Agent System** (`src/agents/`): AI agent generation, personality-based trading
- **Blockchain Layer** (`src/blockchain/`): Ethers.js integration, contract interactions
- **LLM Integration** (`src/llm/`): Groq API for strategy generation and agent decisions

**Key Features:**

- **Multi-chain Support**: Mantle Sepolia, Arbitrum Sepolia, Hardhat local
- **RPC Fallback**: Automatic fallback from Alchemy to public RPCs on rate limits
- **Batch Operations**: Atomic batch transactions for gas efficiency
- **Rate Limit Handling**: Exponential backoff and provider switching
- **Transaction Timeouts**: 60s timeouts prevent hanging on slow networks

### Frontend (Vanilla JavaScript)

- Real-time market dashboard
- Trading interface with wallet connection
- Agent activity monitoring
- Custom proposal designer

## Technical Stack

- **Runtime**: Bun 1.2.20+
- **Language**: TypeScript 5+
- **Blockchain**: Ethers.js 6.16.0
- **LLM**: Groq API (OpenAI-compatible)
- **Smart Contracts**: Solidity 0.8.24/0.8.26
- **Deployment**: Hardhat

## Project Structure

```
verdict/
├── contracts-hardhat/        # Smart contracts & deployment
│   ├── contracts/            # Solidity source files
│   ├── scripts/              # Deployment scripts
│   └── hardhat.config.js     # Hardhat configuration
├── src/
│   ├── agents/               # Agent generation & management
│   ├── blockchain/           # Blockchain integration layer
│   ├── core/                 # Types, config, database
│   ├── engine/               # Trading engine, AMM, TWAP
│   ├── llm/                  # LLM integration (Groq)
│   ├── scripts/               # Utility scripts
│   └── server/               # API server
├── public/                    # Frontend files
├── abi/                      # Contract ABIs
├── index.ts                  # Application entry point
└── .env                      # Environment configuration
```

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Node.js 18+ (for Hardhat)
- Wallet with testnet tokens

### Installation

```bash
bun install
cd contracts-hardhat && bun install
```

### Configuration

Create `.env` file:

```bash
# Environment
APP_ENV=prod

# Groq AI
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile

# Network (hardhat, mantle, or arbitrum)
NETWORK=arbitrum

# Backend wallet
BACKEND_PRIVATE_KEY=your_private_key
MASTER_SEED="12 word BIP39 mnemonic"

# Router address (after deployment)
ROUTER_ADDRESS=0x...
```

### Running

```bash
# Start backend server
bun index.ts

# Deploy contracts
cd contracts-hardhat
bunx hardhat run scripts/deploy.js --network arbitrumSepolia
```

## API Endpoints

### Market Operations

- `GET /api/market` - Market state with proposals and prices
- `GET /api/agents` - Active agents with balances and trades
- `GET /api/history` - Graduated proposals

### Initialization

- `POST /api/init/proposals` - Generate AI proposals
- `POST /api/init/agents` - Initialize AI agents
- `POST /api/trade/start` - Start trading round

### Custom Proposals

- `POST /api/proposal/inject` - Inject custom proposal (requires existing AI proposals)

### Data Sources

- `GET /api/data-sources` - Available data sources
- `GET /api/data-sources/ticker` - Ticker data
- `GET /api/exchange-rate` - FX rate data

## Network Configuration

### Arbitrum Sepolia

- **RPC**: Alchemy (with public fallback)
- **Chain ID**: 421614
- **Currency**: ETH
- **Explorer**: https://sepolia.arbiscan.io/

### Mantle Sepolia

- **RPC**: https://rpc.sepolia.mantle.xyz/
- **Chain ID**: 5003
- **Currency**: MNT
- **Explorer**: https://sepolia.mantlescan.xyz/

### Hardhat Local

- **RPC**: http://localhost:8545
- **Chain ID**: 31337
- **Currency**: ETH

## Key Technical Features

### RPC Fallback System

Automatically switches from Alchemy to public RPCs when rate limits are hit:

```typescript
// Detects 429 errors
if (error?.code === 429) {
    await switchToFallbackProvider();
    // Retries with new provider
}
```

### Batch Operations

All agent operations use batch transactions for efficiency:

- `registerAgentsBatch()` - Atomic agent registration
- `resetAgentsBalanceTo100Batch()` - Single transaction for all agents

### Transaction Timeouts

All blockchain operations have 60s timeouts to prevent hanging:

```typescript
await Promise.race([
    tx.wait(),
    new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 60000))
]);
```

### Gas Management

Network-specific gas funding:

- **Arbitrum**: 0.005 ETH threshold, 0.01 ETH funding
- **Mantle**: 0.1 MNT threshold, 0.5 MNT funding
- **Hardhat**: 0.1 ETH threshold, 0.5 ETH funding

## Development

### Contract Deployment

```bash
cd contracts-hardhat
bunx hardhat compile
bunx hardhat run scripts/deploy.js --network arbitrumSepolia
```

### Testing

```bash
# Run backend
bun index.ts

# Test endpoints
curl http://localhost:3000/api/market
```

## Troubleshooting

### Rate Limit Errors

- System automatically falls back to public RPCs
- Check logs for "Switching to fallback RPC" messages

### Transaction Timeouts

- Increase timeout in `src/blockchain/index.ts` if needed
- Check network congestion

### Gas Issues

- Ensure backend wallet has sufficient native tokens
- Check `getAgentGasFunding()` for network-specific amounts

## License

Private - All Rights Reserved

