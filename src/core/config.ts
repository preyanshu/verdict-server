// Alchemy API key from environment (optional - only needed if using Alchemy RPCs)
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';

// Supported blockchain networks
const NETWORKS = {
    hardhat: {
        name: 'Hardhat Local',
        rpcUrl: 'http://localhost:8545',
        chainId: 31337,
        blockExplorerUrl: 'https://etherscan.io',
        currencySymbol: 'ETH',
        gasPrice: undefined, // Use default
    },
    mantle: {
        name: 'Mantle Testnet (Sepolia)',
        rpcUrl: ALCHEMY_API_KEY ? `https://mantle-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}` : 'https://rpc.sepolia.mantle.xyz/',
        fallbackRpcUrls: [
            'https://rpc.sepolia.mantle.xyz/',
        ],
        chainId: 5003,
        blockExplorerUrl: 'https://sepolia.mantlescan.xyz/',
        currencySymbol: 'MNT',
        gasPrice: 20000000, // 0.02 gwei (Mantle optimized)
    },
    arbitrum: {
        name: 'Arbitrum Sepolia (Testnet)',
        rpcUrl: ALCHEMY_API_KEY ? `https://arb-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}` : 'https://sepolia-rollup.arbitrum.io/rpc',
        fallbackRpcUrls: [
            'https://sepolia-rollup.arbitrum.io/rpc',
            'https://arbitrum-sepolia-rpc.publicnode.com',
        ],
        chainId: 421614,
        blockExplorerUrl: 'https://sepolia.arbiscan.io/',
        currencySymbol: 'ETH',
        gasPrice: undefined, // Use default
    },
};

// Get selected network from environment variable, or detect from CHAIN_ID
let selectedNetwork = (process.env.NETWORK || '').toLowerCase() as keyof typeof NETWORKS;

// If NETWORK not set, try to detect from CHAIN_ID
if (!selectedNetwork || !NETWORKS[selectedNetwork]) {
    const chainId = parseInt(process.env.CHAIN_ID || '0');
    if (chainId === 5003) {
        selectedNetwork = 'mantle';
    } else if (chainId === 421614) {
        selectedNetwork = 'arbitrum';
    } else if (chainId === 31337) {
        selectedNetwork = 'hardhat';
    } else {
        // Default fallback
        selectedNetwork = 'hardhat';
    }
}

const network = NETWORKS[selectedNetwork] || NETWORKS.hardhat;

export const config = {
    env: process.env.APP_ENV || 'dev', // 'dev' or 'prod'
    groq: {
        apiKey: process.env.GROQ_API_KEY || '',
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', // Groq models: llama-3.3-70b-versatile (production, supports function calling), llama-3.1-8b-instant (faster), qwen/qwen3-32b, etc.
    },
    blockchain: {
        // Selected network
        network: selectedNetwork,
        networkName: network.name,
        // Master seed for deriving agent wallets (KEEP SECRET IN PRODUCTION!)
        // This is a test mnemonic - replace with your own in production
        masterSeed: process.env.MASTER_SEED || 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        // Backend wallet private key for signing transactions (KEEP SECRET!)
        // This is Hardhat account #0 - replace with your own in production
        backendPrivateKey: process.env.BACKEND_PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        // RPC URL for Ethereum/EVM chain (can be overridden via RPC_URL env var)
        rpcUrl: process.env.RPC_URL || network.rpcUrl,
        // Router contract address (set after deployment)
        routerAddress: process.env.ROUTER_ADDRESS || '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        // Chain ID (can be overridden via CHAIN_ID env var)
        chainId: parseInt(process.env.CHAIN_ID || network.chainId.toString()),
        // Block Explorer URL (can be overridden via BLOCK_EXPLORER_URL env var)
        blockExplorerUrl: process.env.BLOCK_EXPLORER_URL || network.blockExplorerUrl,
        // Currency symbol for the network
        currencySymbol: network.currencySymbol,
        // Gas price (if specified for the network)
        gasPrice: network.gasPrice,
    },
    market: {
        roundDuration: (process.env.APP_ENV || 'dev') === 'dev' ? 60000 : 250000, // 1 min for dev, 15 min for prod
    }
};

export const isDev = config.env === 'dev';

