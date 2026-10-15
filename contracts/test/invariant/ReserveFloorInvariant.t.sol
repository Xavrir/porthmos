// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AegisTestBase} from "../utils/AegisTestBase.sol";
import {AegisModule} from "../../src/AegisModule.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {MockPriceFeed} from "../../src/MockPriceFeed.sol";

contract DepositHandler is Test {
    AegisModule internal immutable module;
    PolicyRegistry internal immutable registry;
    MockPriceFeed internal immutable feed;
    IERC20 internal immutable usdc;
    address internal immutable safe;
    address internal immutable feedAdmin;
    address[2] internal vaults;
    uint256 internal immutable ownerPk;
    uint256 internal immutable bankPk;
    uint256 internal immutable authorizerPk;
    uint256 internal immutable exitKeyPk;
    uint256 internal nonceSeed;

    uint256 public executedDeposits;
    uint256 public rejectedDeposits;

    constructor(
        AegisModule module_,
        PolicyRegistry registry_,
        MockPriceFeed feed_,
        address safe_,
        address[2] memory vaults_,
        uint256[4] memory keys
    ) {
        module = module_;
        registry = registry_;
        feed = feed_;
        usdc = module_.usdc();
        safe = safe_;
        feedAdmin = msg.sender;
        vaults = vaults_;
        (ownerPk, bankPk, authorizerPk, exitKeyPk) = (keys[0], keys[1], keys[2], keys[3]);
    }

    function deposit(uint256 vaultSeed, uint256 amount) external {
        address vault = vaults[vaultSeed % 2];
        uint256 balance = usdc.balanceOf(safe);
        amount = bound(amount, 1, balance + 1_000e6);
        (, int256 price,,,) = feed.latestRoundData();
        uint64 version = registry.policyVersion(safe);

        AegisModule.Approval memory ap = AegisModule.Approval({
            safe: safe,
            op: 0,
            vault: vault,
            maxAmount: amount,
            policyVersion: version,
            approvalExpiry: uint64(block.timestamp + 1 days),
            approvalNonce: _nonce()
        });
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 0,
            vault: vault,
            amount: amount,
            minOut: 0,
            policyVersion: version,
            priceLow: price - 1e6,
            priceHigh: price + 1e6,
            tier: 4,
            approvalHash: module.approvalStructHash(ap),
            nonce: _nonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: bytes32(0)
        });
        bytes32 approvalDigest = module.hashApproval(ap);
        bytes memory authSig = _sign(authorizerPk, module.hashDAR(dar));
        bytes memory ownerSig = _sign(ownerPk, approvalDigest);
        bytes memory bankSig = _sign(bankPk, approvalDigest);

        try module.deposit(dar, authSig, ownerSig, bankSig, ap) {
            executedDeposits++;
        } catch {
            rejectedDeposits++;
        }
    }

    function redeem(uint256 vaultSeed, uint256 shares) external {
        address vault = vaults[vaultSeed % 2];
        uint256 held = IERC20(vault).balanceOf(safe);
        if (held == 0) return;
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 1,
            vault: vault,
            amount: bound(shares, 1, held),
            minOut: 0,
            policyVersion: 0,
            priceLow: 0,
            priceHigh: 0,
            tier: 1,
            approvalHash: bytes32(0),
            nonce: _nonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: bytes32(0)
        });
        module.redeem(dar, _sign(exitKeyPk, module.hashDAR(dar)));
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        vm.prank(feedAdmin);
        feed.poke();
    }

    function _nonce() internal returns (uint256) {
        return uint256(keccak256(abi.encode("f2", ++nonceSeed)));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

/// F2: with every signature available, no sequence of deposits leaves the Safe below its reserve floor.
contract ReserveFloorInvariantTest is AegisTestBase {
    DepositHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new DepositHandler(
            module, registry, feed, safe, [address(vaultA), address(vaultB)], [ownerPk, bankPk, authorizerPk, exitKeyPk]
        );
        targetContract(address(handler));
    }

    function invariant_F2_safeNeverBelowReserveFloor() public view {
        assertGe(usdc.balanceOf(safe), registry.reserveFloor(safe));
    }

    function afterInvariant() public view {
        assertGt(handler.executedDeposits() + handler.rejectedDeposits(), 0, "handler made no deposit attempts");
    }
}
