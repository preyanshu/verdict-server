// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./utils/@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VerdictVirtualUSDCToken - Virtual USD Coin for Verdict Prediction Markets
 * @notice Mock ERC20 token representing virtual USD for trading
 * @dev Only authorized market router contracts can mint/burn tokens
 */
contract VerdictVirtualUSDCToken is ERC20, Ownable {
    mapping(address => bool) public authorizedMinters;
    
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    constructor() ERC20("Virtual USD Coin", "vUSDC") Ownable(msg.sender) {
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    function authorizeMinter(address minter) external onlyOwner {
        require(minter != address(0), "Invalid minter address");
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function revokeMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }

    function mint(address to, uint256 amount) external {
        require(authorizedMinters[msg.sender], "Not authorized to mint");
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(authorizedMinters[msg.sender], "Not authorized to burn");
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    function faucet(uint256 amount) external {
        require(amount <= 1000 * 10**decimals(), "Max 1000 vUSDC per claim");
        _mint(msg.sender, amount);
        emit TokensMinted(msg.sender, amount);
    }

    function faucetFromRouter(address user, uint256 amount) external {
        require(authorizedMinters[msg.sender], "Only authorized router");
        _mint(user, amount);
        emit TokensMinted(user, amount);
    }
}
