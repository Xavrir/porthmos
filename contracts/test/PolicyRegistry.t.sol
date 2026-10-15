// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AegisTestBase} from "./utils/AegisTestBase.sol";
import {AegisModule} from "../src/AegisModule.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";

contract PolicyRegistryTest is AegisTestBase {
    function test_R1_bankCannotWidenPolicy() public {
        vm.startPrank(bank);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.addVault(safe, address(vaultC));

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setAuthorizer(safe, bank);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setAutoCap(safe, AUTO_CAP + 1);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setDailyCap(safe, DAILY_CAP + 1);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setMaxBandWidth(safe, MAX_BAND_WIDTH + 1);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setMaxOracleAge(safe, MAX_ORACLE_AGE + 1);

        registry.quarantine(safe, address(vaultA));
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.clearQuarantine(safe, address(vaultA));

        vm.stopPrank();
        assertFalse(registry.allowedVault(safe, address(vaultC)));
        assertEq(registry.authorizer(safe), authorizer);
        assertEq(registry.autoCap(safe), AUTO_CAP);
        assertTrue(registry.quarantined(safe, address(vaultA)));
    }

    function test_R2_ownerCannotLiftBankFreeze() public {
        vm.prank(bank);
        registry.bankFreeze(safe);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(owner);
        registry.bankUnfreeze(safe);

        vm.prank(owner);
        registry.setAuthorizer(safe, authorizer);
        assertTrue(registry.bankFrozen(safe), "setAuthorizer does not clear the bank freeze");

        vm.prank(bank);
        registry.bankUnfreeze(safe);
        assertFalse(registry.bankFrozen(safe));
    }

    function test_R3_bankRevokesAuthorizer() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);

        vm.prank(bank);
        registry.revokeAuthorizer(safe);
        assertEq(registry.authorizer(safe), address(0));
        assertTrue(registry.bankFrozen(safe), "bank revoke sets the bank freeze");

        AegisModule.DAR memory exitDar = _redeemDar(address(vaultA), shares, 0);
        bytes memory oldAuthExitSig = _signDar(authorizerPk, exitDar);
        vm.expectRevert(AegisModule.BadSignature.selector);
        module.redeem(exitDar, oldAuthExitSig);

        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory oldAuthSig = _signDar(authorizerPk, dar);
        vm.expectRevert(AegisModule.Frozen.selector);
        module.deposit(dar, oldAuthSig, "", "", _emptyApproval());

        vm.prank(bank);
        registry.bankUnfreeze(safe);
        dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        oldAuthSig = _signDar(authorizerPk, dar);
        vm.expectRevert(AegisModule.BadSignature.selector);
        module.deposit(dar, oldAuthSig, "", "", _emptyApproval());

        module.redeem(exitDar, _signDar(exitKeyPk, exitDar));
        assertEq(vaultA.balanceOf(safe), 0, "exit key still redeems after revocation");
    }

    function test_R4_exitKeyCannotClearQuarantine() public {
        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        vm.warp(block.timestamp + 25 hours);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(exitKey);
        registry.clearQuarantine(safe, address(vaultA));
        assertTrue(registry.quarantined(safe, address(vaultA)));
    }

    function test_bankCanOnlyTighten() public {
        uint64 versionBefore = registry.policyVersion(safe);
        vm.startPrank(bank);
        registry.setAutoCap(safe, AUTO_CAP - 1);
        registry.setDailyCap(safe, DAILY_CAP - 1);
        registry.setMaxBandWidth(safe, MAX_BAND_WIDTH - 1);
        registry.setMaxOracleAge(safe, MAX_ORACLE_AGE - 1);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setAutoCap(safe, AUTO_CAP - 1);
        registry.removeVault(safe, address(vaultB));
        vm.stopPrank();

        assertEq(registry.autoCap(safe), AUTO_CAP - 1);
        assertEq(registry.maxOracleAge(safe), MAX_ORACLE_AGE - 1);
        assertFalse(registry.allowedVault(safe, address(vaultB)));
        assertEq(registry.policyVersion(safe), versionBefore + 5);
    }

    function test_ownerOnlyAndBankOnlyFunctions() public {
        vm.startPrank(attacker);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setReserveFloor(safe, 0, bytes32(0));
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setExitKey(safe, attacker);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.ownerUnfreeze(safe);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.quarantine(safe, address(vaultA));
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.revokeAuthorizer(safe);
        vm.stopPrank();

        vm.startPrank(owner);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setBankLimit(safe, 0);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.bankFreeze(safe);
        registry.ownerFreeze(safe);
        registry.ownerUnfreeze(safe);
        registry.revokeAuthorizer(safe);
        vm.stopPrank();
        assertFalse(registry.bankFrozen(safe), "owner revoke does not set the bank freeze");

        vm.startPrank(bank);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.ownerUnfreeze(safe);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        registry.setReserveFloor(safe, 0, bytes32(0));
        vm.stopPrank();
    }

    function test_quarantineCooldownAndReset() public {
        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        uint256 first = registry.quarantinedAt(safe, address(vaultA));

        vm.warp(block.timestamp + 23 hours);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(owner);
        registry.clearQuarantine(safe, address(vaultA));

        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        assertGt(registry.quarantinedAt(safe, address(vaultA)), first, "a new trigger restarts the cooldown");

        vm.warp(block.timestamp + 23 hours);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(owner);
        registry.clearQuarantine(safe, address(vaultA));

        vm.warp(block.timestamp + 1 hours);
        vm.prank(owner);
        registry.clearQuarantine(safe, address(vaultA));
        assertFalse(registry.quarantined(safe, address(vaultA)));
    }

    function test_policyChangedEventAndVersion() public {
        uint64 next = registry.policyVersion(safe) + 1;
        vm.expectEmit(true, false, false, true, address(registry));
        emit PolicyRegistry.PolicyChanged(safe, next, PolicyRegistry.ownerFreeze.selector);
        vm.prank(owner);
        registry.ownerFreeze(safe);
        assertEq(registry.policyVersion(safe), next);

        vm.expectEmit(true, true, false, true, address(registry));
        emit PolicyRegistry.Quarantined(safe, address(vaultB), bank);
        vm.prank(bank);
        registry.quarantine(safe, address(vaultB));
    }

    function test_registerRequiresSafeOwnerOnce() public {
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(owner);
        registry.register(safe, owner, bank);

        address otherSafe = _deploySafe(owner);
        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(attacker);
        registry.register(otherSafe, attacker, attacker);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(attacker);
        registry.register(otherSafe, owner, attacker);

        vm.prank(owner);
        registry.register(otherSafe, owner, bank);
        assertEq(registry.owner(otherSafe), owner);
        assertEq(registry.policyVersion(otherSafe), 1);
    }

    function test_registerMultiOwnerSafeNeedsSafeItself() public {
        address[] memory owners = new address[](2);
        owners[0] = owner;
        owners[1] = attacker;
        address sharedSafe = _deploySafe(owners, 2);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);
        vm.prank(attacker);
        registry.register(sharedSafe, attacker, attacker);

        vm.prank(sharedSafe);
        registry.register(sharedSafe, owner, bank);
        assertEq(registry.owner(sharedSafe), owner);
    }

    function test_unregisteredSafeCannotUseModule() public {
        address otherSafe = _deploySafe(owner);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 1, 2, bytes32(0));
        dar.safe = otherSafe;
        dar.policyVersion = 0;
        bytes memory sig = _signDar(authorizerPk, dar);
        vm.expectRevert(AegisModule.VaultNotAllowed.selector);
        module.deposit(dar, sig, "", "", _emptyApproval());

        AegisModule.DAR memory exitDar = _redeemDar(address(vaultA), 1, 0);
        exitDar.safe = otherSafe;
        bytes memory exitSig = _signDar(exitKeyPk, exitDar);
        vm.expectRevert(AegisModule.BadSignature.selector);
        module.redeem(exitDar, exitSig);
    }
}
