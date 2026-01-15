import { ethers, BaseContract, JsonRpcProvider, Wallet, ContractTransactionResponse } from 'ethers';
import { config } from '../core/config';
import { getAgentSigner } from '../agents';
import type { Agent, MarketStrategy } from '../core/types';
import routerABI from '../../contracts/abi.json';

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
 * Initialize blockchain connection
 */
export async function initBlockchain(): Promise<boolean> {
    try {
        provider = new JsonRpcProvider(config.blockchain.rpcUrl);

        // Use backend private key from config (reads from .env)
        backendSigner = new Wallet(config.blockchain.backendPrivateKey, provider);

        routerContract = new ethers.Contract(ROUTER_ADDRESS, routerABI, backendSigner) as unknown as VerdictRouter;

        console.log('Blockchain initialized');
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

        const gasPrice = ethers.parseUnits("0.02", "gwei");
        const nonce = await signer.getNonce('pending');
        const tx = await router.registerAgent(agent.wallet.address, { nonce, gasPrice });
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
        const tx = await sendWithFreshNonce(signer, (nonce) =>
            router.registerAgentsBatch(agentAddresses, {
                nonce,
                gasPrice: ethers.parseUnits("0.02", "gwei")
            })
        );
        await tx.wait();

        console.log(`✅ Successfully registered ${agentAddresses.length} agents in batch`);
        
        // Fund all agents with native MNT for gas (they need this to make transactions)
        console.log(`\nFunding agents with native MNT for gas...`);
        const GAS_THRESHOLD = ethers.parseEther("0.1"); // Minimum gas balance
        const GAS_AMOUNT = ethers.parseEther("0.5"); // Amount to send
        
        for (const address of agentAddresses) {
            try {
                const balance = await prov.getBalance(address);
                if (balance < GAS_THRESHOLD) {
                    const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({
                            to: address,
                            value: GAS_AMOUNT,
                            nonce,
                            gasPrice: ethers.parseUnits("0.02", "gwei")
                        })
                    );
                    await gasTx.wait();
                    console.log(`   ✅ Funded ${address.substring(0, 10)}... with ${ethers.formatEther(GAS_AMOUNT)} MNT`);
                } else {
                    console.log(`   ⏭️  ${address.substring(0, 10)}... already has sufficient gas (${ethers.formatEther(balance)} MNT)`);
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
            const nonce = await prov.getTransactionCount(address, 'pending');
            const tx = await fn(nonce);
            await tx.wait();
            await new Promise(resolve => setTimeout(resolve, 500));
            return tx;
        } catch (error: any) {
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
        const tx = await sendWithFreshNonce(signer, (nonce) =>
            router.resetAgentsBalanceTo100Batch(agentAddresses, {
                nonce,
                gasPrice: ethers.parseUnits("0.02", "gwei")
            })
        );
        await tx.wait();

        console.log(`✅ Balance reset complete for ${agents.length} agents in single transaction`);
        console.log(`   Transaction: ${tx.hash}`);
        
        // Refill gas for agents who need it (they may have used gas during trading)
        console.log(`\nChecking and refilling gas for agents...`);
        const prov = getProvider();
        const GAS_THRESHOLD = ethers.parseEther("0.1");
        const GAS_AMOUNT = ethers.parseEther("0.5");
        
        for (const agent of agents) {
            try {
                const balance = await prov.getBalance(agent.wallet.address);
                if (balance < GAS_THRESHOLD) {
                    const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({
                            to: agent.wallet.address,
                            value: GAS_AMOUNT,
                            nonce,
                            gasPrice: ethers.parseUnits("0.02", "gwei")
                        })
                    );
                    await gasTx.wait();
                    console.log(`   ⛽ Refilled gas for ${agent.personality.name}`);
                }
                // Small delay to avoid nonce issues
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error: any) {
                console.error(`   ❌ Failed to refill gas for ${agent.personality.name}:`, error?.message);
            }
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
                const tx = await sendWithFreshNonce(signer, (nonce) => 
                    router.userFaucet({ nonce, gasPrice: ethers.parseUnits("0.02", "gwei") })
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
                    const tx = await sendWithFreshNonce(signer, (nonce) =>
                        router.registerAgent(agent.wallet.address, { nonce, gasPrice: ethers.parseUnits("0.02", "gwei") })
                    );
                    txHashes.push(tx.hash);

                    // Update local balance view
                    const newBalanceWei = await vusdc.balanceOf(agent.wallet.address);
                    const excess = newBalanceWei - targetWei;

                    // Ensure agent has gas before transferring back
                    const eth = await prov.getBalance(agent.wallet.address);
                    if (eth < ethers.parseEther("0.05")) {
                        const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                            signer.sendTransaction({ 
                                to: agent.wallet.address, 
                                value: ethers.parseEther("0.1"), 
                                nonce,
                                gasPrice: ethers.parseUnits("0.02", "gwei")
                            })
                        );
                        txHashes.push(gasTx.hash);
                    }

                    const agentSigner = getAgentSigner(agent, prov);
                    const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;
                    const agentNonce = await prov.getTransactionCount(agent.wallet.address, 'pending');

                    const returnTx = await agentVUSDC.transfer(signer.address, excess, { 
                        nonce: agentNonce,
                        gasPrice: ethers.parseUnits("0.02", "gwei")
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
                const eth = await prov.getBalance(agent.wallet.address);
                if (eth < ethers.parseEther("0.05")) {
                    try {
                        const tx = await sendWithFreshNonce(signer, (nonce) =>
                            signer.sendTransaction({ 
                                to: agent.wallet.address, 
                                value: ethers.parseEther("0.1"), 
                                nonce,
                                gasPrice: ethers.parseUnits("0.02", "gwei")
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
                        gasPrice: ethers.parseUnits("0.02", "gwei")
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
                            gasPrice: ethers.parseUnits("0.02", "gwei")
                        })
                    );
                    txHashes.push(tx.hash);
                    console.log(`   Reset to 100`);
                } catch (error: any) {
                    console.error(`   ❌ Transfer failed:`, error?.message);
                }
            }

            // Gas buffer
            const eth = await prov.getBalance(agent.wallet.address);
            if (eth < ethers.parseEther("0.1")) {
                try {
                    const tx = await sendWithFreshNonce(signer, (nonce) =>
                        signer.sendTransaction({ 
                            to: agent.wallet.address, 
                            value: ethers.parseEther("0.5"), 
                            nonce,
                            gasPrice: ethers.parseUnits("0.02", "gwei")
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
                        gasPrice: ethers.parseUnits("0.02", "gwei")
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
        const gasPrice = ethers.parseUnits("0.02", "gwei");

        const nonce = await signer.getNonce('pending');
        const tx = await router.createProposal(
            proposalId, name, description, evalLogic, mathLogic, deadline, liquidityWei,
            { nonce, gasPrice }
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
        const prov = getProvider();
        const router = getRouter();
        const agentSigner = getAgentSigner(agent, prov);

        const agentRouter = (new ethers.Contract(ROUTER_ADDRESS, routerABI, agentSigner)) as unknown as VerdictRouter;

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

        // Check and refill gas if needed (agents need native MNT to pay for gas)
        const GAS_THRESHOLD = ethers.parseEther("0.1"); // Minimum gas balance
        const GAS_AMOUNT = ethers.parseEther("0.5"); // Amount to send
        if (nativeBalance < GAS_THRESHOLD) {
            try {
                const signer = getBackendSigner();
                const gasTx = await sendWithFreshNonce(signer, (nonce) =>
                    signer.sendTransaction({
                        to: agent.wallet.address,
                        value: GAS_AMOUNT,
                        nonce,
                        gasPrice: ethers.parseUnits("0.02", "gwei")
                    })
                );
                await gasTx.wait();
                console.log(`   ⛽ Refilled gas for ${agent.personality.name}: ${ethers.formatEther(GAS_AMOUNT)} MNT`);
            } catch (error: any) {
                console.error(`   ❌ Failed to refill gas for ${agent.personality.name}:`, error?.message);
                // Continue anyway - maybe they have enough
            }
        }

        const gasPrice = ethers.parseUnits("0.02", "gwei");

        // Handle approval with fresh nonce
        if (allowance < amountWei) {
            try {
                await sendWithFreshNonceForAgent(agentSigner, async (nonce) => {
                    return await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce, gasPrice });
                });
            } catch (error: any) {
                console.error(`❌ Approval failed for ${agent.personality.name}:`, error?.message);
                return { success: false };
            }
        }

        // Handle swap with fresh nonce
        try {
            const tx = await sendWithFreshNonceForAgent(agentSigner, async (nonce) => {
                return await agentRouter.swap(proposalId, actualTokenIn, amountWei, minOutWei, { nonce, gasPrice });
            });
            await tx.wait();
            return { success: true, txHash: tx.hash };
        } catch (error: any) {
            console.error(`❌ Swap failed for ${agent.personality.name}:`, error?.message);
            return { success: false };
        }
    } catch (error: any) {
        console.error(`❌ Swap failed for ${agent.personality.name}:`, error?.message);
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
    try { return await getRouter().getYesTokenAddress(proposalId); } catch { return ''; }
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

export async function initializeMarketOnChain(duration: number): Promise<string | null> {
    try {
        const router = getRouter();
        const signer = getBackendSigner();
        const gasPrice = ethers.parseUnits("0.02", "gwei");
        const nonce = await signer.getNonce('pending');
        const tx = await router.initializeMarket(duration, { nonce, gasPrice });
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

    const gasPrice = ethers.parseUnits("0.02", "gwei");

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
        const tx = await router.initializeMarketWithProposals(duration, proposalsToCreate, { nonce, gasPrice });
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
        const initTx = await router.initializeMarket(duration, { nonce: nonce++, gasPrice });
        await initTx.wait();
        txHashes.push(initTx.hash);

        for (const p of proposals) {
            console.log(`Creating: ${p.name}...`);
            nonce = await signer.getNonce('pending'); // Get fresh nonce for each proposal
            const tx = await router.createProposal(
                p.id, p.name, p.description, p.evaluationLogic, p.mathematicalLogic, p.resolutionDeadline, ethers.parseUnits("2000", 18), { nonce: nonce++, gasPrice }
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
        const gasPrice = ethers.parseUnits("0.02", "gwei");
        const nonce = await signer.getNonce('pending');
        const tx = await router.graduateProposal(proposalId, priceWei, { nonce, gasPrice });
        await tx.wait();
        return tx.hash;
    } catch { return null; }
}

export async function fetchGraduatedProposalsOnChain(): Promise<MarketStrategy[]> {
    try {
        const router = getRouter();
        const ids = await router.getGraduatedProposals();
        const strategies: MarketStrategy[] = [];

        for (const id of ids) {
            const p = await router.getProposalStatus(id);
            strategies.push({
                id: p.id,
                name: p.name,
                description: p.description,
                evaluationLogic: p.evaluationLogic,
                mathematicalLogic: p.mathematicalLogic,
                usedDataSources: [],
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
