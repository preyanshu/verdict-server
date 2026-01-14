const { ethers } = require("hardhat");

async function main() {
    const [sender] = await ethers.getSigners();
    const receiverAddress = "0x7B84d43717900fC0D06A262772C67737aF9Bb9dF";
    const amount = ethers.parseEther("10.0");

    console.log(`Sending 10 ETH from ${sender.address} to ${receiverAddress}...`);

    const tx = await sender.sendTransaction({
        to: receiverAddress,
        value: amount,
    });

    await tx.wait();

    console.log("Transaction confirmed!");
    console.log("Hash:", tx.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
