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
    initializeMarketWithProposals(duration: number, proposals: any[]): Promise<ContractTransactionResponse>;
    vUSDCToken(): Promise<string>;
    swap(id: string, tokenIn: string, amountIn: bigint, minOut: bigint, overrides?: any): Promise<ContractTransactionResponse>;
    getVUSDCBalance(account: string): Promise<bigint>;
    getYesTokenAddress(id: string): Promise<string>;
    getYESBalance(id: string, account: string): Promise<bigint>;
    getYESPrice(id: string): Promise<bigint>;
    getPoolReserves(id: string): Promise<{ vUSDCReserve: bigint; yesReserve: bigint }>;
    currentRound(): Promise<bigint>;
    graduateProposal(id: string, finalPrice: bigint): Promise<ContractTransactionResponse>;
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

export const ROUTER_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

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

        // Using first Hardhat account for testing
        const hardhatPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        backendSigner = new Wallet(hardhatPrivateKey, provider);

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
        console.log(`Registering agent ${agent.personality.name} (${agent.wallet.address})...`);

        const tx = await router.registerAgent(agent.wallet.address);
        await tx.wait();
        console.log(`Agent registered`);

        return { success: true, txHash: tx.hash };
    } catch (error) {
        console.error(`❌ Failed to register agent:`, error);
        return { success: false };
    }
}

/**
 * Register all agents on-chain with proper nonce management
 */
export async function registerAllAgents(agents: Agent[]): Promise<string[]> {
    const router = getRouter();
    const vusdc = getVUSDC();
    const signer = getBackendSigner();
    const prov = getProvider();
    const txHashes: string[] = [];

    console.log(`\nSynchronizing ${agents.length} agents on-chain...`);

    let nonce = await signer.getNonce();
    const TARGET_BALANCE = 100;
    const TOTAL_NEEDED = agents.length * TARGET_BALANCE;

    let backendBalance = await vusdc.balanceOf(signer.address);
    const neededWei = ethers.parseUnits(TOTAL_NEEDED.toString(), 18);

    if (backendBalance < neededWei) {
        console.log(`Backend funds low. Tapping faucet...`);
        // Each faucet call via router gives 100 vUSDC
        const tapsNeeded = Math.ceil(Number(ethers.formatUnits(neededWei - backendBalance, 18)) / 100);
        for (let i = 0; i < tapsNeeded; i++) {
            const tx = await router.userFaucet({ nonce: nonce++ });
            await tx.wait();
            txHashes.push(tx.hash);
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
                const tx = await router.registerAgent(agent.wallet.address, { nonce: nonce++ });
                await tx.wait();
                txHashes.push(tx.hash);

                // Update local balance view
                const newBalanceWei = await vusdc.balanceOf(agent.wallet.address);
                const excess = newBalanceWei - targetWei;

                // Ensure agent has gas before transferring back
                const eth = await prov.getBalance(agent.wallet.address);
                if (eth < ethers.parseEther("0.05")) {
                    const gasTx = await signer.sendTransaction({ to: agent.wallet.address, value: ethers.parseEther("0.1"), nonce: nonce++ });
                    await gasTx.wait();
                    txHashes.push(gasTx.hash);
                }

                const agentSigner = getAgentSigner(agent, prov);
                const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;
                const agentNonce = await prov.getTransactionCount(agent.wallet.address);

                const returnTx = await agentVUSDC.transfer(signer.address, excess, { nonce: agentNonce });
                await returnTx.wait();
                txHashes.push(returnTx.hash);
                console.log(`   Reset to 100 (and replenished backend)`);
            } else if (balance > TARGET_BALANCE) {
                const excess = balanceWei - targetWei;
                const agentSigner = getAgentSigner(agent, prov);
                const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;

                // Ensure agent has gas
                const eth = await prov.getBalance(agent.wallet.address);
                if (eth < ethers.parseEther("0.05")) {
                    const tx = await signer.sendTransaction({ to: agent.wallet.address, value: ethers.parseEther("0.1"), nonce: nonce++ });
                    await tx.wait();
                    txHashes.push(tx.hash);
                }

                const agentNonce = await prov.getTransactionCount(agent.wallet.address);
                const tx = await agentVUSDC.transfer(signer.address, excess, { nonce: agentNonce });
                await tx.wait();
                txHashes.push(tx.hash);
                console.log(`   Reset to 100`);
            } else if (balance < TARGET_BALANCE) {
                const deficiency = targetWei - balanceWei;
                const tx = await vusdc.transfer(agent.wallet.address, deficiency, { nonce: nonce++ });
                await tx.wait();
                txHashes.push(tx.hash);
                console.log(`   Reset to 100`);
            }

            // Gas buffer
            const eth = await prov.getBalance(agent.wallet.address);
            if (eth < ethers.parseEther("0.1")) {
                const tx = await signer.sendTransaction({ to: agent.wallet.address, value: ethers.parseEther("0.5"), nonce: nonce++ });
                await tx.wait();
                txHashes.push(tx.hash);
            }

            // Unlimited approval
            const agentSigner = getAgentSigner(agent, prov);
            const agentVUSDC = vusdc.connect(agentSigner) as unknown as ERC20;
            const currentAllowance = await agentVUSDC.allowance(agent.wallet.address, ROUTER_ADDRESS);

            if (currentAllowance < targetWei) {
                const agentNonce = await prov.getTransactionCount(agent.wallet.address);
                const tx = await agentVUSDC.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce: agentNonce });
                await tx.wait();
                txHashes.push(tx.hash);
                console.log(`   Approved Router`);
            }
        } catch (error: any) {
            console.error(`❌ Sync failed for ${agent.personality.name}:`, error?.message);
        }
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
        const liquidityWei = ethers.parseUnits(liquidity.toString(), 18);

        const tx = await router.createProposal(
            proposalId, name, description, evalLogic, mathLogic, deadline, liquidityWei
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
        let nonce = await prov.getTransactionCount(agent.wallet.address, 'latest');

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

        const [bal, allowance] = await Promise.all([
            token.balanceOf(agent.wallet.address),
            token.allowance(agent.wallet.address, ROUTER_ADDRESS)
        ]);

        if (bal < amountWei) return { success: false };

        if (allowance < amountWei) {
            await (await token.approve(ROUTER_ADDRESS, ethers.MaxUint256, { nonce: nonce++ })).wait();
        }

        const tx = await agentRouter.swap(proposalId, actualTokenIn, amountWei, minOutWei, { nonce });
        await tx.wait();

        return { success: true, txHash: tx.hash };
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
        const tx = await getRouter().initializeMarket(duration);
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

        const tx = await router.initializeMarketWithProposals(duration, proposalsToCreate);
        await tx.wait();
        txHashes.push(tx.hash);
        console.log(`Batch successful`);
        return { success: true, txHashes };
    } catch (batchError: any) {
        console.warn(`⚠️  Batch failed, falling back to sequential: ${batchError?.message}`);
    }

    // Fallback: Sequential
    try {
        let nonce = await signer.getNonce();
        const initTx = await router.initializeMarket(duration, { nonce: nonce++ });
        await initTx.wait();
        txHashes.push(initTx.hash);

        for (const p of proposals) {
            console.log(`Creating: ${p.name}...`);
            const tx = await router.createProposal(
                p.id, p.name, p.description, p.evaluationLogic, p.mathematicalLogic, p.resolutionDeadline, ethers.parseUnits("2000", 18), { nonce: nonce++ }
            );
            await tx.wait();
            txHashes.push(tx.hash);
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
        const priceWei = ethers.parseUnits(finalPrice.toString(), 18);
        const tx = await getRouter().graduateProposal(proposalId, priceWei);
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
