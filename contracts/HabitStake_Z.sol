pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HabitStaking is ZamaEthereumConfig {
    struct Habit {
        string name;
        euint32 encryptedCount;
        uint256 stakeAmount;
        uint256 targetCount;
        address creator;
        uint256 deadline;
        bool isActive;
        bool isCompleted;
    }

    mapping(string => Habit) public habits;
    mapping(string => mapping(address => uint256)) public userStakes;
    string[] public habitIds;

    event HabitCreated(string indexed habitId, address indexed creator);
    event StakeAdded(string indexed habitId, address indexed staker, uint256 amount);
    event HabitCompleted(string indexed habitId, uint256 decryptedCount);

    constructor() ZamaEthereumConfig() {}

    function createHabit(
        string calldata habitId,
        string calldata name,
        uint256 stakeAmount,
        uint256 targetCount,
        uint256 deadline
    ) external {
        require(bytes(habits[habitId].name).length == 0, "Habit already exists");
        require(stakeAmount > 0, "Stake amount must be positive");
        require(targetCount > 0, "Target count must be positive");
        require(deadline > block.timestamp, "Deadline must be in the future");

        habits[habitId] = Habit({
            name: name,
            encryptedCount: FHE.zero(),
            stakeAmount: stakeAmount,
            targetCount: targetCount,
            creator: msg.sender,
            deadline: deadline,
            isActive: true,
            isVerified: false
        });

        habitIds.push(habitId);
        emit HabitCreated(habitId, msg.sender);
    }

    function addStake(string calldata habitId) external payable {
        Habit storage habit = habits[habitId];
        require(habit.isActive, "Habit is not active");
        require(msg.value == habit.stakeAmount, "Incorrect stake amount");

        userStakes[habitId][msg.sender] += msg.value;
        emit StakeAdded(habitId, msg.sender, msg.value);
    }

    function recordActivity(
        string calldata habitId,
        externalEuint32 encryptedCount,
        bytes calldata inputProof
    ) external {
        Habit storage habit = habits[habitId];
        require(habit.isActive, "Habit is not active");
        require(block.timestamp <= habit.deadline, "Habit deadline has passed");
        require(
            FHE.isInitialized(FHE.fromExternal(encryptedCount, inputProof)),
            "Invalid encrypted input"
        );

        habit.encryptedCount = FHE.add(habit.encryptedCount, FHE.fromExternal(encryptedCount, inputProof));
    }

    function verifyCompletion(
        string calldata habitId,
        bytes memory abiEncodedClearCount,
        bytes memory decryptionProof
    ) external {
        Habit storage habit = habits[habitId];
        require(habit.isActive, "Habit is not active");
        require(!habit.isCompleted, "Habit already completed");
        require(block.timestamp > habit.deadline, "Habit deadline not reached");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(habit.encryptedCount);

        FHE.checkSignatures(cts, abiEncodedClearCount, decryptionProof);

        uint32 decodedCount = abi.decode(abiEncodedClearCount, (uint32));
        require(decodedCount >= habit.targetCount, "Target count not reached");

        habit.isCompleted = true;
        habit.isVerified = true;

        uint256 totalStake = habit.stakeAmount * habitIds.length;
        payable(habit.creator).transfer(totalStake);

        emit HabitCompleted(habitId, decodedCount);
    }

    function withdrawStake(string calldata habitId) external {
        Habit storage habit = habits[habitId];
        require(!habit.isCompleted, "Habit is completed");
        require(block.timestamp > habit.deadline, "Habit deadline not reached");

        uint256 stakeAmount = userStakes[habitId][msg.sender];
        require(stakeAmount > 0, "No stake to withdraw");

        userStakes[habitId][msg.sender] = 0;
        payable(msg.sender).transfer(stakeAmount);
    }

    function getHabit(string calldata habitId)
        external
        view
        returns (
            string memory name,
            uint256 stakeAmount,
            uint256 targetCount,
            address creator,
            uint256 deadline,
            bool isActive,
            bool isCompleted
        )
    {
        Habit storage habit = habits[habitId];
        return (
            habit.name,
            habit.stakeAmount,
            habit.targetCount,
            habit.creator,
            habit.deadline,
            habit.isActive,
            habit.isCompleted
        );
    }

    function getUserStake(string calldata habitId, address user)
        external
        view
        returns (uint256)
    {
        return userStakes[habitId][user];
    }

    function getAllHabitIds() external view returns (string[] memory) {
        return habitIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}

