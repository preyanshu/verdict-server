// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./utils/@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VerdictYESOutcomeToken - ERC20 YES Outcome Token for Uniswap V4 Pool Trading
 * @notice ERC20 token representing YES outcome for a prediction market proposal
 * @dev Trades against vUSDC in Uniswap V4 pool. NO is implicit (price = 1 - YES price)
 */
contract VerdictYESOutcomeToken is ERC20, Ownable {
    string public proposalId;
    address public marketContract;

    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    modifier onlyMarket() {
        require(msg.sender == marketContract, "Only market contract");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        string memory _proposalId
    ) ERC20(name, symbol) Ownable(msg.sender) {
        proposalId = _proposalId;
    }

    function setMarketContract(address _marketContract) external onlyOwner {
        require(_marketContract != address(0), "Invalid address");
        marketContract = _marketContract;
    }

    function mint(address to, uint256 amount) external onlyMarket {
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMarket {
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }
}
