import { ethers, BaseContract, JsonRpcProvider, Wallet, ContractTransactionResponse } from 'ethers';
import { config } from '../core/config';
import { getAgentSigner } from '../agents';
import type { Agent, MarketStrategy } from '../core/types';
import routerArtifact from '../../abi/router.json';

/**
 * Interfaces for Verdict Prediction Market Contracts
 */
interface VerdictRouter extends BaseContract {
    getDeployedContracts(): Promise<{ _vUSDC: string; _registry: string; _factory: string; _amm: string }>;
    registerAgent(agentAddress: string, overrides?: any): Promise<ContractTransactionResponse>;
    registerAgentsBatch(agents: string[], overrides?: any): Promise<ContractTransactionResponse>;
    resetAgentBalanceTo100(agent: string, overrides?: any): Promise<ContractTransactionResponse>;
    resetAgentsBalanceTo100Batch(agents: string[], overrides?: any): Promise<ContractTransactionResponse>;
    userFaucet(overrides?: any): Promise<ContractTransactionResponse>;
    createProposal(
        id: string,
        name: string,
        description: string,
        evalLogic: string,
        mathLogic: string,
        deadline: number,
        liquidity: bigint,
        overrides?: any
    ): Promise<ContractTransactionResponse>;
    initializeMarket(duration: number, overrides?: any): Promise<ContractTransactionResponse>;
    initializeMarketWithProposals(duration: number, proposals: any[], overrides?: any): Promise<ContractTransactionResponse>;
    vUSDCToken(): Promise<string>;
    swap(id: string, tokenIn: string, amountIn: bigint, minOut: bigint, overrides?: any): Promise<ContractTransactionResponse>;
    getVUSDCBalance(account: string): Promise<bigint>;
    getYesTokenAddress(id: string): Promise<string>;
    getYESBalance(id: string, account: string): Promise<bigint>;
    getYESPrice(id: string): Promise<bigint>;
    getPoolReserves(id: string): Promise<{ vUSDCReserve: bigint; yesReserve: bigint }>;
    currentRound(): Promise<bigint>;
    graduateProposal(id: string, finalPrice: bigint, overrides?: any): Promise<ContractTransactionResponse>;
    getGraduatedProposals(): Promise<string[]>;
    getProposalStatus(id: string): Promise<any>;
    getRoundInfo(): Promise<{
        roundNumber: bigint;
        roundStartTime: bigint;
        roundEndTime: bigint;
        roundDuration: bigint;
        proposalIds: string[];
        active: boolean;
    }>;
}

interface ERC20 extends BaseContract {
    balanceOf(account: string): Promise<bigint>;
    transfer(to: string, amount: bigint, overrides?: any): Promise<ContractTransactionResponse>;
    approve(spender: string, amount: bigint, overrides?: any): Promise<ContractTransactionResponse>;
    allowance(owner: string, spender: string): Promise<bigint>;
    decimals(): Promise<bigint>;
}

/**
 * Blockchain integration for Verdict Prediction Market
 */

export const ROUTER_ADDRESS = config.blockchain.routerAddress;

// State variables
export let VUSDCADDRESS = '';
let REGISTRY_ADDRESS = '';
let FACTORY_ADDRESS = '';
let AMM_ADDRESS = '';

export let provider: JsonRpcProvider | null = null;
export let backendSigner: Wallet | null = null;
export let routerContract: VerdictRouter | null = null;
export let vUSDCContract: ERC20 | null = null;

// Provider fallback management
let currentRpcIndex = 0;
let rpcUrls: string[] = [];
let lastProviderSwitch = 0;
const PROVIDER_SWITCH_COOLDOWN = 60000; // 60 seconds before switching back

/**
 * Type-safe accessors
 */
export function getProvider(): JsonRpcProvider {
    if (!provider) throw new Error('Blockchain provider not initialized');
    return provider;
}

export function getBackendSigner(): Wallet {
    if (!backendSigner) throw new Error('Backend signer not initialized');
    return backendSigner;
}

export function getRouter(): VerdictRouter {
    if (!routerContract) throw new Error('Router contract not initialized');
    return routerContract;
}

export function getVUSDC(): ERC20 {
    if (!vUSDCContract) throw new Error('vUSDC contract not initialized');
    return vUSDCContract;
}

/**
 * Get gas price for current network
 * Returns network-specific gas price or undefined to let provider estimate
 */
export function getGasPrice(): bigint | undefined {
    if (config.blockchain.gasPrice !== undefined) {
        return BigInt(config.blockchain.gasPrice);
    }
    return undefined; // Let provider estimate
}

/**
 * Get gas price override for transactions
 * Returns an object with gasPrice if network specifies it, otherwise empty object
 */
export function getGasPriceOverride(): { gasPrice?: bigint } {
    const gasPrice = getGasPrice();
    return gasPrice !== undefined ? { gasPrice } : {};
}

/**
 * Get network-specific gas funding amounts for agents
 * Returns threshold and amount based on network (Arbitrum needs less, Mantle/Hardhat can use more)
 */
export function getAgentGasFunding(): { threshold: bigint; amount: bigint } {
    const network = config.blockchain.network;
    
    if (network === 'arbitrum') {
        // Arbitrum Sepolia: Use smaller amounts (0.005 ETH threshold, 0.01 ETH funding)
        // User only has ~0.2 ETH total, so we need to be conservative
        return {
            threshold: ethers.parseEther("0.005"), // 0.005 ETH minimum
            amount: ethers.parseEther("0.01")       // 0.01 ETH per agent (4 agents = 0.04 ETH total)
        };
    } else if (network === 'mantle') {
        // Mantle: Use MNT amounts (cheaper)
        return {
            threshold: ethers.parseEther("0.1"),   // 0.1 MNT minimum
            amount: ethers.parseEther("0.5")        // 0.5 MNT per agent
        };
    } else {
        // Hardhat or default: Use ETH amounts
        return {
            threshold: ethers.parseEther("0.1"),   // 0.1 ETH minimum
            amount: ethers.parseEther("0.5")        // 0.5 ETH per agent
        };
    }
}

/**
 * Switch to fallback RPC provider
 */
async function switchToFallbackProvider(): Promise<boolean> {
    // Get fallback URLs from NETWORKS config
    const NETWORKS = {
        arbitrum: {
            fallbackRpcUrls: [
                'https://sepolia-rollup.arbitrum.io/rpc',
                'https://arbitrum-sepolia-rpc.publicnode.com',
            ],
        },
        mantle: {
            fallbackRpcUrls: [
                'https://rpc.sepolia.mantle.xyz/',
            ],
        },
        hardhat: {
            fallbackRpcUrls: [],
        },
    };
    
    const network = config.blockchain.network as keyof typeof NETWORKS;
    const networkConfig = NETWORKS[network] || { fallbackRpcUrls: [] };
    const fallbackUrls = networkConfig.fallbackRpcUrls || [];
    
    if (fallbackUrls.length === 0) {
        console.log('⚠️  No fallback RPC URLs configured');
        return false;
    }
    
    const now = Date.now();
    if (now - lastProviderSwitch < PROVIDER_SWITCH_COOLDOWN) {
        console.log(`⏳ Provider switch cooldown active (${Math.ceil((PROVIDER_SWITCH_COOLDOWN - (now - lastProviderSwitch)) / 1000)}s remaining)`);
        return false;
    }
    
    // Try next fallback URL
    currentRpcIndex = (currentRpcIndex + 1) % (fallbackUrls.length + 1);
    const rpcUrl = currentRpcIndex === 0 
        ? (config.blockchain.rpcUrl || '')
        : fallbackUrls[currentRpcIndex - 1];
    
    if (!rpcUrl) {
        console.error('❌ No RPC URL available');
        return false;
    }
    
    console.log(`🔄 Switching to fallback RPC ${currentRpcIndex > 0 ? `(${currentRpcIndex}/${fallbackUrls.length})` : '(primary)'}: ${rpcUrl.substring(0, 50)}...`);
    
    try {
        const newProvider = new JsonRpcProvider(rpcUrl);
        // Test the provider
        await newProvider.getBlockNumber();
        
        // Update provider and signer
        provider = newProvider;
        backendSigner = new Wallet(config.blockchain.backendPrivateKey, provider);
        routerContract = new ethers.Contract(ROUTER_ADDRESS, routerArtifact.abi, backendSigner) as unknown as VerdictRouter;
        
        lastProviderSwitch = now;
        console.log(`✅ Switched to fallback provider successfully`);
        return true;
    } catch (error: any) {
        console.error(`❌ Failed to switch to fallback provider:`, error?.message);
        return false;
    }
}

/**
 * Check if error is rate limit related and switch provider if needed
 */
export async function handleRateLimitError(error: any): Promise<boolean> {
    const isRateLimit = error?.code === 429 || 
                       error?.message?.includes('compute units') || 
                       error?.message?.includes('rate limit') ||
                       error?.message?.includes('exceeded');
    
    if (isRateLimit) {
        console.log('⚠️  Rate limit detected, attempting to switch to fallback RPC...');
        return await switchToFallbackProvider();
    }
    
    return false;
}

/**
 * Initialize blockchain connection
 */
export async function initBlockchain(): Promise<boolean> {
    try {
        // Setup RPC URLs list (primary + fallbacks)
        const NETWORKS = {
            arbitrum: {
                fallbackRpcUrls: [
                    'https://sepolia-rollup.arbitrum.io/rpc',
                    'https://arbitrum-sepolia-rpc.publicnode.com',
                ],
            },
            mantle: {
                fallbackRpcUrls: [
                    'https://rpc.sepolia.mantle.xyz/',
                ],
            },
            hardhat: {
                fallbackRpcUrls: [],
            },
        };
        
        const network = config.blockchain.network as keyof typeof NETWORKS;
        const networkConfig = NETWORKS[network] || { fallbackRpcUrls: [] };
        const fallbackUrls = networkConfig.fallbackRpcUrls || [];
        rpcUrls = [config.blockchain.rpcUrl, ...fallbackUrls];
        currentRpcIndex = 0;
        
        provider = new JsonRpcProvider(config.blockchain.rpcUrl);

        // Use backend private key from config (reads from .env)
        backendSigner = new Wallet(config.blockchain.backendPrivateKey, provider);

        routerContract = new ethers.Contract(ROUTER_ADDRESS, routerArtifact.abi, backendSigner) as unknown as VerdictRouter;

        console.log('Blockchain initialized');
        console.log(`Network: ${config.blockchain.networkName} (${config.blockchain.network})`);
        console.log(`Chain ID: ${config.blockchain.chainId}`);
        console.log(`RPC: ${config.blockchain.rpcUrl}`);
        console.log(`Router: ${ROUTER_ADDRESS}`);

        const contracts = await routerContract.getDeployedContracts();
        VUSDCADDRESS = contracts._vUSDC;
        REGISTRY_ADDRESS = contracts._registry;
        FACTORY_ADDRESS = contracts._factory;
        AMM_ADDRESS = contracts._amm;

        vUSDCContract = new ethers.Contract(VUSDCADDRESS, [
            "function balanceOf(address owner) view returns (uint256)",
            "function transfer(address to, uint256 amount) returns (bool)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function allowance(address owner, address spender) view returns (uint256)",
            "function decimals() view returns (uint8)"
        ], backendSigner) as unknown as ERC20;

        console.log(`vUSDC: ${VUSDCADDRESS}`);
        console.log(`Registry: ${REGISTRY_ADDRESS}`);
        console.log(`Factory: ${FACTORY_ADDRESS}`);
        console.log(`AMM: ${AMM_ADDRESS}`);

        return true;
    } catch (error) {
        console.error('❌ Failed to initialize blockchain:', error);
        return false;
    }
}

/**
 * Register an agent on-chain
 */
export async function registerAgentOnChain(agent: Agent): Promise<{ success: boolean; txHash?: string }> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        console.log(`Registering agent ${agent.personality.name} (${agent.wallet.address})...`);

        const gasPriceOverride = getGasPriceOverride();
        const nonce = await signer.getNonce('pending');
        const tx = await router.registerAgent(agent.wallet.address, { nonce, ...gasPriceOverride });
        await tx.wait();
        console.log(`Agent registered`);

        return { success: true, txHash: tx.hash };
    } catch (error) {
        console.error(`❌ Failed to register agent:`, error);
        return { success: false };
    }
}

/**
 * Helper to get fresh nonce and send transaction with retry
 */
async function sendWithFreshNonce(
    signer: Wallet,
    fn: (nonce: number) => Promise<any>,
    maxRetries = 3
): Promise<any> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const nonce = await signer.getNonce('pending');
            const tx = await fn(nonce);
            await tx.wait();
            // Small delay to ensure nonce updates
            await new Promise(resolve => setTimeout(resolve, 500));
            return tx;
        } catch (error: any) {
            if (attempt === maxRetries - 1) throw error;
            // If nonce error, wait a bit and retry
            if (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message?.includes('nonce')) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
}

/**
 * Register all agents on-chain using batch function (atomic - all or nothing)
 */
export async function registerAllAgentsBatch(agentAddresses: string[]): Promise<{ success: boolean; txHash?: string }> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        const prov = getProvider();

        console.log(`\nRegistering ${agentAddresses.length} agents on-chain via batch transaction...`);
        
        // Use sendWithFreshNonce to handle nonce properly
        const gasPriceOverride = getGasPriceOverride();
        const tx = await sendWithFreshNonce(signer, (nonce) =>
            router.registerAgentsBatch(agentAddresses, {
                nonce,
                ...gasPriceOverride
            })
        );
        await tx.wait();

        console.log(`✅ Successfully registered ${agentAddresses.length} agents in batch`);
        
        // Fund all agents with native tokens for gas (they need this to make transactions)
        const gasFunding = getAgentGasFunding();
        console.log(`\nFunding agents with native ${config.blockchain.currencySymbol} for gas...`);
        console.log(`   Threshold: ${ethers.formatEther(gasFunding.threshold)} ${config.blockchain.currencySymbol}`);
        console.log(`   Amount per agent: ${ethers.formatEther(gasFunding.amount)} ${config.blockchain.currencySymbol}`);
        
        for (const address of agentAddresses) {
            try {
                const balance = await prov.getBalance(address);
                if (balance < gasFunding.threshold) {
                    const gasPriceOverride = getGasPriceOverride();
                    const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({
                            to: address,
                            value: gasFunding.amount,
                            nonce,
                            ...gasPriceOverride
                        })
                    );
                    await gasTx.wait();
                    console.log(`   ✅ Funded ${address.substring(0, 10)}... with ${ethers.formatEther(gasFunding.amount)} ${config.blockchain.currencySymbol}`);
                } else {
                    console.log(`   ⏭️  ${address.substring(0, 10)}... already has sufficient gas (${ethers.formatEther(balance)} ${config.blockchain.currencySymbol})`);
                }
                // Small delay to avoid nonce issues
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error: any) {
                console.error(`   ❌ Failed to fund ${address.substring(0, 10)}...:`, error?.message);
            }
        }
        
        console.log(`✅ Gas funding complete for all agents`);
        
        return { success: true, txHash: tx.hash };
    } catch (error: any) {
        console.error(`❌ Batch agent registration failed:`, error?.message);
        return { success: false };
    }
}

// Lock to prevent concurrent balance resets
let isResettingBalances = false;

/**
 * Helper to send transaction with fresh nonce for agent signers
 */
async function sendWithFreshNonceForAgent(
    agentSigner: ethers.Signer,
    fn: (nonce: number) => Promise<any>,
    maxRetries = 3
): Promise<any> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const prov = getProvider();
            const address = await agentSigner.getAddress();
            
            // Get nonce with error handling for RPC failures
            let nonce: number;
            try {
                nonce = await prov.getTransactionCount(address, 'pending');
            } catch (nonceError: any) {
                // Handle RPC errors when getting nonce (including "missing revert data")
                if (nonceError?.code === 429 || nonceError?.message?.includes('rate limit') || nonceError?.message?.includes('exceeded') || nonceError?.code === 'CALL_EXCEPTION' || nonceError?.message?.includes('missing revert data')) {
                    const switched = await handleRateLimitError(nonceError);
                    if (switched && attempt < maxRetries - 1) {
                        // Provider switched, retry immediately
                        continue;
                    }
                }
                throw nonceError;
            }
            
            const tx = await fn(nonce);
            
            // Wait with 60s timeout to prevent hanging on slow networks
            try {
                await Promise.race([
                    tx.wait(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Transaction timeout after 60s')), 60000))
                ]);
            } catch (waitError: any) {
                // If wait fails due to RPC issues, try switching provider
                if (waitError?.code === 429 || waitError?.message?.includes('rate limit') || waitError?.code === 'CALL_EXCEPTION' || waitError?.message?.includes('missing revert data')) {
                    const switched = await handleRateLimitError(waitError);
                    if (switched && attempt < maxRetries - 1) {
                        // Provider switched, retry the transaction
                        continue;
                    }
                }
                throw waitError;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            return tx;
        } catch (error: any) {
            // Handle rate limit errors and RPC failures - try switching provider first
            if (error?.code === 429 || error?.message?.includes('compute units') || error?.message?.includes('rate limit') || error?.message?.includes('exceeded') || error?.code === 'CALL_EXCEPTION' || error?.message?.includes('missing revert data')) {
                const switched = await handleRateLimitError(error);
                if (switched && attempt < maxRetries - 1) {
                    // Provider switched, retry immediately
                    continue;
                }
                // If switch failed or last attempt, use exponential backoff
                const backoffDelay = Math.min(2000 * Math.pow(2, attempt), 10000); // Max 10s
                console.log(`   ⏳ Rate limit/RPC error hit, waiting ${backoffDelay}ms before retry ${attempt + 1}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                if (attempt < maxRetries - 1) continue;
            }
            
            if (attempt === maxRetries - 1) throw error;
            if (error.code === 'NONCE_EXPIRED' || error.code === 'REPLACEMENT_UNDERPRICED' || error.message?.includes('nonce') || error.message?.includes('replacement')) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            throw error;
        }
    }
}

/**
 * Reset all agent balances to 100 vUSDC at round start using smart contract function
 */
export async function resetAgentBalancesTo100(agents: Agent[]): Promise<{ success: boolean; txHash?: string }> {
    // Prevent concurrent calls
    if (isResettingBalances) {
        console.log(`⚠️ Balance reset already in progress, skipping...`);
        return { success: false };
    }

    isResettingBalances = true;

    try {
        const router = getRouter();
        const signer = getBackendSigner();

        console.log(`\nResetting ${agents.length} agent balances to 100 vUSDC for new round...`);

        // Extract agent addresses
        const agentAddresses = agents.map(agent => agent.wallet.address);

        // Use batch contract function - atomic, single transaction, handles all agents
        const gasPriceOverride = getGasPriceOverride();
        const tx = await sendWithFreshNonce(signer, (nonce) =>
            router.resetAgentsBalanceTo100Batch(agentAddresses, {
                nonce,
                ...gasPriceOverride
            })
        );
        await tx.wait();

        console.log(`✅ Balance reset complete for ${agents.length} agents in single transaction`);
        console.log(`   Transaction: ${tx.hash}`);
        
        // Refill gas for agents who need it (only if balance is below threshold)
        console.log(`\nChecking agent gas balances...`);
        const prov = getProvider();
        const gasFunding = getAgentGasFunding();
        
        let refillCount = 0;
        for (const agent of agents) {
            try {
                const balance = await prov.getBalance(agent.wallet.address);
                console.log(`   📊 ${agent.personality.name} gas balance: ${ethers.formatEther(balance)} ${config.blockchain.currencySymbol} (threshold: ${ethers.formatEther(gasFunding.threshold)})`);
                
                if (balance < gasFunding.threshold) {
                    console.log(`   ⚠️  ${agent.personality.name} below threshold, refilling...`);
                    const gasPriceOverride = getGasPriceOverride();
                    const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({
                            to: agent.wallet.address,
                            value: gasFunding.amount,
                            nonce,
                            ...gasPriceOverride
                        })
                    );
                    await gasTx.wait();
                    const newBalance = await prov.getBalance(agent.wallet.address);
                    console.log(`   ✅ Refilled gas for ${agent.personality.name}: ${ethers.formatEther(gasFunding.amount)} ${config.blockchain.currencySymbol} (new balance: ${ethers.formatEther(newBalance)})`);
                    refillCount++;
                    // Small delay to avoid nonce issues
                    await new Promise(resolve => setTimeout(resolve, 300));
                } else {
                    console.log(`   ✅ ${agent.personality.name} has sufficient gas`);
                }
            } catch (error: any) {
                console.error(`   ❌ Failed to check/refill gas for ${agent.personality.name}:`, error?.message);
            }
        }
        
        if (refillCount === 0) {
            console.log(`   ✅ All agents have sufficient gas`);
        }
        
        return { success: true, txHash: tx.hash };
    } catch (error: any) {
        console.error(`❌ Batch balance reset failed:`, error?.message);
        return { success: false };
    } finally {
        isResettingBalances = false;
    }
}

/**
 * Register all agents on-chain with proper nonce management
 * @deprecated Use registerAllAgentsBatch for atomic batch registration
 */
export async function registerAllAgents(agents: Agent[]): Promise<string[]> {
    const router = getRouter();
    const vusdc = getVUSDC();
    const signer = getBackendSigner();
    const prov = getProvider();
    const txHashes: string[] = [];

    console.log(`\nSynchronizing ${agents.length} agents on-chain...`);

    const TARGET_BALANCE = 100;
    const TOTAL_NEEDED = agents.length * TARGET_BALANCE;

    let backendBalance = await vusdc.balanceOf(signer.address);
    const neededWei = ethers.parseUnits(TOTAL_NEEDED.toString(), 18);

    if (backendBalance < neededWei) {
        console.log(`Backend funds low. Tapping faucet...`);
        // Each faucet call via router gives 100 vUSDC
        const tapsNeeded = Math.ceil(Number(ethers.formatUnits(neededWei - backendBalance, 18)) / 100);
        for (let i = 0; i < tapsNeeded; i++) {
            try {
                const gasPriceOverride = getGasPriceOverride();
                const tx = await sendWithFreshNonce(signer, (nonce) => 
                    router.userFaucet({ nonce, ...gasPriceOverride })
                );
                txHashes.push(tx.hash);
            } catch (error: any) {
                console.error(`❌ Faucet tap failed:`, error?.message);
            }
        }
    }

    for (const agent of agents) {
        try {
            const balanceWei = await vusdc.balanceOf(agent.wallet.address);
            const balance = parseFloat(ethers.formatUnits(balanceWei, 18));
            const targetWei = ethers.parseUnits(TARGET_BALANCE.toString(), 18);

            console.log(`${agent.personality.name}: ${balance} (Target ${TARGET_BALANCE})`);

            // If agent has 0 balance, use the official registerAgent function to mint 500 vUSDC
            if (balance === 0) {
                console.log(`   Registering agent to mint initial capital...`);
                try {
                    const gasPriceOverride = getGasPriceOverride();
                    const tx = await sendWithFreshNonce(signer, (nonce) =>
                        router.registerAgent(agent.wallet.address, { nonce, ...gasPriceOverride })
                    );
                    txHashes.push(tx.hash);

                    // Update local balance view
                    const newBalanceWei = await vusdc.balanceOf(agent.wallet.address);
                    const excess = newBalanceWei - targetWei;

                    // Ensure agent has gas before transferring back
                    const gasFunding = getAgentGasFunding();
                    const eth = await prov.getBalance(agent.wallet.address);
                    if (eth < gasFunding.threshold) {
                        const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                            signer.sendTransaction({ 
                                to: agent.wallet.address, 
                                value: gasFunding.amount, 
                                nonce,
                                ...getGasPriceOverride()
                            })
                        );
                        txHashes.push(gasTx.hash);
                    }

                    const agentSigner = getAgentSigner(agent, prov);
                    const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;
                    const agentNonce = await prov.getTransactionCount(agent.wallet.address, 'pending');

                    const returnTx = await agentVUSDC.transfer(signer.address, excess, { 
                        nonce: agentNonce,
                        ...getGasPriceOverride()
                    });
                    await returnTx.wait();
                    txHashes.push(returnTx.hash);
                    console.log(`   Reset to 100 (and replenished backend)`);
                } catch (error: any) {
                    console.error(`   ❌ Registration failed:`, error?.message);
                }
            } else if (balance > TARGET_BALANCE) {
                const excess = balanceWei - targetWei;
                const agentSigner = getAgentSigner(agent, prov);
                const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;

                // Ensure agent has gas
                const gasFunding = getAgentGasFunding();
                const eth = await prov.getBalance(agent.wallet.address);
                if (eth < gasFunding.threshold) {
                    try {
                        const tx = await sendWithFreshNonce(signer, (nonce) =>
                            signer.sendTransaction({ 
                                to: agent.wallet.address, 
                                value: gasFunding.amount, 
                                nonce,
                                ...getGasPriceOverride()
                            })
                        );
                        txHashes.push(tx.hash);
                    } catch (error: any) {
                        console.error(`   ❌ Gas transfer failed:`, error?.message);
                    }
                }

                try {
                    const agentNonce = await prov.getTransactionCount(agent.wallet.address, 'pending');
                    const tx = await agentVUSDC.transfer(signer.address, excess, { 
                        nonce: agentNonce,
                        ...getGasPriceOverride()
                    });
                    await tx.wait();
                    txHashes.push(tx.hash);
                    console.log(`   Reset to 100`);
                } catch (error: any) {
                    console.error(`   ❌ Transfer failed:`, error?.message);
                }
            } else if (balance < TARGET_BALANCE) {
                const deficiency = targetWei - balanceWei;
                try {
                    const tx = await sendWithFreshNonce(signer, (nonce) =>
                        vusdc.transfer(agent.wallet.address, deficiency, { 
                            nonce,
                            ...getGasPriceOverride()
                        })
                    );
                    txHashes.push(tx.hash);
                    console.log(`   Reset to 100`);
                } catch (error: any) {
                    console.error(`   ❌ Transfer failed:`, error?.message);
                }
            }

            // Gas buffer
            const gasFunding = getAgentGasFunding();
            const eth = await prov.getBalance(agent.wallet.address);
            if (eth < gasFunding.threshold) {
                try {
                    const tx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({ 
                            to: agent.wallet.address, 
                            value: gasFunding.amount, 
                            nonce,
                            ...getGasPriceOverride()
                        })
                    );
                    txHashes.push(tx.hash);
                } catch (error: any) {
                    console.error(`   ❌ Gas buffer failed:`, error?.message);
                }
            }

            // Unlimited approval
            const agentSigner = getAgentSigner(agent, prov);
            const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;
            const currentAllowance = await agentVUSDC.allowance(agent.wallet.address, ROUTER_ADDRESS);

            if (currentAllowance < targetWei) {
                try {
                    const agentNonce = await prov.getTransactionCount(agent.wallet.address, 'pending');
                    const tx = await agentVUSDC.approve(ROUTER_ADDRESS, ethers.MaxUint256, { 
                        nonce: agentNonce,
                        ...getGasPriceOverride()
                    });
                    await tx.wait();
                    txHashes.push(tx.hash);
                    console.log(`   Approved Router`);
                } catch (error: any) {
                    console.error(`   ❌ Approval failed:`, error?.message);
                }
            }
        } catch (error: any) {
            console.error(`❌ Sync failed for ${agent.personality.name}:`, error?.message);
        }
        
        // Small delay between agents to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return txHashes;
}

/**
 * Create a proposal on-chain
 */
export async function createProposalOnChain(
    proposalId: string,
    name: string,
    description: string,
    evalLogic: string,
    mathLogic: string,
    deadline: number,
    liquidity: number
): Promise<{ yesToken: string; poolId: string; txHash: string } | null> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        const liquidityWei = ethers.parseUnits(liquidity.toString(), 18);
        const gasPriceOverride = getGasPriceOverride();

        const nonce = await signer.getNonce('pending');
        const tx = await router.createProposal(
            proposalId, name, description, evalLogic, mathLogic, deadline, liquidityWei,
            { nonce, ...gasPriceOverride }
        );
        const receipt = await tx.wait();

        const log = receipt?.logs.find(l => {
            try { return router.interface.parseLog(l)?.name === 'ProposalLaunched'; } catch { return false; }
        });

        if (log) {
            const parsed = router.interface.parseLog(log);
            return { yesToken: parsed?.args.yesToken, poolId: parsed?.args.poolId, txHash: tx.hash };
        }
        return null;
    } catch (error) {
        console.error(`❌ Failed to create proposal:`, error);
        return null;
    }
}

/**
 * Execute a swap on-chain for an agent
 */
export async function executeSwapOnChain(
    agent: Agent,
    proposalId: string,
    tokenIn: string,
    amountIn: number,
    minAmountOut: number
): Promise<{ success: boolean; txHash?: string }> {
    try {
        // Validate inputs
        if (!proposalId || !tokenIn || amountIn <= 0 || minAmountOut < 0) {
            console.error(`❌ Invalid swap parameters for ${agent.personality.name}`);
            return { success: false };
        }
        const prov = getProvider();
        const router = getRouter();
        const agentSigner = getAgentSigner(agent, prov);

        const agentRouter = (new ethers.Contract(ROUTER_ADDRESS, routerArtifact.abi, agentSigner)) as unknown as VerdictRouter;

        let actualTokenIn = tokenIn;
        try {
            const authoritativeVUSDC = await router.vUSDCToken();
            if (!tokenIn || tokenIn === '' || tokenIn === VUSDCADDRESS) {
                actualTokenIn = authoritativeVUSDC;
            }
        } catch { }

        const amountWei = ethers.parseUnits(amountIn.toString(), 18);
        const minOutWei = ethers.parseUnits(minAmountOut.toString(), 18);

        const token = new ethers.Contract(actualTokenIn, [
            'function allowance(address,address) view returns (uint256)',
            'function approve(address,uint256) returns (bool)',
            'function balanceOf(address) view returns (uint256)'
        ], agentSigner) as unknown as ERC20;

        const [bal, allowance, nativeBalance] = await Promise.all([
            token.balanceOf(agent.wallet.address),
            token.allowance(agent.wallet.address, ROUTER_ADDRESS),
            prov.getBalance(agent.wallet.address)
        ]);

        if (bal < amountWei) return { success: false };

        // Check and refill gas if needed (agents need native tokens to pay for gas)
        const gasFunding = getAgentGasFunding();
        if (nativeBalance < gasFunding.threshold) {
            try {
                const signer = getBackendSigner();
                const gasPriceOverride = getGasPriceOverride();
                const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                    signer.sendTransaction({
                        to: agent.wallet.address,
                        value: gasFunding.amount,
                        nonce,
                        ...gasPriceOverride
                    })
                );
                await gasTx.wait();
                console.log(`   ✅ Gas refilled for ${agent.personality.name}: ${ethers.formatEther(gasFunding.amount)} ${config.blockchain.currencySymbol}`);
                
                // Verify balance after refill
                const newBalance = await prov.getBalance(agent.wallet.address);
                console.log(`   📊 ${agent.personality.name} gas balance now: ${ethers.formatEther(newBalance)} ${config.blockchain.currencySymbol}`);
            } catch (error: any) {
                console.error(`   ❌ Failed to refill gas for ${agent.personality.name}:`, error?.message);
                return { success: false }; // MUST return failure - can't trade without gas
            }
        } else {
            console.log(`   ✅ ${agent.personality.name} has sufficient gas: ${ethers.formatEther(nativeBalance)} ${config.blockchain.currencySymbol}`);
        }

        const gasPriceOverride = getGasPriceOverride();

        // Handle approval with fresh nonce
        if (allowance < amountWei) {
            try {
                console.log(`   🔐 Approving Router for ${agent.personality.name}...`);
                await sendWithFreshNonceForAgent(agentSigner, async (nonce) => {
                    try {
                        return await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce, ...gasPriceOverride });
                    } catch (approvalError: any) {
                        // Handle rate limits during approval
                        if (approvalError?.code === 429 || approvalError?.message?.includes('rate limit') || approvalError?.message?.includes('exceeded')) {
                            const switched = await handleRateLimitError(approvalError);
                            if (switched) {
                                // Retry with new provider
                                const prov = getProvider();
                                const newAgentSigner = getAgentSigner(agent, prov);
                                const newToken = new ethers.Contract(actualTokenIn, [
                                    'function approve(address,uint256) returns (bool)',
                                ], newAgentSigner) as unknown as { approve: (address: string, amount: bigint, overrides?: any) => Promise<any> };
                                if (!newToken || !newToken.approve) {
                                    throw new Error('Token contract not initialized');
                                }
                                return await newToken.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce, ...gasPriceOverride });
                            }
                        }
                        throw approvalError;
                    }
                });
                console.log(`   ✅ Approval confirmed for ${agent.personality.name}`);
            } catch (error: any) {
                const errorMsg = error?.message || error?.reason || error?.code || 'Unknown error';
                console.error(`❌ Approval failed for ${agent.personality.name}:`, errorMsg);
                // Don't crash - return failure instead
                return { success: false };
            }
        } else {
            console.log(`   ✅ ${agent.personality.name} already has sufficient allowance`);
        }

        // Handle swap with fresh nonce
        try {
            console.log(`   🔄 Executing swap for ${agent.personality.name}...`);
            console.log(`   📋 Swap params: proposalId=${proposalId}, tokenIn=${actualTokenIn}, amountIn=${ethers.formatEther(amountWei)}, minOut=${ethers.formatEther(minOutWei)}`);
            
            // Validate proposal exists before swapping (prevent contract revert)
            // Skip validation if it fails - let the swap itself handle the error
            try {
                const yesTokenAddress = await Promise.race([
                    router.getYesTokenAddress(proposalId).catch(() => null),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
                ]);
                
                if (yesTokenAddress && yesTokenAddress !== ethers.ZeroAddress) {
                    console.log(`   ✅ Proposal ${proposalId} validated`);
                } else {
                    console.log(`   ⚠️  Could not validate proposal ${proposalId}, proceeding anyway`);
                }
            } catch (proposalError: any) {
                // Don't fail on validation error - let swap handle it
                console.log(`   ⚠️  Proposal validation skipped: ${proposalError?.message || 'Unknown error'}`);
            }
            
            const swapTx = await sendWithFreshNonceForAgent(agentSigner, async (nonce) => {
                try {
                    if (!agentRouter || !agentRouter.swap) {
                        throw new Error('Agent router not initialized');
                    }
                    return await agentRouter.swap(proposalId, actualTokenIn, amountWei, minOutWei, { nonce, ...gasPriceOverride });
                } catch (swapError: any) {
                    const swapErrorMsg = swapError?.message || swapError?.reason || swapError?.code || 'Unknown error';
                    
                    // Handle rate limit errors - try switching to fallback
                    if (swapError?.code === 429 || swapErrorMsg?.includes('compute units') || swapErrorMsg?.includes('rate limit') || swapErrorMsg?.includes('exceeded')) {
                        console.error(`   ⚠️  Rate limit detected:`, swapErrorMsg);
                        const switched = await handleRateLimitError(swapError);
                        if (switched && provider) {
                            // Retry with new provider
                            console.log(`   🔄 Retrying swap with fallback provider...`);
                            const newAgentSigner = getAgentSigner(agent, provider);
                            const newAgentRouter = new ethers.Contract(ROUTER_ADDRESS, routerArtifact.abi, newAgentSigner) as unknown as VerdictRouter;
                            if (!newAgentRouter || !newAgentRouter.swap) {
                                throw new Error('Agent router not initialized');
                            }
                            return await newAgentRouter.swap(proposalId, actualTokenIn, amountWei, minOutWei, { nonce, ...gasPriceOverride });
                        }
                        throw new Error('Rate limit - retry later');
                    }
                    
                    console.error(`   ❌ Contract swap call failed:`, swapErrorMsg);
                    if (swapError?.data) {
                        console.error(`   Error data:`, swapError.data);
                    }
                    throw swapError;
                }
            });
            console.log(`   ✅ Swap confirmed for ${agent.personality.name}: ${swapTx.hash}`);
            
            return { success: true, txHash: swapTx.hash };
        } catch (error: any) {
            const errorMsg = error?.message || error?.reason || error?.code || 'Unknown error';
            console.error(`❌ Swap failed for ${agent.personality.name}:`, errorMsg);
            if (error?.data) {
                console.error(`   Error data:`, error.data);
            }
            // Return failure instead of throwing to prevent server crash
            return { success: false };
        }
    } catch (error: any) {
        const errorMsg = error?.message || error?.reason || error?.code || 'Unknown error';
        console.error(`❌ Swap execution error for ${agent.personality.name}:`, errorMsg);
        if (error?.stack) {
            console.error(`   Stack:`, error.stack.substring(0, 200));
        }
        return { success: false };
    }
}

export async function getTokenBalance(tokenAddress: string, accountAddress: string): Promise<number> {
    try {
        const prov = getProvider();
        const token = new ethers.Contract(tokenAddress, [
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)'
        ], prov) as unknown as ERC20;

        const [bal, dec] = await Promise.all([
            token.balanceOf(accountAddress),
            token.decimals().catch(() => 18n)
        ]);
        return parseFloat(ethers.formatUnits(bal, dec));
    } catch { return 0; }
}

export async function getProposalStatus(id: string): Promise<any> {
    try { return await getRouter().getProposalStatus(id); } catch { return null; }
}

export async function getAgentVUSDCBalance(agentAddress: string): Promise<number> {
    try {
        const balance = await getRouter().getVUSDCBalance(agentAddress);
        return parseFloat(ethers.formatUnits(balance, 18));
    } catch { return 0; }
}

export async function getYesTokenAddress(proposalId: string): Promise<string> {
    try { 
        return await Promise.race([
            getRouter().getYesTokenAddress(proposalId).catch(() => ''),
            new Promise<string>((resolve) => setTimeout(() => resolve(''), 5000))
        ]);
    } catch (error: any) {
        // Silently fail - don't crash on validation errors
        return ''; 
    }
}

export async function getAgentYESBalance(proposalId: string, agentAddress: string): Promise<number> {
    try {
        const balance = await getRouter().getYESBalance(proposalId, agentAddress);
        return parseFloat(ethers.formatUnits(balance, 18));
    } catch { return 0; }
}

export async function getYESPriceFromChain(proposalId: string): Promise<number> {
    try {
        const price = await getRouter().getYESPrice(proposalId);
        return parseFloat(ethers.formatUnits(price, 18));
    } catch { return 0.5; }
}

export async function getPoolReserves(proposalId: string): Promise<{ vUSDC: number; yes: number }> {
    try {
        const res = await getRouter().getPoolReserves(proposalId);
        return {
            vUSDC: parseFloat(ethers.formatUnits(res.vUSDCReserve, 18)),
            yes: parseFloat(ethers.formatUnits(res.yesReserve, 18))
        };
    } catch { return { vUSDC: 0, yes: 0 }; }
}

/**
 * Calculate how many YES tokens you get for a given amount of vUSD using the contract's swap formula
 * This matches the actual on-chain swap calculation
 */
export async function calculateYESForVUSDOnChain(
    proposalId: string,
    vUSDAmount: number
): Promise<number> {
    try {
        const router = getRouter();
        const vUSDCAddress = VUSDCADDRESS;
        
        // Get the pool reserves to calculate swap
        const reserves = await getPoolReserves(proposalId);
        if (reserves.vUSDC === 0 || reserves.yes === 0) return 0;
        
        // Use the same calculation as the contract
        const { calculateYESForVUSDSwap } = await import('../engine/amm');
        return calculateYESForVUSDSwap(vUSDAmount, reserves.vUSDC, reserves.yes);
    } catch (error) {
        console.error('Failed to calculate YES for vUSD:', error);
        return 0;
    }
}

export async function initializeMarketOnChain(duration: number): Promise<string | null> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        const gasPriceOverride = getGasPriceOverride();
        const nonce = await signer.getNonce('pending');
        const tx = await router.initializeMarket(duration, { nonce, ...gasPriceOverride });
        await tx.wait();
        return tx.hash;
    } catch { return null; }
}

export async function initializeMarketWithProposalsBatch(
    duration: number,
    proposals: any[]
): Promise<{ success: boolean; txHashes: string[] }> {
    const router = getRouter();
    const signer = getBackendSigner();
    const txHashes: string[] = [];

    const gasPriceOverride = getGasPriceOverride();

    // Try batch first (assuming contract has this method)
    try {
        console.log(`\nTrying batch initialization for ${proposals.length} proposals...`);
        const proposalsToCreate = proposals.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            evalLogic: p.evaluationLogic,
            mathLogic: p.mathematicalLogic,
            resolutionDeadline: p.resolutionDeadline,
            initialLiquidity: ethers.parseUnits("2000", 18)
        }));

        const nonce = await signer.getNonce('pending');
        const tx = await router.initializeMarketWithProposals(duration, proposalsToCreate, { nonce, ...gasPriceOverride });
        await tx.wait();
        txHashes.push(tx.hash);
        console.log(`Batch successful`);
        return { success: true, txHashes };
    } catch (batchError: any) {
        console.warn(`⚠️  Batch failed, falling back to sequential: ${batchError?.message}`);
    }

    // Fallback: Sequential
    try {
        let nonce = await signer.getNonce('pending');
        const initTx = await router.initializeMarket(duration, { nonce: nonce++, ...gasPriceOverride });
        await initTx.wait();
        txHashes.push(initTx.hash);

        for (const p of proposals) {
            console.log(`Creating: ${p.name}...`);
            nonce = await signer.getNonce('pending'); // Get fresh nonce for each proposal
            const tx = await router.createProposal(
                p.id, p.name, p.description, p.evaluationLogic, p.mathematicalLogic, p.resolutionDeadline, ethers.parseUnits("2000", 18), { nonce: nonce++, ...gasPriceOverride }
            );
            await tx.wait();
            txHashes.push(tx.hash);
            // Small delay between proposals
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return { success: true, txHashes };
    } catch { return { success: false, txHashes }; }
}

export async function getCurrentRoundOnChain(): Promise<number> {
    try { return Number(await getRouter().currentRound()); } catch { return 0; }
}

export async function getRoundInfoOnChain(): Promise<{
    roundNumber: number;
    roundStartTime: number;
    roundEndTime: number;
    roundDuration: number;
    proposalIds: string[];
    active: boolean;
} | null> {
    try {
        const info = await getRouter().getRoundInfo();
        return {
            roundNumber: Number(info.roundNumber),
            roundStartTime: Number(info.roundStartTime) * 1000, // Convert to ms
            roundEndTime: Number(info.roundEndTime) * 1000,
            roundDuration: Number(info.roundDuration) * 1000,
            proposalIds: info.proposalIds,
            active: info.active
        };
    } catch (e) {
        console.error('Failed to fetch round info:', e);
        return null;
    }
}

export async function graduateProposalOnChain(proposalId: string, finalPrice: number): Promise<string | null> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        const priceWei = ethers.parseUnits(finalPrice.toString(), 18);
        const gasPriceOverride = getGasPriceOverride();
        const nonce = await signer.getNonce('pending');
        const tx = await router.graduateProposal(proposalId, priceWei, { nonce, ...gasPriceOverride });
        await tx.wait();
        return tx.hash;
    } catch { return null; }
}

export async function fetchGraduatedProposalsOnChain(): Promise<MarketStrategy[]> {
    try {
        const router = getRouter();
        const ids = await router.getGraduatedProposals();
        const strategies: MarketStrategy[] = [];
        
        // Import in-memory graduated proposals to preserve usedDataSources
        const { getGraduatedProposals } = await import('../core/db');
        const inMemoryGraduated = getGraduatedProposals();

        for (const id of ids) {
            const p = await router.getProposalStatus(id);
            
            // Try to find matching in-memory proposal to preserve usedDataSources
            const inMemoryMatch = inMemoryGraduated.find(im => im.id === id);
            const preservedDataSources = inMemoryMatch?.usedDataSources || [];
            
            strategies.push({
                id: p.id,
                name: p.name,
                description: p.description,
                evaluationLogic: p.evaluationLogic,
                mathematicalLogic: p.mathematicalLogic,
                usedDataSources: preservedDataSources, // Preserve from in-memory if available
                resolutionDeadline: Number(p.resolutionDeadline),
                timestamp: Number(p.timestamp),
                resolved: p.resolved,
                winner: p.isWinner ? 'yes' : 'no',
                yesToken: {
                    tokenReserve: 0,
                    volume: 0,
                    history: [],
                    twap: parseFloat(ethers.formatUnits(p.yesTWAP, 18)),
                    twapHistory: []
                },
                noToken: {
                    tokenReserve: 0,
                    volume: 0,
                    history: [],
                    twap: 1 - parseFloat(ethers.formatUnits(p.yesTWAP, 18)),
                    twapHistory: []
                }
            });
        }
        return strategies;
    } catch { return []; }
}
