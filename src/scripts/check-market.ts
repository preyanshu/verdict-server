import { ethers } from 'ethers';
import { config } from '../core/config';
import routerArtifact from '../../abi/router.json';

// Configuration
const ROUTER_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PROPOSAL_IDS = ['strategy-1', 'strategy-2', 'strategy-3', 'strategy-4', 'strategy-5'];

async function checkMarket() {
    console.log('Checking Market State on Blockchain...');

    // Connect
    const provider = new ethers.JsonRpcProvider(config.blockchain.rpcUrl || 'http://localhost:8545');
    // Using any for the contract in the script to avoid complex typing for a debug utility
    const router = new ethers.Contract(ROUTER_ADDRESS, routerArtifact.abi, provider) as any;

    // 1. Check Router Connection
    try {
        const code = await provider.getCode(ROUTER_ADDRESS);
        if (code === '0x') {
            console.error('Router contract not found at address!');
            return;
        }
        console.log('Router contract found');
    } catch (e) {
        console.error('Failed to connect to provider:', e);
        return;
    }

    // 2. Check each proposal
    for (const id of PROPOSAL_IDS) {
        try {
            console.log(`\n📄 Checking Proposal: ${id}`);

            // Check Pool ID mapping
            const poolId = await router.proposalToPoolId(id);
            console.log(`   Pool ID: ${poolId}`);

            if (poolId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
                console.error(`   Pool ID mapping is ZERO! Proposal creation failed?`);
                continue;
            }

            // Check YES Token
            const yesToken = await router.getYesTokenAddress(id);
            console.log(`   YES Token: ${yesToken}`);

            // Get AMM address
            const contracts = await router.getDeployedContracts();
            const ammAddress = contracts._amm;
            console.log(`   AMM Address: ${ammAddress}`);

        } catch (e: any) {
            console.error(`   Error checking ${id}:`, e.message);
        }
    }

    console.log('\nDiagnosis Complete');
}

checkMarket().catch(console.error);
