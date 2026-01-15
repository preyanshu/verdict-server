require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config(); // Uses .env in contracts-hardhat/

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
        hardhat: {
            chainId: 31337,
        },
        mantleTestnet: {
            url: "https://rpc.sepolia.mantle.xyz/",
            chainId: 5003,
            accounts: process.env.BACKEND_PRIVATE_KEY ? [process.env.BACKEND_PRIVATE_KEY] : [],
            gasPrice: 20000000, // 0.02 gwei (Mantle optimized)
            gas: 8000000, // 8M gas limit
        },
        arbitrumSepolia: {
            url: "https://arb-sepolia.g.alchemy.com/v2/xS_B_Ws4NvFWfgI6zNmiS",
            chainId: 421614,
            accounts: process.env.BACKEND_PRIVATE_KEY ? [process.env.BACKEND_PRIVATE_KEY] : [],
            // Arbitrum uses standard gas pricing
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
