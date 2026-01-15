import { ethers } from 'ethers';
import { initBlockchain, getBackendSigner, getProvider, getGasPriceOverride } from '../blockchain';

async function sendMNT() {
  try {
    console.log('Initializing blockchain connection...');
    await initBlockchain();
    
    const signer = getBackendSigner();
    const provider = getProvider();
    
    const recipientAddress = '0x7B84d43717900fC0D06A262772C67737aF9Bb9dF';
    const { config } = await import('../core/config');
    const amountNative = 2.5;
    const amountWei = ethers.parseEther(amountNative.toString());
    
    console.log(`\nSending ${amountNative} ${config.blockchain.currencySymbol} to ${recipientAddress}...`);
    console.log(`From: ${signer.address}`);
    
    // Check balance
    const balance = await provider.getBalance(signer.address);
    console.log(`Backend balance: ${ethers.formatEther(balance)} ${config.blockchain.currencySymbol}`);
    
    if (balance < amountWei) {
      throw new Error(`Insufficient balance. Need ${amountNative} ${config.blockchain.currencySymbol} but have ${ethers.formatEther(balance)} ${config.blockchain.currencySymbol}`);
    }
    
    // Get fresh nonce
    const nonce = await signer.getNonce('pending');
    console.log(`Using nonce: ${nonce}`);
    
    // Send transaction
    const gasPriceOverride = getGasPriceOverride();
    const tx = await signer.sendTransaction({
      to: recipientAddress,
      value: amountWei,
      nonce,
      ...gasPriceOverride
    });
    
    console.log(`\n✅ Transaction sent: ${tx.hash}`);
    console.log(`Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt?.blockNumber}`);
    
    console.log(`\n🔗 View on explorer: ${config.blockchain.blockExplorerUrl}/tx/${tx.hash}`);
    console.log(`\n✅ Successfully sent ${amountNative} ${config.blockchain.currencySymbol} to ${recipientAddress}`);
    
  } catch (error: any) {
    console.error(`\n❌ Error:`, error?.message || error);
    process.exit(1);
  }
}

sendMNT();

