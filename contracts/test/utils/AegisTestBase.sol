// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeL2} from "@safe-global/safe-smart-account/SafeL2.sol";
import {Safe} from "@safe-global/safe-smart-account/Safe.sol";
import {SafeProxyFactory} from "@safe-global/safe-smart-account/proxies/SafeProxyFactory.sol";
import {SafeProxy} from "@safe-global/safe-smart-account/proxies/SafeProxy.sol";
import {CompatibilityFallbackHandler} from "@safe-global/safe-smart-account/handler/CompatibilityFallbackHandler.sol";
import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";

import {MockUSDC} from "../../src/MockUSDC.sol";
import {MockPriceFeed} from "../../src/MockPriceFeed.sol";
import {MockVault} from "../../src/MockVault.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {AegisModule} from "../../src/AegisModule.sol";
import {AggregatorV3Interface} from "../../src/interfaces/AggregatorV3Interface.sol";

abstract contract AegisTestBase is Test {
    uint256 internal constant USDC = 1e6;
    int256 internal constant ONE_DOLLAR = 1e8;
    uint256 internal constant AUTO_CAP = 1_000 * USDC;
    uint256 internal constant DAILY_CAP = 5_000 * USDC;
    uint256 internal constant BANK_LIMIT = 3_000 * USDC;
    uint256 internal constant RESERVE_FLOOR = 4_500 * USDC;
    uint256 internal constant MAX_BAND_WIDTH = 2_000_000;
    uint256 internal constant MAX_ORACLE_AGE = 180;
    uint256 internal constant SAFE_FUNDING = 10_000 * USDC;
    uint256 internal constant VAULT_SEED = 100_000 * USDC;
    bytes32 internal constant SCHEDULE_HASH = keccak256("aegis.test.schedule");

    MockUSDC internal usdc;
    MockPriceFeed internal feed;
    MockVault internal vaultA;
    MockVault internal vaultB;
    MockVault internal vaultC;
    PolicyRegistry internal registry;
    AegisModule internal module;
    Safe internal safeContract;
    address internal safe;

    address internal owner;
    uint256 internal ownerPk;
    address internal bank;
    uint256 internal bankPk;
    address internal authorizer;
    uint256 internal authorizerPk;
    address internal exitKey;
    uint256 internal exitKeyPk;
    address internal attacker;
    uint256 internal attackerPk;
    address internal executor;
    address internal seeder;

    uint256 private _nonceCounter;

    function setUp() public virtual {
        vm.warp(1_760_000_000);

        (owner, ownerPk) = makeAddrAndKey("owner");
        (bank, bankPk) = makeAddrAndKey("bank");
        (authorizer, authorizerPk) = makeAddrAndKey("authorizer");
        (exitKey, exitKeyPk) = makeAddrAndKey("exitKey");
        (attacker, attackerPk) = makeAddrAndKey("attacker");
        executor = makeAddr("executor");
        seeder = makeAddr("seeder");

        usdc = new MockUSDC(address(this));
        feed = new MockPriceFeed(address(this), ONE_DOLLAR);
        vaultA = new MockVault(IERC20(address(usdc)), "Aegis Vault A", "avA", address(this));
        vaultB = new MockVault(IERC20(address(usdc)), "Aegis Vault B", "avB", address(this));
        vaultC = new MockVault(IERC20(address(usdc)), "Aegis Vault C", "avC", address(this));
        registry = new PolicyRegistry();
        module = new AegisModule(registry, IERC20(address(usdc)), AggregatorV3Interface(address(feed)));

        _seedVault(vaultA);
        _seedVault(vaultB);
        _seedVault(vaultC);

        safe = _deploySafe(owner);
        safeContract = Safe(payable(safe));
        _enableModule();

        vm.startPrank(owner);
        registry.register(safe, owner, bank);
        registry.addVault(safe, address(vaultA));
        registry.addVault(safe, address(vaultB));
        registry.setAuthorizer(safe, authorizer);
        registry.setExitKey(safe, exitKey);
        registry.setAutoCap(safe, AUTO_CAP);
        registry.setDailyCap(safe, DAILY_CAP);
        registry.setMaxBandWidth(safe, MAX_BAND_WIDTH);
        registry.setMaxOracleAge(safe, MAX_ORACLE_AGE);
        registry.setReserveFloor(safe, RESERVE_FLOOR, SCHEDULE_HASH);
        vm.stopPrank();

        vm.prank(bank);
        registry.setBankLimit(safe, BANK_LIMIT);

        usdc.mint(safe, SAFE_FUNDING);
    }

    function _seedVault(MockVault vault) internal {
        usdc.mint(seeder, VAULT_SEED);
        vm.startPrank(seeder);
        usdc.approve(address(vault), VAULT_SEED);
        vault.deposit(VAULT_SEED, seeder);
        vm.stopPrank();
    }

    function _deploySafe(address safeOwner) internal returns (address) {
        address[] memory owners = new address[](1);
        owners[0] = safeOwner;
        return _deploySafe(owners, 1);
    }

    function _deploySafe(address[] memory owners, uint256 threshold) internal returns (address) {
        SafeL2 singleton = new SafeL2();
        SafeProxyFactory factory = new SafeProxyFactory();
        CompatibilityFallbackHandler handler = new CompatibilityFallbackHandler();
        bytes memory initializer = abi.encodeCall(
            Safe.setup, (owners, threshold, address(0), "", address(handler), address(0), 0, payable(address(0)))
        );
        SafeProxy proxy = factory.createProxyWithNonce(address(singleton), initializer, 0);
        return address(proxy);
    }

    function _enableModule() internal {
        _execAsOwner(safe, abi.encodeCall(safeContract.enableModule, (address(module))));
        assertTrue(safeContract.isModuleEnabled(address(module)));
    }

    function _execAsOwner(address to, bytes memory data) internal returns (bool) {
        bytes memory prevalidated = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        vm.prank(owner);
        return safeContract.execTransaction(
            to, 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), prevalidated
        );
    }

    function _nextNonce() internal returns (uint256) {
        return uint256(keccak256(abi.encode("aegis.nonce", ++_nonceCounter)));
    }

    function _depositDar(address vault, uint256 amount, uint8 tier, bytes32 approvalHash)
        internal
        returns (AegisModule.DAR memory dar)
    {
        dar = AegisModule.DAR({
            safe: safe,
            op: uint8(AegisModule.Op.DEPOSIT),
            vault: vault,
            amount: amount,
            minOut: 0,
            policyVersion: registry.policyVersion(safe),
            priceLow: 99_000_000,
            priceHigh: 101_000_000,
            tier: tier,
            approvalHash: approvalHash,
            nonce: _nextNonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: keccak256(abi.encode("evidence", amount, vault))
        });
    }

    function _redeemDar(address vault, uint256 shares, uint256 minOut) internal returns (AegisModule.DAR memory dar) {
        dar = AegisModule.DAR({
            safe: safe,
            op: uint8(AegisModule.Op.REDEEM),
            vault: vault,
            amount: shares,
            minOut: minOut,
            policyVersion: registry.policyVersion(safe),
            priceLow: 0,
            priceHigh: 0,
            tier: uint8(AegisModule.Tier.T1),
            approvalHash: bytes32(0),
            nonce: _nextNonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: keccak256(abi.encode("exit", shares, vault))
        });
    }

    function _approval(address vault, uint256 maxAmount) internal returns (AegisModule.Approval memory ap) {
        ap = AegisModule.Approval({
            safe: safe,
            op: uint8(AegisModule.Op.DEPOSIT),
            vault: vault,
            maxAmount: maxAmount,
            policyVersion: registry.policyVersion(safe),
            approvalExpiry: uint64(block.timestamp + 24 hours),
            approvalNonce: _nextNonce()
        });
    }

    function _emptyApproval() internal pure returns (AegisModule.Approval memory ap) {}

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signDar(uint256 pk, AegisModule.DAR memory dar) internal view returns (bytes memory) {
        return _sign(pk, module.hashDAR(dar));
    }

    function _signApproval(uint256 pk, AegisModule.Approval memory ap) internal view returns (bytes memory) {
        return _sign(pk, module.hashApproval(ap));
    }

    function _seedPosition(address vault, uint256 amount) internal returns (uint256 shares) {
        uint256 before = IERC20(vault).balanceOf(safe);
        AegisModule.Approval memory ap = _approval(vault, amount);
        AegisModule.DAR memory dar = _depositDar(vault, amount, 3, module.approvalStructHash(ap));
        module.deposit(dar, _signDar(authorizerPk, dar), _signApproval(ownerPk, ap), "", ap);
        shares = IERC20(vault).balanceOf(safe) - before;
    }

    function _usdcBalance(address account) internal view returns (uint256) {
        return usdc.balanceOf(account);
    }
}
