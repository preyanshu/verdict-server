require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../.env" });

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        compilers: [
            {
                version: "0.8.24",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "cancun",
                },
            },
            {
                version: "0.8.26",
                settings: {
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                    evmVersion: "cancun",
                },
            },
        ],
    },
    networks: {
        mantleTestnet: {
            url: process.env.RPC_URL || "https://rpc.sepolia.mantle.xyz/",
            chainId: parseInt(process.env.CHAIN_ID || "5003"),
            accounts: process.env.BACKEND_PRIVATE_KEY ? [process.env.BACKEND_PRIVATE_KEY] : [],
            gasPrice: 20000000, // 0.02 gwei
            gas: 8000000, // 8M gas limit
        },
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",
    },
};
