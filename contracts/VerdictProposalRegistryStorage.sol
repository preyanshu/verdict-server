// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title VerdictProposalRegistryStorage - On-Chain Storage for Active and Graduated Proposals
 * @notice Central registry for all prediction markets and graduated proposals
 * @dev Stores active markets, graduated winners, and market metadata on-chain
 */
contract VerdictProposalRegistryStorage {
    struct Proposal {
        string id;
        string name;
        string description;
        string evaluationLogic;
        string mathematicalLogic;
        uint256 resolutionDeadline;
        address poolAddress;
        bool resolved;
        bool isWinner;
        uint256 yesTWAP;
        uint256 timestamp;
    }

    struct Market {
        uint256 roundNumber;
        uint256 roundStartTime;
        uint256 roundEndTime;
        uint256 roundDuration;
        string[] proposalIds;
        bool active;
    }

    address public owner;
    address public marketContract;
    Market public currentMarket;
    mapping(string => Proposal) public proposals;
    string[] public graduatedProposalIds;
    string[] public activeProposalIds;

    event MarketCreated(uint256 roundNumber, uint256 startTime, uint256 endTime);
    event ProposalAdded(string indexed proposalId, string name, address poolAddress);
    event ProposalGraduated(string indexed proposalId, string name, uint256 yesTWAP);
    event MarketResolved(uint256 roundNumber, string winningProposalId);
    event MarketCleared();

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyMarketContract() {
        require(msg.sender == marketContract, "Only market contract");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setMarketContract(address _marketContract) external onlyOwner {
        require(_marketContract != address(0), "Invalid address");
        marketContract = _marketContract;
    }

    function createMarket(uint256 roundNumber, uint256 roundDuration) external onlyMarketContract {
        // ALLOW OVERWRITING - remove the active check
        
        currentMarket = Market({
            roundNumber: roundNumber,
            roundStartTime: block.timestamp,
            roundEndTime: block.timestamp + roundDuration,
            roundDuration: roundDuration,
            proposalIds: new string[](0),
            active: true
        });

        emit MarketCreated(roundNumber, block.timestamp, block.timestamp + roundDuration);
    }

    function addProposal(
        string memory proposalId,
        string memory name,
        string memory description,
        string memory evaluationLogic,
        string memory mathematicalLogic,
        uint256 resolutionDeadline,
        address poolAddress
    ) external onlyMarketContract {
        require(currentMarket.active, "No active market");
        require(poolAddress != address(0), "Invalid pool address");

        proposals[proposalId] = Proposal({
            id: proposalId,
            name: name,
            description: description,
            evaluationLogic: evaluationLogic,
            mathematicalLogic: mathematicalLogic,
            resolutionDeadline: resolutionDeadline,
            poolAddress: poolAddress,
            resolved: false,
            isWinner: false,
            yesTWAP: 0,
            timestamp: block.timestamp
        });

        currentMarket.proposalIds.push(proposalId);
        activeProposalIds.push(proposalId);

        emit ProposalAdded(proposalId, name, poolAddress);
    }

    function graduateProposal(string memory proposalId, uint256 yesTWAP) external onlyMarketContract {
        Proposal storage proposal = proposals[proposalId];
        require(bytes(proposal.id).length > 0, "Proposal not found");
        require(!proposal.resolved, "Already resolved");

        proposal.resolved = true;
        proposal.isWinner = true;
        proposal.yesTWAP = yesTWAP;

        graduatedProposalIds.push(proposalId);

        emit ProposalGraduated(proposalId, proposal.name, yesTWAP);
    }

    function resolveMarket(string memory winningProposalId) external onlyMarketContract {
        require(currentMarket.active, "No active market");
        currentMarket.active = false;
        emit MarketResolved(currentMarket.roundNumber, winningProposalId);
    }

    function clearMarket() external onlyMarketContract {
        delete activeProposalIds;
        delete currentMarket;
        emit MarketCleared();
    }

    function getGraduatedProposals() external view returns (string[] memory) {
        return graduatedProposalIds;
    }

    function getActiveProposals() external view returns (string[] memory) {
        return activeProposalIds;
    }

    function getProposal(string memory proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getCurrentMarket() external view returns (Market memory) {
        return currentMarket;
    }

    function isMarketActive() external view returns (bool) {
        return currentMarket.active;
    }

    function getTimeRemaining() external view returns (uint256) {
        if (!currentMarket.active || block.timestamp >= currentMarket.roundEndTime) {
            return 0;
        }
        return currentMarket.roundEndTime - block.timestamp;
    }
}
