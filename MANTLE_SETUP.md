# Mantle Testnet Setup Guide

## Network Information

Your project is now configured to use **Mantle V2 Tectonic Sepolia Testnet**.

### Network Details

| Setting | Value |
|---------|-------|
| Network Name | Mantle Testnet (Sepolia) |
| RPC URL | https://rpc.sepolia.mantle.xyz/ |
| Chain ID | 5003 |
| Currency Symbol | MNT |
| Block Explorer | https://sepolia.mantlescan.xyz/ |

## Setup Steps

### 1. Add Mantle Testnet to MetaMask

**Option A: Using Chainlist (Recommended)**
- Visit: [Mantle V2 Tectonic Sepolia Testnet on Chainlist](https://chainlist.org/?search=mantle+sepolia)
- Connect your wallet
- Click "Add to Metamask"
- Approve in MetaMask

**Option B: Manual Setup**
1. Open MetaMask
2. Click network dropdown (top-left)
3. Click "Add Network"
4. Click "Add a network manually"
5. Fill in the details from the table above
6. Click "Save"

### 2. Get Test MNT Tokens

You'll need MNT tokens for gas fees on Mantle Testnet.

**Mantle Faucet:**
- Visit: https://faucet.sepolia.mantle.xyz/
- Connect your wallet
- Request testnet MNT

### 3. Configure Gas Settings (Important!)

Mantle v2 Tectonic has optimized fee mechanism. **Configure MetaMask for ultra-low fees:**

1. Create a transaction in MetaMask
2. Click "Next" → Click on gas fee
3. Select "Advanced" tab
4. Set:
   - **Max base fee:** 0.02 gwei
   - **Priority Fee:** 0 gwei
5. Check "Save these values as my default for the Mantle sepolia network"
6. Close settings

**Result:** Extremely fast and low-cost transactions! ⚡

### 4. Deploy Your Contracts

After getting test MNT:

```bash
# Navigate to contracts folder
cd contracts

# Deploy to Mantle Testnet
bunx hardhat run scripts/deploy.js --network mantleTestnet
```

### 5. Update Router Address

After deployment, update the `ROUTER_ADDRESS` in your `.env` file:

```env
ROUTER_ADDRESS=0xYourNewContractAddress
```

## Current Configuration

Your `.env` file is set to:
- ✅ **Network:** Mantle Testnet (Sepolia)
- ✅ **Chain ID:** 5003
- ✅ **RPC:** https://rpc.sepolia.mantle.xyz/
- ⚠️ **Router Address:** Update after deployment

## Hardhat Configuration

You may need to add Mantle Testnet to your `hardhat.config.js`:

```javascript
networks: {
  mantleTestnet: {
    url: 'https://rpc.sepolia.mantle.xyz/',
    chainId: 5003,
    accounts: [process.env.PRIVATE_KEY] // Add your deployer private key
  }
}
```

## Block Explorer

View your transactions on:
- https://sepolia.mantlescan.xyz/

## Resources

- **Faucet:** https://faucet.sepolia.mantle.xyz/
- **Docs:** https://docs.mantle.xyz/
- **Bridge:** https://bridge.testnet.mantle.xyz/
- **Explorer:** https://sepolia.mantlescan.xyz/

## Next Steps

1. ✅ Network configured in `.env`
2. ⬜ Add Mantle Testnet to MetaMask
3. ⬜ Get test MNT from faucet
4. ⬜ Configure gas settings (0.02 gwei base, 0 priority)
5. ⬜ Deploy contracts to Mantle Testnet
6. ⬜ Update `ROUTER_ADDRESS` in `.env`
7. ⬜ Run your prediction market on Mantle!

---

**Enjoy ultra-low fees and high-speed transactions on Mantle v2 Tectonic! 🚀**
