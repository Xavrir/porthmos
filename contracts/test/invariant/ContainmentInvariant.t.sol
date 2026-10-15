// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Safe} from "@safe-global/safe-smart-account/Safe.sol";
import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";
import {AegisTestBase} from "../utils/AegisTestBase.sol";
import {MaliciousVault} from "../utils/MaliciousVault.sol";
import {AegisModule} from "../../src/AegisModule.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {MockPriceFeed} from "../../src/MockPriceFeed.sol";

contract ContainmentHandler is Test {
    AegisModule internal immutable module;
    PolicyRegistry internal immutable registry;
    MockPriceFeed internal immutable feed;
    IERC20 internal immutable usdc;
    address internal immutable safe;
    address internal immutable feedAdmin;
    address internal immutable executor;
    address internal immutable attacker;
    address[3] internal vaults;
    uint256[4] internal adversaryKeys;
    uint256 internal nonceSeed;

    uint256 public executedDeposits;
    uint256 public executedRedeems;

    constructor(
        AegisModule module_,
        PolicyRegistry registry_,
        MockPriceFeed feed_,
        address safe_,
        address[3] memory vaults_,
        uint256[4] memory adversaryKeys_,
        address executor_,
        address attacker_
    ) {
        module = module_;
        registry = registry_;
        feed = feed_;
        usdc = module_.usdc();
        safe = safe_;
        feedAdmin = msg.sender;
        vaults = vaults_;
        adversaryKeys = adversaryKeys_;
        executor = executor_;
        attacker = attacker_;
    }

    function deposit(uint256 signerSeed, uint256 vaultSeed, uint256 amount, uint8 tier, uint256 approvalSeed) external {
        address vault = vaults[vaultSeed % 3];
        amount = bound(amount, 1, 2_000e6);
        (, int256 price,,,) = feed.latestRoundData();

        AegisModule.Approval memory ap = AegisModule.Approval({
            safe: safe,
            op: 0,
            vault: vault,
            maxAmount: amount,
            policyVersion: registry.policyVersion(safe),
            approvalExpiry: uint64(block.timestamp + 1 days),
            approvalNonce: _nonce()
        });
        bool withApproval = approvalSeed % 2 == 0;
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 0,
            vault: vault,
            amount: amount,
            minOut: 0,
            policyVersion: registry.policyVersion(safe),
            priceLow: price - 1e6,
            priceHigh: price + 1e6,
            tier: uint8(bound(tier, 0, 5)),
            approvalHash: withApproval ? module.approvalStructHash(ap) : bytes32(0),
            nonce: _nonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: bytes32(0)
        });
        bytes memory authSig = _sign(_key(signerSeed), module.hashDAR(dar));
        bytes memory forgedOwnerSig = withApproval ? _sign(_key(approvalSeed >> 8), module.hashApproval(ap)) : bytes("");
        bytes memory bankSig = withApproval ? _sign(adversaryKeys[2], module.hashApproval(ap)) : bytes("");

        vm.prank(executor);
        try module.deposit(dar, authSig, forgedOwnerSig, bankSig, ap) {
            executedDeposits++;
        } catch {}
    }

    function redeem(uint256 signerSeed, uint256 vaultSeed, uint256 shares, uint256 minOut) external {
        address vault = vaults[vaultSeed % 3];
        uint256 held = IERC20(vault).balanceOf(safe);
        shares = bound(shares, 1, held == 0 ? 1 : held);
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 1,
            vault: vault,
            amount: shares,
            minOut: bound(minOut, 0, 1),
            policyVersion: 0,
            priceLow: 0,
            priceHigh: 0,
            tier: 1,
            approvalHash: bytes32(0),
            nonce: _nonce(),
            expiry: uint64(block.timestamp + 120),
            evidenceHash: bytes32(0)
        });
        bytes memory sig = _sign(_key(signerSeed), module.hashDAR(dar));
        vm.prank(executor);
        try module.redeem(dar, sig) {
            executedRedeems++;
        } catch {}
    }

    function bankAction(uint256 action, uint256 value, uint256 vaultSeed) external {
        address bank = vm.addr(adversaryKeys[2]);
        address vault = vaults[vaultSeed % 3];
        vm.startPrank(bank);
        uint256 a = action % 12;
        if (a == 0) {
            try registry.bankFreeze(safe) {} catch {}
        } else if (a == 1) {
            try registry.bankUnfreeze(safe) {} catch {}
        } else if (a == 2) {
            try registry.removeVault(safe, vault) {} catch {}
        } else if (a == 3) {
            try registry.setAutoCap(safe, value) {} catch {}
        } else if (a == 4) {
            try registry.setDailyCap(safe, value) {} catch {}
        } else if (a == 5) {
            try registry.setBankLimit(safe, value) {} catch {}
        } else if (a == 6) {
            try registry.setMaxBandWidth(safe, value) {} catch {}
        } else if (a == 7) {
            try registry.quarantine(safe, vault) {} catch {}
        } else if (a == 8) {
            try registry.addVault(safe, vault) {} catch {}
        } else if (a == 9) {
            try registry.setAuthorizer(safe, bank) {} catch {}
        } else if (a == 10) {
            try registry.setReserveFloor(safe, 0, bytes32(0)) {} catch {}
        } else {
            try registry.clearQuarantine(safe, vault) {} catch {}
        }
        vm.stopPrank();
    }

    function exitKeyAction(uint256 action, uint256 vaultSeed) external {
        address exitKey = vm.addr(adversaryKeys[1]);
        address vault = vaults[vaultSeed % 3];
        vm.startPrank(exitKey);
        if (action % 3 == 0) {
            try registry.quarantine(safe, vault) {} catch {}
        } else if (action % 3 == 1) {
            try registry.clearQuarantine(safe, vault) {} catch {}
        } else {
            try registry.addVault(safe, vault) {} catch {}
        }
        vm.stopPrank();
    }

    function directAttack(uint256 action, uint256 amount, uint256 signerSeed) external {
        amount = bound(amount, 1, 20_000e6);
        uint256 a = action % 4;
        if (a == 0) {
            vm.prank(attacker);
            try usdc.transferFrom(safe, attacker, amount) {} catch {}
        } else if (a == 1) {
            bytes memory data = abi.encodeCall(IERC20.transfer, (attacker, amount));
            bytes32 txHash = Safe(payable(safe))
                .getTransactionHash(
                    address(usdc),
                    0,
                    data,
                    Enum.Operation.Call,
                    0,
                    0,
                    0,
                    address(0),
                    address(0),
                    Safe(payable(safe)).nonce()
                );
            bytes memory sig = _sign(_key(signerSeed), txHash);
            vm.prank(executor);
            try Safe(payable(safe))
                .execTransaction(
                    address(usdc), 0, data, Enum.Operation.Call, 0, 0, 0, address(0), payable(address(0)), sig
                ) {}
                catch {}
        } else if (a == 2) {
            vm.prank(attacker);
            try Safe(payable(safe))
                .execTransactionFromModule(
                    address(usdc), 0, abi.encodeCall(IERC20.transfer, (attacker, amount)), Enum.Operation.Call
                ) {}
                catch {}
        } else {
            vm.prank(attacker);
            try Safe(payable(safe)).enableModule(attacker) {} catch {}
        }
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
        vm.prank(feedAdmin);
        feed.poke();
    }

    function _key(uint256 seed) internal view returns (uint256) {
        return adversaryKeys[seed % 4];
    }

    function _nonce() internal returns (uint256) {
        return uint256(keccak256(abi.encode("f1", ++nonceSeed)));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

/// F1: an actor holding the bank, authorizer, exit and executor keys, plus a vault the owner never added,
/// cannot move USDC anywhere except between the Safe and the owner-added vaults.
contract ContainmentInvariantTest is AegisTestBase {
    ContainmentHandler internal handler;
    MaliciousVault internal malicious;
    uint256 internal containedTotal;

    function setUp() public override {
        super.setUp();
        _seedPosition(address(vaultA), 800 * USDC);
        malicious = new MaliciousVault(IERC20(address(usdc)), attacker);

        handler = new ContainmentHandler(
            module,
            registry,
            feed,
            safe,
            [address(vaultA), address(vaultB), address(malicious)],
            [authorizerPk, exitKeyPk, bankPk, attackerPk],
            executor,
            attacker
        );
        containedTotal = _contained();
        targetContract(address(handler));
    }

    function _contained() internal view returns (uint256) {
        return usdc.balanceOf(safe) + usdc.balanceOf(address(vaultA)) + usdc.balanceOf(address(vaultB));
    }

    function invariant_F1_fundsStayInSafeAndOwnerVaults() public view {
        assertEq(_contained(), containedTotal, "USDC left the Safe and owner-added vaults");
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(address(malicious)), 0);
        assertEq(usdc.balanceOf(executor), 0);
        assertEq(usdc.balanceOf(bank), 0);
        assertEq(usdc.balanceOf(authorizer), 0);
        assertEq(usdc.balanceOf(exitKey), 0);
        assertEq(usdc.allowance(safe, address(vaultA)), 0);
        assertEq(usdc.allowance(safe, address(vaultB)), 0);
        assertEq(usdc.allowance(safe, address(malicious)), 0);
        assertFalse(registry.allowedVault(safe, address(malicious)));
    }
}
