// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./VerdictVirtualUSDCToken.sol";
import "./VerdictProposalRegistryStorage.sol";
import "./VerdictYESTokenDeployerFactory.sol";
import "./VerdictSimpleAMM.sol";
import "./utils/@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VerdictPredictionMarketRouter
 * @notice Central entry point for all Verdict Market operations.
 * @dev Deploys ALL contracts internally. NO external dependencies!
 * 
 * DEPLOYMENT: Only deploy this ONE contract. It creates everything else:
 * - VerdictVirtualUSDCToken (vUSDC)
 * - VerdictProposalRegistryStorage (Registry)
 * - VerdictYESTokenDeployerFactory (Token Factory)
 * - VerdictSimpleAMM (Built-in trading)
 */
contract VerdictPredictionMarketRouter is Ownable {
    
    // ============ Deployed Contracts ============
    VerdictVirtualUSDCToken public vUSDCToken;
    VerdictProposalRegistryStorage public registry;
    VerdictYESTokenDeployerFactory public factory;
    VerdictSimpleAMM public amm;

    address public backendSigner;
    uint256 public currentRound;
    bool public isMarketActive;

    // Tracking
    mapping(string => address) public proposalToYesToken;
    mapping(string => bytes32) public proposalToPoolId;

    event ContractsDeployed(address vUSDC, address registry, address factory, address amm);
    event MarketStarted(uint256 round, uint256 endTime);
    event ProposalLaunched(string id, address yesToken, bytes32 poolId);
    event AgentRegistered(address agent, uint256 balance);
    event WinnerGraduated(string id, uint256 finalPrice);

    error OnlyBackend();
    error MarketInactive();

    modifier onlyBackend() {
        if (msg.sender != backendSigner && msg.sender != owner()) revert OnlyBackend();
        _;
    }

    /**
     * @notice Deploy this ONE contract - it creates ALL others internally!
     * @param _backendSigner Your backend wallet address
     */
    constructor(address _backendSigner) Ownable(msg.sender) {
        require(_backendSigner != address(0), "Invalid backend signer");
        backendSigner = _backendSigner;

        // 1. Deploy vUSDC Token
        vUSDCToken = new VerdictVirtualUSDCToken();
        
        // 2. Deploy Registry
        registry = new VerdictProposalRegistryStorage();
        
        // 3. Deploy Token Factory
        factory = new VerdictYESTokenDeployerFactory();
        
        // 4. Deploy AMM
        amm = new VerdictSimpleAMM();

        // Setup permissions
        vUSDCToken.authorizeMinter(address(this));
        registry.setMarketContract(address(this));
        factory.setMarketContract(address(this));
        amm.setRouter(address(this));

        emit ContractsDeployed(
            address(vUSDCToken), 
            address(registry), 
            address(factory), 
            address(amm)
        );
    }

    // ================================================================
    //                      MARKET OPERATIONS
    // ================================================================

    struct ProposalInput {
        string id;
        string name;
        string description;
        string evalLogic;
        string mathLogic;
        uint256 resolutionDeadline;
        uint256 initialLiquidity;
    }

    function initializeMarket(uint256 duration) public onlyBackend {
        // ALWAYS CLEAR OLD DATA FOR A CLEAN START
        registry.clearMarket();
        
        isMarketActive = true;
        currentRound++; // Auto-increment
        registry.createMarket(currentRound, duration);
        emit MarketStarted(currentRound, block.timestamp + duration);
    }

    /**
     * @notice Batch initialization - starts round and creates all proposals in ONE transaction
     * @dev This solves nonce issues and ensures atomicity (all or nothing)
     */
    function initializeMarketWithProposals(
        uint256 duration,
        ProposalInput[] calldata proposalsToCreate
    ) external onlyBackend {
        // 1. Start the market round
        initializeMarket(duration);

        // 2. Create each proposal
        for (uint256 i = 0; i < proposalsToCreate.length; i++) {
            _createProposalInternal(proposalsToCreate[i]);
        }
    }

    function createProposal(
        string memory proposalId,
        string memory name,
        string memory description,
        string memory evalLogic,
        string memory mathLogic,
        uint256 resolutionDeadline,
        uint256 initialLiquidity
    ) external onlyBackend {
        _createProposalInternal(ProposalInput({
            id: proposalId,
            name: name,
            description: description,
            evalLogic: evalLogic,
            mathLogic: mathLogic,
            resolutionDeadline: resolutionDeadline,
            initialLiquidity: initialLiquidity
        }));
    }

    function _createProposalInternal(ProposalInput memory input) internal {
        // 1. Deploy YES Token via Factory
        address yesToken = factory.createYESToken(
            input.id, 
            string(abi.encodePacked("YES - ", input.name)), 
            string(abi.encodePacked("vYES-", input.id))
        );
        proposalToYesToken[input.id] = yesToken;
        
        // 2. Create AMM Pool
        bytes32 poolId = amm.createPool(input.id, address(vUSDCToken), yesToken);
        proposalToPoolId[input.id] = poolId;
        
        // 3. Add initial liquidity (50/50 for 0.5 starting price)
        if (input.initialLiquidity > 0) {
            vUSDCToken.mint(address(this), input.initialLiquidity);
            VerdictYESOutcomeToken(yesToken).mint(address(this), input.initialLiquidity);
            
            vUSDCToken.approve(address(amm), input.initialLiquidity);
            IERC20(yesToken).approve(address(amm), input.initialLiquidity);
            amm.addLiquidity(poolId, input.initialLiquidity, input.initialLiquidity);
        }
        
        // 4. Register in registry
        registry.addProposal(input.id, input.name, input.description, input.evalLogic, input.mathLogic, input.resolutionDeadline, yesToken);
        
        emit ProposalLaunched(input.id, yesToken, poolId);
    }

    function graduateProposal(string memory proposalId, uint256 finalPrice) external onlyBackend {
        registry.graduateProposal(proposalId, finalPrice);
        emit WinnerGraduated(proposalId, finalPrice);
    }

    // ================================================================
    //                          USER FUNCTIONS
    // ================================================================

    /**
     * @notice Allows any user to get 100 vUSDC to start trading
     */
    function userFaucet() external {
        vUSDCToken.faucetFromRouter(msg.sender, 100 * 10**vUSDCToken.decimals());
    }

    /**
     * @notice Register AI agents (minting them initial capital)
     */
    function registerAgent(address agent) external onlyBackend {
        uint256 amount = 500 * 10**vUSDCToken.decimals();
        vUSDCToken.mint(agent, amount);
        emit AgentRegistered(agent, amount);
    }

    /**
     * @notice Swap vUSDC for YES tokens (or vice versa)
     * @param proposalId Proposal to trade
     * @param tokenIn Address of token to sell
     * @param amountIn Amount to sell
     * @param minAmountOut Minimum output (slippage protection)
     */
    function swap(
        string memory proposalId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        bytes32 poolId = proposalToPoolId[proposalId];
        require(poolId != bytes32(0), "Pool not found");
        
        // Transfer tokens from user
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(address(amm), amountIn);
        
        // Execute swap
        amountOut = amm.swap(poolId, tokenIn, amountIn, minAmountOut);
        
        // Transfer output to user
        address tokenOut = tokenIn == address(vUSDCToken) 
            ? proposalToYesToken[proposalId] 
            : address(vUSDCToken);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        
        return amountOut;
    }

    // ================================================================
    //                          GETTERS
    // ================================================================

    function getProposalStatus(string memory id) external view returns (VerdictProposalRegistryStorage.Proposal memory) {
        return registry.getProposal(id);
    }

    function getGraduatedProposals() external view returns (string[] memory) {
        return registry.getGraduatedProposals();
    }

    function getRoundInfo() external view returns (VerdictProposalRegistryStorage.Market memory) {
        return registry.getCurrentMarket();
    }

    function getYesTokenAddress(string memory proposalId) external view returns (address) {
        return proposalToYesToken[proposalId];
    }

    /**
     * @notice Get current YES token price for a proposal
     * @param proposalId Proposal ID
     * @return price YES price (0.5e18 = 50% probability)
     */
    function getYESPrice(string memory proposalId) external view returns (uint256) {
        return amm.getYESPrice(proposalId);
    }

    /**
     * @notice Get expected output for a swap
     */
    function getSwapQuote(
        string memory proposalId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256) {
        bytes32 poolId = proposalToPoolId[proposalId];
        return amm.getAmountOut(poolId, tokenIn, amountIn);
    }

    /**
     * @notice Get pool reserves for a proposal
     */
    function getPoolReserves(string memory proposalId) external view returns (uint256 vUSDCReserve, uint256 yesReserve) {
        bytes32 poolId = proposalToPoolId[proposalId];
        return amm.getReserves(poolId);
    }

    /**
     * @notice Get all deployed contract addresses
     */
    function getDeployedContracts() external view returns (
        address _vUSDC,
        address _registry,
        address _factory,
        address _amm
    ) {
        return (
            address(vUSDCToken),
            address(registry),
            address(factory),
            address(amm)
        );
    }

    /**
     * @notice Get user's vUSDC balance
     */
    function getVUSDCBalance(address user) external view returns (uint256) {
        return vUSDCToken.balanceOf(user);
    }

    /**
     * @notice Get user's YES token balance for a proposal
     */
    function getYESBalance(string memory proposalId, address user) external view returns (uint256) {
        address yesToken = proposalToYesToken[proposalId];
        if (yesToken == address(0)) return 0;
        return IERC20(yesToken).balanceOf(user);
    }
}
