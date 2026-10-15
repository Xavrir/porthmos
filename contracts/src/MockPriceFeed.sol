// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

contract MockPriceFeed is AggregatorV3Interface, Ownable {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public constant decimals = 8;
    uint256 public constant version = 1;
    string public constant description = "USDC / USD (mock)";

    address public keeper;
    uint80 public latestRound;
    mapping(uint80 => Round) internal _rounds;

    error Unauthorized();
    error NoRound();

    event KeeperSet(address indexed keeper);
    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(address admin, int256 initialAnswer) Ownable(admin) {
        _newRound(initialAnswer);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setPrice(int256 answer) external onlyOwner {
        _newRound(answer);
    }

    function poke() external {
        if (msg.sender != owner() && msg.sender != keeper) revert Unauthorized();
        _newRound(_rounds[latestRound].answer);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = _rounds[roundId];
        if (r.updatedAt == 0) revert NoRound();
        return (roundId, r.answer, r.updatedAt, r.updatedAt, roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint80 id = latestRound;
        Round memory r = _rounds[id];
        return (id, r.answer, r.updatedAt, r.updatedAt, id);
    }

    function _newRound(int256 answer) internal {
        uint80 id = latestRound + 1;
        latestRound = id;
        _rounds[id] = Round(answer, block.timestamp);
        emit AnswerUpdated(answer, id, block.timestamp);
    }
}
