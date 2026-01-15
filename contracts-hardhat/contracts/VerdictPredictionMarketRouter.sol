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
 * @dev Accepts pre-deployed contract addresses to reduce bytecode size.
 * 
 * DEPLOYMENT ORDER (deploy each separately, then Router):
 * 1. Deploy VerdictVirtualUSDCToken
 * 2. Deploy VerdictProposalRegistryStorage
 * 3. Deploy VerdictYESTokenDeployerFactory
 * 4. Deploy VerdictSimpleAMM
 * 5. Deploy VerdictPredictionMarketRouter (passing all addresses above)
 * 6. Call setupPermissions() on Router to configure all contracts
 */
contract VerdictPredictionMarketRouter is Ownable {
    
    // ============ External Contracts ============
    VerdictVirtualUSDCToken public vUSDCToken;
    VerdictProposalRegistryStorage public registry;
    VerdictYESTokenDeployerFactory public factory;
    VerdictSimpleAMM public amm;

    address public backendSigner;
    uint256 public currentRound;
    bool public isMarketActive;
    bool public permissionsConfigured;

    // Tracking
    mapping(string => address) public proposalToYesToken;
    mapping(string => bytes32) public proposalToPoolId;

    event ContractsLinked(address vUSDC, address registry, address factory, address amm);
    event PermissionsConfigured();
    event MarketStarted(uint256 round, uint256 endTime);
    event ProposalLaunched(string id, address yesToken, bytes32 poolId);
    event AgentRegistered(address agent, uint256 balance);
    event WinnerGraduated(string id, uint256 finalPrice);

    error OnlyBackend();
    error MarketInactive();
    error PermissionsAlreadyConfigured();
    error InvalidAddress();

    modifier onlyBackend() {
        if (msg.sender != backendSigner && msg.sender != owner()) revert OnlyBackend();
        _;
    }

    /**
     * @notice Deploy Router with pre-deployed contract addresses
     * @param _backendSigner Your backend wallet address
     * @param _vUSDC Address of deployed VerdictVirtualUSDCToken
     * @param _registry Address of deployed VerdictProposalRegistryStorage
     * @param _factory Address of deployed VerdictYESTokenDeployerFactory
     * @param _amm Address of deployed VerdictSimpleAMM
     */
    constructor(
        address _backendSigner,
        address _vUSDC,
        address _registry,
        address _factory,
        address _amm
    ) Ownable(msg.sender) {
        if (_backendSigner == address(0)) revert InvalidAddress();
        if (_vUSDC == address(0)) revert InvalidAddress();
        if (_registry == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();
        if (_amm == address(0)) revert InvalidAddress();

        backendSigner = _backendSigner;
        vUSDCToken = VerdictVirtualUSDCToken(_vUSDC);
        registry = VerdictProposalRegistryStorage(_registry);
        factory = VerdictYESTokenDeployerFactory(_factory);
        amm = VerdictSimpleAMM(_amm);

        emit ContractsLinked(_vUSDC, _registry, _factory, _amm);
    }

    /**
     * @notice Setup permissions on all contracts (call after deployment)
     * @dev Must be called by owner. Each contract must have transferred ownership to Router first.
     */
    function setupPermissions() external onlyOwner {
        if (permissionsConfigured) revert PermissionsAlreadyConfigured();
        
        // Setup permissions - these require the contracts to have set this Router as authorized
        vUSDCToken.authorizeMinter(address(this));
        registry.setMarketContract(address(this));
        factory.setMarketContract(address(this));
        amm.setRouter(address(this));

        permissionsConfigured = true;
        emit PermissionsConfigured();
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
     * @notice Register AI agent - ensures they have exactly 100 vUSDC (mints or burns as needed)
     * @param agent Agent address to register
     */
    function registerAgent(address agent) external onlyBackend {
        uint256 targetAmount = 100 * 10**vUSDCToken.decimals();
        uint256 currentBalance = vUSDCToken.balanceOf(agent);
        
        if (currentBalance > targetAmount) {
            // Burn excess to bring to 100
            uint256 excess = currentBalance - targetAmount;
            vUSDCToken.burn(agent, excess);
        } else if (currentBalance < targetAmount) {
            // Mint deficiency to bring to 100
            uint256 deficiency = targetAmount - currentBalance;
            vUSDCToken.mint(agent, deficiency);
        }
        // If already at 100, do nothing
        
        emit AgentRegistered(agent, targetAmount);
    }

    /**
     * @notice Batch register multiple agents - ensures each has exactly 100 vUSDC
     * @param agents Array of agent addresses to register
     */
    function registerAgentsBatch(address[] calldata agents) external onlyBackend {
        uint256 targetAmount = 100 * 10**vUSDCToken.decimals();
        
        for (uint256 i = 0; i < agents.length; i++) {
            uint256 currentBalance = vUSDCToken.balanceOf(agents[i]);
            
            if (currentBalance > targetAmount) {
                // Burn excess to bring to 100
                uint256 excess = currentBalance - targetAmount;
                vUSDCToken.burn(agents[i], excess);
            } else if (currentBalance < targetAmount) {
                // Mint deficiency to bring to 100
                uint256 deficiency = targetAmount - currentBalance;
                vUSDCToken.mint(agents[i], deficiency);
            }
            // If already at 100, do nothing
            
            emit AgentRegistered(agents[i], targetAmount);
        }
    }

    /**
     * @notice Reset an agent's balance to exactly 100 vUSDC (burn excess or mint deficiency)
     * @param agent Agent address to reset
     */
    function resetAgentBalanceTo100(address agent) external onlyBackend {
        uint256 targetAmount = 100 * 10**vUSDCToken.decimals();
        uint256 currentBalance = vUSDCToken.balanceOf(agent);
        
        if (currentBalance > targetAmount) {
            // Burn excess
            uint256 excess = currentBalance - targetAmount;
            vUSDCToken.burn(agent, excess);
        } else if (currentBalance < targetAmount) {
            // Mint deficiency
            uint256 deficiency = targetAmount - currentBalance;
            vUSDCToken.mint(agent, deficiency);
        }
        // If already at target, do nothing
        
        emit AgentRegistered(agent, targetAmount);
    }

    /**
     * @notice Batch reset multiple agents' balances to exactly 100 vUSDC
     * @param agents Array of agent addresses to reset
     */
    function resetAgentsBalanceTo100Batch(address[] calldata agents) external onlyBackend {
        uint256 targetAmount = 100 * 10**vUSDCToken.decimals();
        
        for (uint256 i = 0; i < agents.length; i++) {
            uint256 currentBalance = vUSDCToken.balanceOf(agents[i]);
            
            if (currentBalance > targetAmount) {
                // Burn excess
                uint256 excess = currentBalance - targetAmount;
                vUSDCToken.burn(agents[i], excess);
            } else if (currentBalance < targetAmount) {
                // Mint deficiency
                uint256 deficiency = targetAmount - currentBalance;
                vUSDCToken.mint(agents[i], deficiency);
            }
            // If already at target, do nothing
            
            emit AgentRegistered(agents[i], targetAmount);
        }
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
