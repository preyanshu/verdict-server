const hre = require("hardhat");
require("dotenv").config({ path: "../.env" });

async function main() {
    // Detect network from Hardhat config
    const networkName = hre.network.name;
    const networkConfig = hre.config.networks[networkName];
    const chainId = networkConfig?.chainId || hre.network.config.chainId;
    
    // Network-specific info
    const networkInfo = {
        mantleTestnet: { symbol: "MNT", faucet: "https://faucet.sepolia.mantle.xyz/" },
        arbitrumSepolia: { symbol: "ETH", faucet: "https://faucet.quicknode.com/arbitrum/sepolia" },
        hardhat: { symbol: "ETH", faucet: null }
    };
    
    const info = networkInfo[networkName] || { symbol: "ETH", faucet: null };
    
    console.log(`🚀 Deploying Verdict Prediction Market to ${networkName} (Chain ID: ${chainId})\n`);

    const [deployer] = await hre.ethers.getSigners();
    console.log("Deployer:", deployer.address);
    
    const balance = await hre.ethers.provider.getBalance(deployer.address);
    console.log("Balance:", hre.ethers.formatEther(balance), info.symbol, "\n");

    if (balance === 0n && info.faucet) {
        throw new Error(`❌ No ${info.symbol} balance! Get testnet tokens from: ${info.faucet}`);
    }

    const backendSigner = process.env.BACKEND_ADDRESS || deployer.address;
    console.log("Backend Signer:", backendSigner, "\n");

    // Network-specific gas settings
    // Arbitrum uses provider-estimated gas prices, Mantle uses fixed 0.02 gwei
    const gasSettings = networkName === 'arbitrumSepolia' ? {} : {
        gasPrice: hre.ethers.parseUnits("0.02", "gwei"),
    };

    // ========== Deploy all contracts ==========
    console.log("📦 Deploying contracts...\n");

    // 1. vUSDC Token
    console.log("[1/5] Deploying VerdictVirtualUSDCToken...");
    const VerdictVirtualUSDCToken = await hre.ethers.getContractFactory("VerdictVirtualUSDCToken");
    const vUSDC = await VerdictVirtualUSDCToken.deploy(gasSettings);
    await vUSDC.waitForDeployment();
    const vUSDCAddress = await vUSDC.getAddress();
    console.log("  ✅ vUSDC:", vUSDCAddress);

    // 2. Registry
    console.log("[2/5] Deploying VerdictProposalRegistryStorage...");
    const VerdictProposalRegistryStorage = await hre.ethers.getContractFactory("VerdictProposalRegistryStorage");
    const registry = await VerdictProposalRegistryStorage.deploy(gasSettings);
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("  ✅ Registry:", registryAddress);

    // 3. Factory
    console.log("[3/5] Deploying VerdictYESTokenDeployerFactory...");
    const VerdictYESTokenDeployerFactory = await hre.ethers.getContractFactory("VerdictYESTokenDeployerFactory");
    const factory = await VerdictYESTokenDeployerFactory.deploy(gasSettings);
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("  ✅ Factory:", factoryAddress);

    // 4. AMM
    console.log("[4/5] Deploying VerdictSimpleAMM...");
    const VerdictSimpleAMM = await hre.ethers.getContractFactory("VerdictSimpleAMM");
    const amm = await VerdictSimpleAMM.deploy(gasSettings);
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();
    console.log("  ✅ AMM:", ammAddress);

    // 5. Router (with all addresses)
    console.log("[5/5] Deploying VerdictPredictionMarketRouter...");
    const VerdictRouter = await hre.ethers.getContractFactory("VerdictPredictionMarketRouter");
    const router = await VerdictRouter.deploy(
        backendSigner,
        vUSDCAddress,
        registryAddress,
        factoryAddress,
        ammAddress,
        gasSettings
    );
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();
    console.log("  ✅ Router:", routerAddress);

    // ========== Setup permissions BEFORE transferring ownership ==========
    console.log("\n🔧 Setting up permissions...\n");

    const setupGasOpts = networkName === 'arbitrumSepolia' ? {} : {
        gasPrice: hre.ethers.parseUnits("0.02", "gwei"),
    };

    // Helper to get fresh nonce
    const getFreshNonce = async () => {
        return await deployer.getNonce('pending');
    };

    // vUSDC: authorize Router as minter (deployer is still owner)
    let nonce = await getFreshNonce();
    let tx = await vUSDC.authorizeMinter(routerAddress, { ...setupGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ vUSDC minter authorized");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // Registry: set Router as market contract (deployer is still owner)
    nonce = await getFreshNonce();
    tx = await registry.setMarketContract(routerAddress, { ...setupGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ Registry market contract set");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // Factory: set Router as market contract (deployer is still owner)
    nonce = await getFreshNonce();
    tx = await factory.setMarketContract(routerAddress, { ...setupGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ Factory market contract set");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // AMM: set Router (deployer is still owner)
    nonce = await getFreshNonce();
    tx = await amm.setRouter(routerAddress, { ...setupGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ AMM router set");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // ========== Transfer ownership to Router ==========
    console.log("\n🔐 Transferring ownership to Router...\n");

    const ownershipGasOpts = networkName === 'arbitrumSepolia' ? {} : {
        gasPrice: hre.ethers.parseUnits("0.02", "gwei"),
    };

    nonce = await getFreshNonce();
    tx = await vUSDC.transferOwnership(routerAddress, { ...ownershipGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ vUSDC ownership transferred");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // Registry doesn't have transferOwnership, but marketContract is already set
    console.log("  ✅ Registry already configured (no ownership transfer needed)");

    nonce = await getFreshNonce();
    tx = await factory.transferOwnership(routerAddress, { ...ownershipGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ Factory ownership transferred");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    nonce = await getFreshNonce();
    tx = await amm.transferOwnership(routerAddress, { ...ownershipGasOpts, nonce });
    await tx.wait();
    console.log("  ✅ AMM ownership transferred");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for nonce update

    // ========== Summary ==========
    console.log("\n" + "=".repeat(60));
    console.log("📋 DEPLOYMENT COMPLETE!");
    console.log("=".repeat(60));
    console.log(`
  vUSDC:    ${vUSDCAddress}
  Registry: ${registryAddress}
  Factory:  ${factoryAddress}
  AMM:      ${ammAddress}
  Router:   ${routerAddress}
`);

    const explorerUrls = {
        mantleTestnet: "https://sepolia.mantlescan.xyz/",
        arbitrumSepolia: "https://sepolia.arbiscan.io/",
        hardhat: "https://etherscan.io/"
    };
    const explorerUrl = explorerUrls[networkName] || process.env.BLOCK_EXPLORER_URL || "https://etherscan.io/";
    console.log(`🔗 Block Explorer: ${explorerUrl}address/${routerAddress}`);
    
    console.log("\n📝 Update your .env file:");
    console.log(`ROUTER_ADDRESS=${routerAddress}`);
    
    console.log("\n✅ All contracts deployed and configured!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });

