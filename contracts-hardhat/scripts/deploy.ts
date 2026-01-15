import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main() {
    console.log("🚀 Deploying Verdict Prediction Market to Mantle Testnet\n");

    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log("Balance:", ethers.formatEther(balance), "MNT\n");

    if (balance === 0n) {
        throw new Error("❌ No MNT balance! Get testnet MNT from: https://faucet.sepolia.mantle.xyz/");
    }

    const backendSigner = process.env.BACKEND_ADDRESS || deployer.address;
    console.log("Backend Signer:", backendSigner, "\n");

    const gasSettings = {
        gasLimit: 3000000,
        gasPrice: ethers.parseUnits("0.02", "gwei"),
    };

    // ========== Deploy all contracts ==========
    console.log("📦 Deploying contracts...\n");

    // 1. vUSDC Token
    console.log("[1/5] Deploying VerdictVirtualUSDCToken...");
    const VerdictVirtualUSDCToken = await ethers.getContractFactory("VerdictVirtualUSDCToken");
    const vUSDC = await VerdictVirtualUSDCToken.deploy(gasSettings);
    await vUSDC.waitForDeployment();
    const vUSDCAddress = await vUSDC.getAddress();
    console.log("  ✅ vUSDC:", vUSDCAddress);

    // 2. Registry
    console.log("[2/5] Deploying VerdictProposalRegistryStorage...");
    const VerdictProposalRegistryStorage = await ethers.getContractFactory("VerdictProposalRegistryStorage");
    const registry = await VerdictProposalRegistryStorage.deploy(gasSettings);
    await registry.waitForDeployment();
    const registryAddress = await registry.getAddress();
    console.log("  ✅ Registry:", registryAddress);

    // 3. Factory
    console.log("[3/5] Deploying VerdictYESTokenDeployerFactory...");
    const VerdictYESTokenDeployerFactory = await ethers.getContractFactory("VerdictYESTokenDeployerFactory");
    const factory = await VerdictYESTokenDeployerFactory.deploy(gasSettings);
    await factory.waitForDeployment();
    const factoryAddress = await factory.getAddress();
    console.log("  ✅ Factory:", factoryAddress);

    // 4. AMM
    console.log("[4/5] Deploying VerdictSimpleAMM...");
    const VerdictSimpleAMM = await ethers.getContractFactory("VerdictSimpleAMM");
    const amm = await VerdictSimpleAMM.deploy(gasSettings);
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();
    console.log("  ✅ AMM:", ammAddress);

    // 5. Router (with all addresses)
    console.log("[5/5] Deploying VerdictPredictionMarketRouter...");
    const VerdictRouter = await ethers.getContractFactory("VerdictPredictionMarketRouter");
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

    // ========== Transfer ownership to Router ==========
    console.log("\n🔐 Transferring ownership to Router...\n");

    const ownershipGasOpts = {
        gasLimit: 100000,
        gasPrice: ethers.parseUnits("0.02", "gwei"),
    };

    let tx = await vUSDC.transferOwnership(routerAddress, ownershipGasOpts);
    await tx.wait();
    console.log("  ✅ vUSDC ownership transferred");

    tx = await registry.transferOwnership(routerAddress, ownershipGasOpts);
    await tx.wait();
    console.log("  ✅ Registry ownership transferred");

    tx = await factory.transferOwnership(routerAddress, ownershipGasOpts);
    await tx.wait();
    console.log("  ✅ Factory ownership transferred");

    tx = await amm.transferOwnership(routerAddress, ownershipGasOpts);
    await tx.wait();
    console.log("  ✅ AMM ownership transferred");

    // ========== Setup permissions ==========
    console.log("\n🔧 Setting up permissions...\n");
    
    tx = await router.setupPermissions({
        gasLimit: 500000,
        gasPrice: ethers.parseUnits("0.02", "gwei"),
    });
    await tx.wait();
    console.log("  ✅ Permissions configured");

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

    const explorerUrl = process.env.BLOCK_EXPLORER_URL || "https://sepolia.mantlescan.xyz/";
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

