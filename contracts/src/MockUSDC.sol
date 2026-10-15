// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
    uint256 internal constant OPEN_MINT_CHAIN_ID = 31337;

    mapping(address => bool) public minter;

    error Unauthorized();

    event MinterSet(address indexed account, bool allowed);

    constructor(address admin) ERC20("Mock USDC", "USDC") Ownable(admin) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        minter[account] = allowed;
        emit MinterSet(account, allowed);
    }

    function mint(address to, uint256 amount) external {
        if (block.chainid != OPEN_MINT_CHAIN_ID && msg.sender != owner() && !minter[msg.sender]) {
            revert Unauthorized();
        }
        _mint(to, amount);
    }
}
