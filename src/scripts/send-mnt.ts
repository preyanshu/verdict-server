import { ethers } from 'ethers';
import { initBlockchain, getBackendSigner, getProvider } from '../blockchain';

async function sendMNT() {
  try {
    console.log('Initializing blockchain connection...');
    await initBlockchain();
    
    const signer = getBackendSigner();
    const provider = getProvider();
    
    const recipientAddress = '0x7B84d43717900fC0D06A262772C67737aF9Bb9dF';
    const amountMNT = 2.5;
    const amountWei = ethers.parseEther(amountMNT.toString());
    
    console.log(`\nSending ${amountMNT} MNT to ${recipientAddress}...`);
    console.log(`From: ${signer.address}`);
    
    // Check balance
    const balance = await provider.getBalance(signer.address);
    console.log(`Backend balance: ${ethers.formatEther(balance)} MNT`);
    
    if (balance < amountWei) {
      throw new Error(`Insufficient balance. Need ${amountMNT} MNT but have ${ethers.formatEther(balance)} MNT`);
    }
    
    // Get fresh nonce
    const nonce = await signer.getNonce('pending');
    console.log(`Using nonce: ${nonce}`);
    
    // Send transaction
    const tx = await signer.sendTransaction({
      to: recipientAddress,
      value: amountWei,
      nonce,
      gasPrice: ethers.parseUnits("0.02", "gwei")
    });
    
    console.log(`\n✅ Transaction sent: ${tx.hash}`);
    console.log(`Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt?.blockNumber}`);
    
    const { config } = await import('../core/config');
    console.log(`\n🔗 View on explorer: ${config.blockchain.blockExplorerUrl}/tx/${tx.hash}`);
    console.log(`\n✅ Successfully sent ${amountMNT} MNT to ${recipientAddress}`);
    
  } catch (error: any) {
    console.error(`\n❌ Error:`, error?.message || error);
    process.exit(1);
  }
}

sendMNT();

