// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {AegisTestBase} from "./utils/AegisTestBase.sol";
import {AegisModule} from "../src/AegisModule.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MaliciousVault} from "./utils/MaliciousVault.sol";

contract AegisModuleTest is AegisTestBase {
    function _expectDepositRevert(
        AegisModule.DAR memory dar,
        bytes memory authSig,
        bytes memory ownerSig,
        bytes memory bankSig,
        AegisModule.Approval memory ap,
        bytes4 err
    ) internal {
        vm.expectRevert(err);
        vm.prank(executor);
        module.deposit(dar, authSig, ownerSig, bankSig, ap);
    }

    function test_C1_validT2DepositWithinCaps() public {
        _seedPosition(address(vaultA), 500 * USDC);
        uint256 amount = 800 * USDC;
        AegisModule.DAR memory dar = _depositDar(address(vaultA), amount, 2, bytes32(0));
        uint256 expectedShares = vaultA.previewDeposit(amount);
        uint256 safeUsdcBefore = _usdcBalance(safe);
        uint256 todayBefore = module.depositedToday(safe);
        bytes32 darHash = module.hashDAR(dar);
        bytes memory sig = _signDar(authorizerPk, dar);

        vm.expectEmit(true, true, true, true, address(module));
        emit AegisModule.AegisExecuted(safe, darHash, 0, address(vaultA), amount, expectedShares, 2, dar.evidenceHash);
        vm.prank(executor);
        module.deposit(dar, sig, "", "", _emptyApproval());

        assertEq(usdc.allowance(safe, address(vaultA)), 0, "approval reset to zero");
        assertEq(_usdcBalance(safe), safeUsdcBefore - amount);
        assertEq(module.depositedToday(safe), todayBefore + amount);
        assertTrue(module.usedNonce(safe, dar.nonce));
    }

    function test_C2_depositIntoVaultNotInAllowlist() public {
        AegisModule.Approval memory ap = _approval(address(vaultC), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultC), 500 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), _signApproval(ownerPk, ap), "", ap, AegisModule.VaultNotAllowed.selector
        );
    }

    function test_C3_darFieldChangedAfterSigning() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 300 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        dar.amount = 900 * USDC;
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.BadSignature.selector);
    }

    function test_C4_redeemBelowMinOut() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);
        uint256 expected = vaultA.previewRedeem(shares);
        AegisModule.DAR memory dar = _redeemDar(address(vaultA), shares, expected + 1);
        bytes memory sig = _signDar(exitKeyPk, dar);
        vm.expectRevert(AegisModule.SlippageExceeded.selector);
        module.redeem(dar, sig);
    }

    function test_C5_reusedNonce() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        module.deposit(dar, sig, "", "", _emptyApproval());
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.NonceUsed.selector);
    }

    function test_C6_expiredDar() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        vm.warp(dar.expiry + 1);
        feed.poke();
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.Expired.selector);
    }

    function test_C7_depositAfterPolicyVersionChange() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        vm.prank(owner);
        registry.setAutoCap(safe, AUTO_CAP);
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.PolicyVersionMismatch.selector);
    }

    function test_C8_depositBreachingReserveFloor() public {
        uint256 amount = SAFE_FUNDING - RESERVE_FLOOR + 1;
        AegisModule.Approval memory ap = _approval(address(vaultA), amount);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), amount, 4, module.approvalStructHash(ap));
        _expectDepositRevert(
            dar,
            _signDar(authorizerPk, dar),
            _signApproval(ownerPk, ap),
            _signApproval(bankPk, ap),
            ap,
            AegisModule.ReserveFloorBreached.selector
        );
    }

    function test_C9_dailyCapExceededPerUtcDay() public {
        usdc.mint(safe, 20_000 * USDC);
        _seedPosition(address(vaultA), 2_500 * USDC);

        AegisModule.Approval memory ap = _approval(address(vaultA), 2_600 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 2_600 * USDC, 3, module.approvalStructHash(ap));
        bytes memory authSig = _signDar(authorizerPk, dar);
        bytes memory ownerSig = _signApproval(ownerPk, ap);
        _expectDepositRevert(dar, authSig, ownerSig, "", ap, AegisModule.DailyCapExceeded.selector);

        vm.warp((block.timestamp / 1 days + 1) * 1 days);
        feed.poke();
        assertEq(module.depositedToday(safe), 0, "new UTC day resets the bucket");
        ap = _approval(address(vaultA), 2_600 * USDC);
        dar = _depositDar(address(vaultA), 2_600 * USDC, 3, module.approvalStructHash(ap));
        module.deposit(dar, _signDar(authorizerPk, dar), _signApproval(ownerPk, ap), "", ap);
        assertEq(module.depositedToday(safe), 2_600 * USDC);
    }

    function test_C10_depositSignedByNonAuthorizer() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        _expectDepositRevert(
            dar, _signDar(attackerPk, dar), "", "", _emptyApproval(), AegisModule.BadSignature.selector
        );
    }

    function test_C11_firstDepositDeclaredT2WithoutApproval() public {
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        assertEq(module.requiredTier(safe, address(vaultA), 200 * USDC), 3);
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.MissingApproval.selector
        );
    }

    function test_C12_aboveAutoCapWithoutOwnerApproval() public {
        _seedPosition(address(vaultA), 500 * USDC);
        uint256 amount = AUTO_CAP + 1;
        AegisModule.DAR memory dar = _depositDar(address(vaultA), amount, 2, bytes32(0));
        assertEq(module.requiredTier(safe, address(vaultA), amount), 3);
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.MissingApproval.selector
        );

        AegisModule.Approval memory ap = _approval(address(vaultA), amount);
        dar = _depositDar(address(vaultA), amount, 2, module.approvalStructHash(ap));
        _expectDepositRevert(dar, _signDar(authorizerPk, dar), "", "", ap, AegisModule.MissingApproval.selector);
    }

    function test_C13_bankLimitRequiresBankApproval() public {
        uint256 amount = 3_500 * USDC;
        assertEq(module.requiredTier(safe, address(vaultA), amount), 4);
        AegisModule.Approval memory ap = _approval(address(vaultA), amount);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), amount, 3, module.approvalStructHash(ap));
        bytes memory authSig = _signDar(authorizerPk, dar);
        bytes memory ownerSig = _signApproval(ownerPk, ap);

        _expectDepositRevert(dar, authSig, ownerSig, "", ap, AegisModule.MissingApproval.selector);

        bytes memory bankSig = _signApproval(bankPk, ap);
        vm.recordLogs();
        vm.prank(executor);
        module.deposit(dar, authSig, ownerSig, bankSig, ap);
        (,,,, uint8 tier,) = _lastExecuted();
        assertEq(tier, 4);
        assertTrue(module.usedNonce(safe, ap.approvalNonce));
        assertTrue(module.everDeposited(safe, address(vaultA)));
    }

    function test_C14_amountAboveApprovalMax() public {
        AegisModule.Approval memory ap = _approval(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 600 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), _signApproval(ownerPk, ap), "", ap, AegisModule.ApprovalExceeded.selector
        );
    }

    function test_C15_approvalSurvivesOracleAdvanceWithinBand() public {
        AegisModule.Approval memory ap = _approval(address(vaultB), 800 * USDC);
        bytes memory ownerSig = _signApproval(ownerPk, ap);
        bytes32 approvalHash = module.approvalStructHash(ap);
        AegisModule.DAR memory stale = _depositDar(address(vaultB), 800 * USDC, 3, approvalHash);
        bytes memory staleSig = _signDar(authorizerPk, stale);

        vm.warp(block.timestamp + 10 minutes);
        feed.setPrice(100_200_000);
        _expectDepositRevert(stale, staleSig, ownerSig, "", ap, AegisModule.Expired.selector);

        AegisModule.DAR memory fresh = _depositDar(address(vaultB), 800 * USDC, 3, approvalHash);
        bytes memory freshSig = _signDar(authorizerPk, fresh);
        vm.prank(executor);
        module.deposit(fresh, freshSig, ownerSig, "", ap);
        assertTrue(module.everDeposited(safe, address(vaultB)));
    }

    function test_C16_priceOutsideBand() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        feed.setPrice(97_000_000);
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.PriceOutOfBand.selector);
    }

    function test_C17_bandWiderThanMax() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        dar.priceLow = 98_000_000;
        dar.priceHigh = 101_000_001;
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.BandTooWide.selector
        );
    }

    function test_C18_staleOracle() public {
        _seedPosition(address(vaultA), 500 * USDC);
        vm.warp(block.timestamp + MAX_ORACLE_AGE + 1);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.StaleOracle.selector
        );
    }

    function test_C19_depositWhileBankFrozen() public {
        _seedPosition(address(vaultA), 500 * USDC);
        vm.prank(bank);
        registry.bankFreeze(safe);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        _expectDepositRevert(dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.Frozen.selector);
    }

    function test_C20_redeemWhileFrozenAfterVersionChangeAndDelisting() public {
        uint256 shares = _seedPosition(address(vaultA), 900 * USDC);
        uint256 part = shares / 3;
        AegisModule.DAR memory staleVersionDar = _redeemDar(address(vaultA), part, 0);

        vm.prank(bank);
        registry.bankFreeze(safe);
        AegisModule.DAR memory dar = _redeemDar(address(vaultA), part, 0);
        module.redeem(dar, _signDar(exitKeyPk, dar));

        vm.prank(owner);
        registry.setAutoCap(safe, AUTO_CAP / 2);
        assertTrue(staleVersionDar.policyVersion != registry.policyVersion(safe));
        module.redeem(staleVersionDar, _signDar(authorizerPk, staleVersionDar));

        vm.prank(owner);
        registry.removeVault(safe, address(vaultA));
        uint256 rest = vaultA.balanceOf(safe);
        uint256 usdcBefore = _usdcBalance(safe);
        dar = _redeemDar(address(vaultA), rest, vaultA.previewRedeem(rest));
        module.redeem(dar, _signDar(exitKeyPk, dar));

        assertEq(vaultA.balanceOf(safe), 0);
        assertGt(_usdcBalance(safe), usdcBefore);
    }

    function test_C21_redeemWithStaleOracle() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);
        vm.warp(block.timestamp + 1 days);
        AegisModule.DAR memory dar = _redeemDar(address(vaultA), shares, 0);
        module.redeem(dar, _signDar(exitKeyPk, dar));
        assertEq(vaultA.balanceOf(safe), 0);
    }

    function test_C22_exitKeySignsDeposit() public {
        _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        _expectDepositRevert(dar, _signDar(exitKeyPk, dar), "", "", _emptyApproval(), AegisModule.BadSignature.selector);
    }

    function test_C23_exitRedeemSubmittedByRandomAddress() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _redeemDar(address(vaultA), shares, vaultA.previewRedeem(shares));
        bytes memory sig = _signDar(exitKeyPk, dar);
        uint256 usdcBefore = _usdcBalance(safe);
        vm.prank(makeAddr("random"));
        module.redeem(dar, sig);
        assertEq(_usdcBalance(safe), usdcBefore + dar.minOut);
    }

    function test_C24_depositIntoQuarantinedVault() public {
        _seedPosition(address(vaultA), 500 * USDC);
        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), "", "", _emptyApproval(), AegisModule.VaultQuarantined.selector
        );
    }

    function test_C25_vaultRevertsInsideDepositOrRedeem() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);

        vaultA.setRevertMode(true, false);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 200 * USDC, 2, bytes32(0));
        bytes memory sig = _signDar(authorizerPk, dar);
        vm.recordLogs();
        _expectDepositRevert(dar, sig, "", "", _emptyApproval(), AegisModule.ExecutionFailed.selector);
        assertEq(_executedEventCount(), 0, "no AegisExecuted on revert");
        assertFalse(module.usedNonce(safe, dar.nonce), "nonce stays unused");

        vaultA.setRevertMode(false, true);
        AegisModule.DAR memory exitDar = _redeemDar(address(vaultA), shares, 0);
        bytes memory exitSig = _signDar(exitKeyPk, exitDar);
        vm.recordLogs();
        vm.expectRevert(AegisModule.ExecutionFailed.selector);
        module.redeem(exitDar, exitSig);
        assertEq(_executedEventCount(), 0, "no AegisExecuted on revert");
        assertFalse(module.usedNonce(safe, exitDar.nonce), "nonce stays unused");
    }

    function test_C26_redeemFromNeverDepositedContractReverts() public {
        _seedPosition(address(vaultA), 500 * USDC);
        MaliciousVault fake = new MaliciousVault(IERC20(address(usdc)), attacker);
        assertGt(fake.balanceOf(safe), 0, "fake reports a share balance");
        assertFalse(module.everDeposited(safe, address(fake)));

        AegisModule.DAR memory dar = _redeemDar(address(fake), 1, 0);
        (bool ok, bytes4 err,) = module.check(dar, _emptyApproval());
        assertFalse(ok);
        assertEq(err, AegisModule.NoPosition.selector);

        bytes memory sig = _signDar(exitKeyPk, dar);
        vm.recordLogs();
        vm.expectRevert(AegisModule.NoPosition.selector);
        module.redeem(dar, sig);
        assertEq(_executedEventCount(), 0);
        assertFalse(module.usedNonce(safe, dar.nonce));

        AegisModule.DAR memory authDar = _redeemDar(address(fake), 1, 0);
        bytes memory authSig = _signDar(authorizerPk, authDar);
        vm.expectRevert(AegisModule.NoPosition.selector);
        module.redeem(authDar, authSig);

        vm.prank(owner);
        registry.addVault(safe, address(vaultC));
        AegisModule.DAR memory allowedButUnused = _redeemDar(address(vaultC), 1, 0);
        bytes memory unusedSig = _signDar(exitKeyPk, allowedButUnused);
        vm.expectRevert(AegisModule.NoPosition.selector);
        module.redeem(allowedButUnused, unusedSig);
    }

    function test_redeemAllowedWhileQuarantinedAndOwnerFrozen() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);
        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        vm.prank(owner);
        registry.ownerFreeze(safe);
        AegisModule.DAR memory dar = _redeemDar(address(vaultA), shares, 0);
        module.redeem(dar, _signDar(exitKeyPk, dar));
        assertEq(vaultA.balanceOf(safe), 0);
    }

    function test_redeemRejectsWrongOpNoPositionAndBadSigner() public {
        uint256 shares = _seedPosition(address(vaultA), 500 * USDC);

        AegisModule.DAR memory dar = _redeemDar(address(vaultA), shares, 0);
        bytes memory bankSig = _signDar(bankPk, dar);
        vm.expectRevert(AegisModule.BadSignature.selector);
        module.redeem(dar, bankSig);

        AegisModule.DAR memory depositOp = _depositDar(address(vaultA), shares, 2, bytes32(0));
        bytes memory depositOpSig = _signDar(exitKeyPk, depositOp);
        vm.expectRevert(AegisModule.WrongOp.selector);
        module.redeem(depositOp, depositOpSig);

        AegisModule.DAR memory tooMany = _redeemDar(address(vaultA), shares + 1, 0);
        bytes memory tooManySig = _signDar(exitKeyPk, tooMany);
        vm.expectRevert(AegisModule.NoPosition.selector);
        module.redeem(tooMany, tooManySig);

        AegisModule.DAR memory noPosition = _redeemDar(address(vaultB), 1, 0);
        bytes memory noPositionSig = _signDar(exitKeyPk, noPosition);
        vm.expectRevert(AegisModule.NoPosition.selector);
        module.redeem(noPosition, noPositionSig);
    }

    function test_redeemMeasuresPartialLiquidity() public {
        uint256 shares = _seedPosition(address(vaultA), 900 * USDC);
        vaultA.setLiquidityCap(300 * USDC);
        uint256 available = vaultA.maxRedeem(safe);
        assertLt(available, shares);

        AegisModule.DAR memory full = _redeemDar(address(vaultA), shares, 0);
        bytes memory fullSig = _signDar(exitKeyPk, full);
        vm.expectRevert(AegisModule.ExecutionFailed.selector);
        module.redeem(full, fullSig);

        AegisModule.DAR memory partialExit = _redeemDar(address(vaultA), available, 0);
        uint256 usdcBefore = _usdcBalance(safe);
        vm.recordLogs();
        module.redeem(partialExit, _signDar(exitKeyPk, partialExit));
        (, uint256 assets, uint256 burned,,,) = _lastExecuted();
        assertEq(assets, _usdcBalance(safe) - usdcBefore);
        assertEq(burned, available);
    }

    function test_approvalSignedByWrongKeyAndReplayedApproval() public {
        AegisModule.Approval memory ap = _approval(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 500 * USDC, 3, module.approvalStructHash(ap));
        bytes memory authSig = _signDar(authorizerPk, dar);
        _expectDepositRevert(dar, authSig, _signApproval(bankPk, ap), "", ap, AegisModule.BadSignature.selector);

        bytes memory ownerSig = _signApproval(ownerPk, ap);
        module.deposit(dar, authSig, ownerSig, "", ap);

        AegisModule.DAR memory second = _depositDar(address(vaultA), 1_500 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(
            second, _signDar(authorizerPk, second), ownerSig, "", ap, AegisModule.ApprovalExceeded.selector
        );
        second = _depositDar(address(vaultA), 100 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(second, _signDar(authorizerPk, second), ownerSig, "", ap, AegisModule.NonceUsed.selector);
    }

    function test_approvalMismatchAndExpiry() public {
        AegisModule.Approval memory ap = _approval(address(vaultB), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 500 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(
            dar, _signDar(authorizerPk, dar), _signApproval(ownerPk, ap), "", ap, AegisModule.ApprovalMismatch.selector
        );

        ap = _approval(address(vaultA), 500 * USDC);
        ap.approvalExpiry = uint64(block.timestamp + 60);
        bytes memory ownerSig = _signApproval(ownerPk, ap);
        vm.warp(block.timestamp + 61);
        feed.poke();
        dar = _depositDar(address(vaultA), 500 * USDC, 3, module.approvalStructHash(ap));
        _expectDepositRevert(dar, _signDar(authorizerPk, dar), ownerSig, "", ap, AegisModule.ApprovalExpired.selector);
    }

    function test_checkViewMirrorsDepositAndRedeem() public {
        AegisModule.Approval memory ap = _approval(address(vaultA), 500 * USDC);
        AegisModule.DAR memory dar = _depositDar(address(vaultA), 500 * USDC, 2, module.approvalStructHash(ap));
        (bool ok, bytes4 err, uint8 tier) = module.check(dar, ap);
        assertTrue(ok);
        assertEq(err, bytes4(0));
        assertEq(tier, 3);

        AegisModule.DAR memory noApproval = _depositDar(address(vaultA), 500 * USDC, 2, bytes32(0));
        (ok, err, tier) = module.check(noApproval, _emptyApproval());
        assertFalse(ok);
        assertEq(err, AegisModule.MissingApproval.selector);

        feed.setPrice(97_000_000);
        (ok, err,) = module.check(dar, ap);
        assertEq(err, AegisModule.PriceOutOfBand.selector);

        AegisModule.DAR memory exitDar = _redeemDar(address(vaultA), 1, 0);
        (ok, err, tier) = module.check(exitDar, _emptyApproval());
        assertEq(err, AegisModule.NoPosition.selector);
        assertEq(tier, 1);
    }

    function _executedEventCount() internal view returns (uint256 count) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(module) && logs[i].topics[0] == AegisModule.AegisExecuted.selector) count++;
        }
    }

    function _lastExecuted()
        internal
        view
        returns (bytes32 darHash, uint256 assets, uint256 shares, uint8 op, uint8 tier, bytes32 evidence)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = AegisModule.AegisExecuted.selector;
        for (uint256 i = logs.length; i > 0; i--) {
            Vm.Log memory log = logs[i - 1];
            if (log.emitter == address(module) && log.topics[0] == topic) {
                darHash = log.topics[2];
                (op, assets, shares, tier, evidence) = abi.decode(log.data, (uint8, uint256, uint256, uint8, bytes32));
                return (darHash, assets, shares, op, tier, evidence);
            }
        }
        revert("AegisExecuted not found");
    }
}
