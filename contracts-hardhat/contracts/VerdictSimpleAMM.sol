// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./utils/@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./utils/@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VerdictSimpleAMM - Built-in AMM for vUSDC/YES Token Trading
 * @notice Simple constant product market maker (x * y = k) like Uniswap
 * @dev No external dependencies - fully self-contained
 */
contract VerdictSimpleAMM is Ownable {
    
    struct Pool {
        address tokenA;      // Always vUSDC
        address tokenB;      // YES token for proposal
        uint256 reserveA;    // vUSDC reserve
        uint256 reserveB;    // YES token reserve
        bool exists;
    }
    
    // Pool ID => Pool data
    mapping(bytes32 => Pool) public pools;
    
    // Proposal ID => Pool ID
    mapping(string => bytes32) public proposalToPool;
    
    // Trading fee (0.3% = 30 basis points)
    uint256 public constant FEE_BPS = 30;
    uint256 public constant BPS_DENOMINATOR = 10000;
    
    // Router address that can manage pools
    address public router;
    
    event PoolCreated(bytes32 indexed poolId, string proposalId, address tokenA, address tokenB);
    event LiquidityAdded(bytes32 indexed poolId, uint256 amountA, uint256 amountB);
    event LiquidityRemoved(bytes32 indexed poolId, uint256 amountA, uint256 amountB);
    event Swap(bytes32 indexed poolId, address indexed trader, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);
    
    modifier onlyRouter() {
        require(msg.sender == router || msg.sender == owner(), "Only router");
        _;
    }
    
    constructor() Ownable(msg.sender) {}
    
    function setRouter(address _router) external onlyOwner {
        require(_router != address(0), "Invalid router");
        router = _router;
    }
    
    /**
     * @notice Create a new pool for a proposal
     * @param proposalId Proposal ID
     * @param tokenA vUSDC address
     * @param tokenB YES token address
     */
    function createPool(
        string memory proposalId,
        address tokenA,
        address tokenB
    ) external onlyRouter returns (bytes32 poolId) {
        poolId = keccak256(abi.encodePacked(proposalId, tokenA, tokenB));
        
        // NO CHECKS - Just create the record
        
        pools[poolId] = Pool({
            tokenA: tokenA,
            tokenB: tokenB,
            reserveA: 0,
            reserveB: 0,
            exists: true
        });
        
        proposalToPool[proposalId] = poolId;
        
        emit PoolCreated(poolId, proposalId, tokenA, tokenB);
        return poolId;
    }
    
    /**
     * @notice Add initial liquidity to a pool
     * @param poolId Pool ID
     * @param amountA Amount of vUSDC
     * @param amountB Amount of YES token
     */
    function addLiquidity(
        bytes32 poolId,
        uint256 amountA,
        uint256 amountB
    ) external onlyRouter {
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool not found");
        
        // Transfer tokens to this contract
        IERC20(pool.tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(pool.tokenB).transferFrom(msg.sender, address(this), amountB);
        
        pool.reserveA += amountA;
        pool.reserveB += amountB;
        
        emit LiquidityAdded(poolId, amountA, amountB);
    }
    
    /**
     * @notice Swap tokens using constant product formula
     * @param poolId Pool ID
     * @param tokenIn Address of input token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum output (slippage protection)
     * @return amountOut Actual output amount
     */
    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool not found");
        require(tokenIn == pool.tokenA || tokenIn == pool.tokenB, "Invalid token");
        
        bool isAtoB = (tokenIn == pool.tokenA);
        
        uint256 reserveIn = isAtoB ? pool.reserveA : pool.reserveB;
        uint256 reserveOut = isAtoB ? pool.reserveB : pool.reserveA;
        address tokenOut = isAtoB ? pool.tokenB : pool.tokenA;
        
        // Calculate output using x * y = k formula with fee
        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
        
        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut > 0, "Insufficient output");
        
        // Transfer tokens
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        
        // Update reserves
        if (isAtoB) {
            pool.reserveA += amountIn;
            pool.reserveB -= amountOut;
        } else {
            pool.reserveB += amountIn;
            pool.reserveA -= amountOut;
        }
        
        emit Swap(poolId, msg.sender, tokenIn, amountIn, tokenOut, amountOut);
        return amountOut;
    }
    
    /**
     * @notice Get the current price of tokenB in terms of tokenA
     * @param poolId Pool ID
     * @return price Price (scaled by 1e18)
     */
    function getPrice(bytes32 poolId) external view returns (uint256 price) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool not found");
        require(pool.reserveB > 0, "No liquidity");
        
        // Price = reserveA / reserveB (scaled by 1e18)
        return (pool.reserveA * 1e18) / pool.reserveB;
    }
    
    /**
     * @notice Get YES token price for a proposal (0 to 1 scaled by 1e18)
     * @param proposalId Proposal ID
     * @return yesPrice YES price (0.5e18 = 50% chance)
     */
    function getYESPrice(string memory proposalId) external view returns (uint256 yesPrice) {
        bytes32 poolId = proposalToPool[proposalId];
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool not found");
        require(pool.reserveA + pool.reserveB > 0, "No liquidity");
        
        // YES price = reserveA / (reserveA + reserveB)
        // This gives probability between 0 and 1
        return (pool.reserveA * 1e18) / (pool.reserveA + pool.reserveB);
    }
    
    /**
     * @notice Calculate output amount for a swap without executing
     * @param poolId Pool ID
     * @param tokenIn Input token address
     * @param amountIn Input amount
     * @return amountOut Expected output
     */
    function getAmountOut(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "Pool not found");
        
        bool isAtoB = (tokenIn == pool.tokenA);
        uint256 reserveIn = isAtoB ? pool.reserveA : pool.reserveB;
        uint256 reserveOut = isAtoB ? pool.reserveB : pool.reserveA;
        
        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - FEE_BPS);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * BPS_DENOMINATOR + amountInWithFee);
        
        return amountOut;
    }
    
    /**
     * @notice Get pool reserves
     * @param poolId Pool ID
     * @return reserveA vUSDC reserve
     * @return reserveB YES token reserve
     */
    function getReserves(bytes32 poolId) external view returns (uint256 reserveA, uint256 reserveB) {
        Pool storage pool = pools[poolId];
        return (pool.reserveA, pool.reserveB);
    }
    
    /**
     * @notice Get pool by proposal ID
     * @param proposalId Proposal ID
     * @return Pool data
     */
    function getPoolByProposal(string memory proposalId) external view returns (Pool memory) {
        bytes32 poolId = proposalToPool[proposalId];
        return pools[poolId];
    }
}
