// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

contract MockVault is ERC4626, Ownable {
    uint256 public liquidityCap = type(uint256).max;
    uint256 public withdrawnSinceCap;
    bool public depositReverts;
    bool public redeemReverts;

    error DepositDisabled();
    error RedeemDisabled();

    event LiquidityCapSet(uint256 assets);
    event Accrued(uint256 assets);
    event RevertModeSet(bool deposit, bool redeem);

    constructor(IERC20 asset_, string memory name_, string memory symbol_, address admin)
        ERC20(name_, symbol_)
        ERC4626(asset_)
        Ownable(admin)
    {}

    function setLiquidityCap(uint256 assets) external onlyOwner {
        liquidityCap = assets;
        withdrawnSinceCap = 0;
        emit LiquidityCapSet(assets);
    }

    function accrue(uint256 assets) external onlyOwner {
        IMintable(asset()).mint(address(this), assets);
        emit Accrued(assets);
    }

    function setRevertMode(bool deposit_, bool redeem_) external onlyOwner {
        depositReverts = deposit_;
        redeemReverts = redeem_;
        emit RevertModeSet(deposit_, redeem_);
    }

    function remainingLiquidity() public view returns (uint256) {
        if (liquidityCap == type(uint256).max) return type(uint256).max;
        return liquidityCap > withdrawnSinceCap ? liquidityCap - withdrawnSinceCap : 0;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), remainingLiquidity());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 remaining = remainingLiquidity();
        uint256 byBalance = super.maxRedeem(owner);
        if (remaining == type(uint256).max) return byBalance;
        return Math.min(byBalance, _convertToShares(remaining, Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (depositReverts) revert DepositDisabled();
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
    {
        if (redeemReverts) revert RedeemDisabled();
        if (liquidityCap != type(uint256).max) withdrawnSinceCap += assets;
        super._withdraw(caller, receiver, owner, assets, shares);
    }
}
