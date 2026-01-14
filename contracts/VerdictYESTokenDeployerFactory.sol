// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VerdictYESOutcomeToken.sol";
import "./utils/@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VerdictYESTokenDeployerFactory - Factory for Deploying YES Outcome Tokens Per Proposal
 * @notice Factory contract to deploy YES tokens for each proposal
 * @dev Creates a new VerdictYESOutcomeToken contract per proposal for Uniswap V4 pool pairing
 */
contract VerdictYESTokenDeployerFactory is Ownable {
    mapping(string => address) public proposalToYesToken;
    address[] public allYesTokens;
    address public marketContract;

    event YESTokenCreated(
        string indexed proposalId, 
        address indexed tokenAddress, 
        string name, 
        string symbol
    );

    modifier onlyMarket() {
        require(msg.sender == marketContract, "Only market contract");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setMarketContract(address _marketContract) external onlyOwner {
        require(_marketContract != address(0), "Invalid address");
        marketContract = _marketContract;
    }

    function createYESToken(
        string memory proposalId,
        string memory name,
        string memory symbol
    ) external onlyMarket returns (address tokenAddress) {
        // ALWAYS DEPLOY NEW - No checks!
        VerdictYESOutcomeToken token = new VerdictYESOutcomeToken(name, symbol, proposalId);
        
        token.setMarketContract(marketContract);
        token.transferOwnership(marketContract);

        tokenAddress = address(token);
        proposalToYesToken[proposalId] = tokenAddress; // Overwrites old mapping
        allYesTokens.push(tokenAddress);

        emit YESTokenCreated(proposalId, tokenAddress, name, symbol);
        
        return tokenAddress;
    }

    function getYESToken(string memory proposalId) external view returns (address) {
        return proposalToYesToken[proposalId];
    }

    function getAllYESTokens() external view returns (address[] memory) {
        return allYesTokens;
    }

    function getTokenCount() external view returns (uint256) {
        return allYesTokens.length;
    }
}
