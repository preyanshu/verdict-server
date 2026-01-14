import { ethers } from 'ethers';

async function main() {
    const rpcUrl = "http://127.0.0.1:8545";
    const receiver = "0x7B84d43717900fC0D06A262772C67737aF9Bb9dF";
    const amount = "10.0"; // 10 ETH

    // Hardhat Account #0 private key
    const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`Sending ${amount} ETH from ${wallet.address} to ${receiver}...`);

    try {
        const tx = await wallet.sendTransaction({
            to: receiver,
            value: ethers.parseEther(amount)
        });

        console.log(`Transaction sent! Waiting for confirmation...`);
        const receipt = await tx.wait();

        console.log(`Success! Transaction Hash: ${tx.hash}`);
        console.log(`Block Number: ${receipt?.blockNumber}`);
    } catch (error) {
        console.error("Transfer failed:", error);
    }
}

main();
