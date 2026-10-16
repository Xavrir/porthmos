// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TradeEscrowTestBase} from "./utils/TradeEscrowTestBase.sol";
import {FeeOnTransferToken} from "./utils/FeeOnTransferToken.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";

contract TradeEscrowTest is TradeEscrowTestBase {
    function test_createOrderStoresOrderTermsAndCommitment() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        uint256 safeBefore = _usdcBalance(safe);

        vm.startPrank(safe);
        usdc.approve(address(escrow), ORDER_TOTAL);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit TradeEscrow.OrderCreated(1, safe, supplier, ORDER_TOTAL, TERMS_HASH);
        uint256 orderId = escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, ms);
        vm.stopPrank();

        assertEq(orderId, 1);
        assertEq(escrow.nextOrderId(), 2);
        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.buyer, safe);
        assertEq(o.supplier, supplier);
        assertEq(o.createdAt, block.timestamp);
        assertEq(o.nextIndex, 0);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.ACTIVE));
        assertEq(o.total, ORDER_TOTAL);
        assertEq(o.released, 0);
        assertEq(o.termsHash, TERMS_HASH);
        for (uint8 i; i < 3; ++i) {
            (TradeEscrow.MilestoneTerms memory m, TradeEscrow.MilestoneStatus st) = escrow.getMilestone(orderId, i);
            assertEq(keccak256(abi.encode(m)), keccak256(abi.encode(ms[i])), "terms stored as given");
            assertEq(uint8(st), uint8(TradeEscrow.MilestoneStatus.PENDING));
        }
        assertEq(escrow.committedOf(safe), ORDER_TOTAL);
        assertEq(escrow.escrowedTotal(), ORDER_TOTAL);
        assertEq(_usdcBalance(address(escrow)), ORDER_TOTAL);
        assertEq(_usdcBalance(safe), safeBefore - ORDER_TOTAL);
        assertEq(usdc.allowance(safe, address(escrow)), 0);
    }

    function test_T2_callerNotRegisteredSafe() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        vm.prank(attacker);
        vm.expectRevert(TradeEscrow.NotRegistered.selector);
        escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, ms);

        address unregistered = _deploySafe(owner);
        usdc.mint(unregistered, ORDER_TOTAL);
        vm.startPrank(unregistered);
        usdc.approve(address(escrow), ORDER_TOTAL);
        vm.expectRevert(TradeEscrow.NotRegistered.selector);
        escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, ms);
        vm.stopPrank();
    }

    function test_T3_buyerOwnerFrozenOrBankFrozen() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        vm.prank(owner);
        registry.ownerFreeze(safe);
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.Frozen.selector);
        vm.prank(owner);
        registry.ownerUnfreeze(safe);

        vm.prank(bank);
        registry.bankFreeze(safe);
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.Frozen.selector);
        vm.prank(bank);
        registry.bankUnfreeze(safe);

        _createOrder(ORDER_TOTAL, ms);
    }

    function test_T4_badSupplier() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        _expectCreateRevert(address(0), ORDER_TOTAL, ms, TradeEscrow.BadSupplier.selector);
        _expectCreateRevert(safe, ORDER_TOTAL, ms, TradeEscrow.BadSupplier.selector);
        _expectCreateRevert(address(escrow), ORDER_TOTAL, ms, TradeEscrow.BadSupplier.selector);
        _expectCreateRevert(address(usdc), ORDER_TOTAL, ms, TradeEscrow.BadSupplier.selector);
    }

    function test_T5_issuerZeroOrSupplier() public {
        for (uint256 i; i < 3; ++i) {
            TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
            ms[i].issuer = address(0);
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadIssuer.selector);
            ms[i].issuer = supplier;
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadIssuer.selector);
        }
    }

    function test_T6_badMilestone() public {
        for (uint256 i; i < 3; ++i) {
            TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
            ms[i].amount = 0;
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadMilestone.selector);

            ms = _terms(ORDER_TOTAL);
            ms[i].kind = uint8((i + 1) % 3);
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadMilestone.selector);
            ms[i].kind = 3;
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadMilestone.selector);

            ms = _terms(ORDER_TOTAL);
            ms[i].checkTemp = true;
            ms[i].minTempCenti = 801;
            ms[i].maxTempCenti = 800;
            _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadMilestone.selector);
        }
    }

    function test_T6_inverseTempBoundsAllowedWhenTemperatureNotChecked() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        ms[0].minTempCenti = 900;
        ms[0].maxTempCenti = -900;
        assertEq(_createOrder(ORDER_TOTAL, ms), 1);
    }

    function test_T7_amountsDoNotSumToTotal() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        _expectCreateRevert(supplier, ORDER_TOTAL + 1, ms, TradeEscrow.AmountMismatch.selector);
        _expectCreateRevert(supplier, ORDER_TOTAL - 1, ms, TradeEscrow.AmountMismatch.selector);

        ms[0].amount = type(uint256).max;
        ms[1].amount = 2;
        _expectCreateRevert(supplier, 1, ms, TradeEscrow.AmountMismatch.selector);
    }

    function test_T8_badDeadline() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        ms[0].deadline = uint64(block.timestamp);
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadDeadline.selector);
        ms[0].deadline = uint64(block.timestamp - 1);
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadDeadline.selector);

        ms = _terms(ORDER_TOTAL);
        ms[1].deadline = ms[0].deadline - 1;
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadDeadline.selector);

        ms = _terms(ORDER_TOTAL);
        ms[2].deadline = ms[1].deadline - 1;
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadDeadline.selector);

        ms = _terms(ORDER_TOTAL);
        ms[0].deadline = uint64(block.timestamp + 1);
        ms[1].deadline = ms[0].deadline;
        ms[2].deadline = ms[0].deadline;
        assertEq(_createOrder(ORDER_TOTAL, ms), 1, "equal deadlines are allowed");
    }

    function test_createOrderCheckOrder() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        vm.prank(attacker);
        vm.expectRevert(TradeEscrow.NotRegistered.selector);
        escrow.createOrder(address(0), ORDER_TOTAL, TERMS_HASH, ms);

        vm.prank(bank);
        registry.bankFreeze(safe);
        _expectCreateRevert(address(0), ORDER_TOTAL, ms, TradeEscrow.Frozen.selector);
        vm.prank(bank);
        registry.bankUnfreeze(safe);

        ms[2].amount = 0;
        _expectCreateRevert(address(0), ORDER_TOTAL, ms, TradeEscrow.BadSupplier.selector);

        ms[0].issuer = supplier;
        _expectCreateRevert(supplier, ORDER_TOTAL, ms, TradeEscrow.BadMilestone.selector);

        ms = _terms(ORDER_TOTAL);
        ms[2].issuer = address(0);
        _expectCreateRevert(supplier, ORDER_TOTAL + 1, ms, TradeEscrow.BadIssuer.selector);

        ms = _terms(ORDER_TOTAL);
        ms[0].deadline = 0;
        _expectCreateRevert(supplier, ORDER_TOTAL + 1, ms, TradeEscrow.AmountMismatch.selector);
    }

    function test_createOrderRejectsShortTransfer() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        TradeEscrow feeEscrow = new TradeEscrow(registry, IERC20(address(feeToken)));
        feeToken.mint(safe, ORDER_TOTAL);
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);

        vm.startPrank(safe);
        feeToken.approve(address(feeEscrow), ORDER_TOTAL);
        vm.expectRevert(TradeEscrow.AmountMismatch.selector);
        feeEscrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, ms);
        vm.stopPrank();
    }

    function test_createOrderPullsExactlyTotal() public {
        vm.startPrank(safe);
        usdc.approve(address(escrow), ORDER_TOTAL - 1);
        vm.expectRevert();
        escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, _terms(ORDER_TOTAL));
        usdc.approve(address(escrow), ORDER_TOTAL + 5);
        escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, _terms(ORDER_TOTAL));
        vm.stopPrank();
        assertEq(usdc.allowance(safe, address(escrow)), 5);
        assertEq(_usdcBalance(address(escrow)), ORDER_TOTAL);
    }

    function test_T9_validReleaseOfFirstMilestoneByRandomAddress() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        uint256 amount = a.amount;
        bytes memory issuerSig = _signProof(carrierPk, p);
        bytes memory authSig = _signAuth(authorizerPk, a);
        address anyone = makeAddr("anyone");

        vm.expectEmit(true, true, true, true, address(escrow));
        emit TradeEscrow.MilestoneReleased(
            orderId, 0, supplier, amount, escrow.proofStructHash(p), escrow.hashAuthorization(a), false
        );
        vm.prank(anyone);
        escrow.release(orderId, 0, p, issuerSig, a, authSig);

        assertEq(amount, 200 * USDC);
        assertEq(_usdcBalance(supplier), amount);
        assertEq(_usdcBalance(anyone), 0);
        assertTrue(escrow.usedNonce(safe, a.nonce));
        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.nextIndex, 1);
        assertEq(o.released, amount);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.ACTIVE));
        assertEq(uint8(_mstatus(orderId, 0)), uint8(TradeEscrow.MilestoneStatus.RELEASED));
        assertEq(uint8(_mstatus(orderId, 1)), uint8(TradeEscrow.MilestoneStatus.PENDING));
        assertEq(escrow.committedOf(safe), ORDER_TOTAL - amount);
        assertEq(escrow.escrowedTotal(), ORDER_TOTAL - amount);
        assertEq(_usdcBalance(address(escrow)), ORDER_TOTAL - amount);
    }

    function test_T10_outOfOrder() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.OutOfOrder.selector);
        p = _proof(orderId, 2);
        _expectSignedReleaseRevert(orderId, 2, p, _auth(orderId, 2, p), TradeEscrow.OutOfOrder.selector);

        TradeEscrow.MilestoneProof memory p0 = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a0 = _auth(orderId, 0, p0);
        bytes memory issuerSig = _signProof(carrierPk, p0);
        bytes memory authSig = _signAuth(authorizerPk, a0);
        escrow.release(orderId, 0, p0, issuerSig, a0, authSig);
        _expectReleaseRevert(orderId, 0, p0, issuerSig, a0, authSig, TradeEscrow.OutOfOrder.selector);

        a0.nonce = _nextNonce();
        _expectReleaseRevert(
            orderId, 0, p0, issuerSig, a0, _signAuth(authorizerPk, a0), TradeEscrow.OutOfOrder.selector
        );
        p0.index = 3;
        _expectReleaseRevert(orderId, 3, p0, issuerSig, a0, authSig, TradeEscrow.OutOfOrder.selector);
        _expectReleaseRevert(orderId, 255, p0, issuerSig, a0, authSig, TradeEscrow.OutOfOrder.selector);
    }

    function test_T11_releaseOnRefundedCompletedOrUnknownOrder() public {
        TradeEscrow.MilestoneProof memory p = _proof(99, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(99, 0, p);
        _expectSignedReleaseRevert(99, 0, p, a, TradeEscrow.OrderNotActive.selector);

        uint256 refunded = _createOrder();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(safe);
        escrow.refund(refunded);
        p = _proof(refunded, 0);
        _expectSignedReleaseRevert(refunded, 0, p, _auth(refunded, 0, p), TradeEscrow.OrderNotActive.selector);

        uint256 completed = _createOrder();
        _release(completed, 0);
        _release(completed, 1);
        _release(completed, 2);
        p = _proof(completed, 2);
        _expectSignedReleaseRevert(completed, 2, p, _auth(completed, 2, p), TradeEscrow.OrderNotActive.selector);
    }

    function test_T12_releaseWhileOwnerFrozenAndWhileBankFrozen() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);

        vm.prank(owner);
        registry.ownerFreeze(safe);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.Frozen.selector);
        vm.prank(owner);
        registry.ownerUnfreeze(safe);

        vm.prank(bank);
        registry.bankFreeze(safe);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.Frozen.selector);
        vm.prank(bank);
        registry.bankUnfreeze(safe);

        _release(orderId, 0);
    }

    function test_T13_proofForAnotherOrderIndexOrKind() public {
        uint256 orderId = _createOrder();
        uint256 other = _createOrder();

        TradeEscrow.MilestoneProof memory p = _proof(other, 0);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.ProofMismatch.selector);

        p = _proof(orderId, 0);
        p.index = 1;
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.ProofMismatch.selector);

        p = _proof(orderId, 0);
        p.kind = uint8(TradeEscrow.Kind.QUALITY);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.ProofMismatch.selector);
    }

    function test_T14_proofSignedByAnotherKeyOrChangedAfterSigning() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        bytes memory authSig = _signAuth(authorizerPk, a);

        _expectReleaseRevert(orderId, 0, p, _signProof(attackerPk, p), a, authSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, _signProof(sensorPk, p), a, authSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, _signProof(authorizerPk, p), a, authSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, "", a, authSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, hex"1234", a, authSig, TradeEscrow.BadSignature.selector);

        bytes memory issuerSig = _signProof(carrierPk, p);
        p.docHash = keccak256("forged bill of lading");
        a.proofHash = escrow.proofStructHash(p);
        authSig = _signAuth(authorizerPk, a);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, authSig, TradeEscrow.BadSignature.selector);
    }

    function test_T15_proofIssuedBeforeCreationOrInFuture() public {
        uint256 orderId = _createOrder();
        vm.warp(block.timestamp + 1 hours);

        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        p.issuedAt = _order(orderId).createdAt - 1;
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.BadProofTime.selector);

        p.issuedAt = uint64(block.timestamp + 1);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.BadProofTime.selector);

        p.issuedAt = _order(orderId).createdAt;
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        escrow.release(orderId, 0, p, _signProof(carrierPk, p), a, _signAuth(authorizerPk, a));
    }

    function test_T16_conditionNotMetEvenWithValidAuthorizerSignature() public {
        uint256 orderId = _createOrder();

        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        p.docHash = bytes32(0);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.ConditionNotMet.selector);

        _release(orderId, 0);

        p = _proof(orderId, 1);
        p.maxTempCenti = MAX_TEMP + 1;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        p = _proof(orderId, 1);
        p.minTempCenti = MIN_TEMP - 1;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        p = _proof(orderId, 1);
        p.samples = 0;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        p = _proof(orderId, 1);
        p.minTempCenti = 600;
        p.maxTempCenti = 500;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        p = _proof(orderId, 1);
        p.docHash = bytes32(0);
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        p = _proof(orderId, 1);
        p.minTempCenti = -2_000;
        p.maxTempCenti = 2_000;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);
    }

    function test_T17_readingsExactlyAtBothBoundsRelease() public {
        uint256 orderId = _createOrder();
        _release(orderId, 0);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        p.minTempCenti = MIN_TEMP;
        p.maxTempCenti = MAX_TEMP;
        p.samples = 1;
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 1, p);
        escrow.release(orderId, 1, p, _signProof(sensorPk, p), a, _signAuth(authorizerPk, a));
        assertEq(_order(orderId).nextIndex, 2);
    }

    function test_conditionsSkippedWhenNotRequired() public {
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        ms[0].requireDoc = false;
        uint256 orderId = _createOrder(ORDER_TOTAL, ms);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        p.docHash = bytes32(0);
        p.minTempCenti = 5_000;
        p.maxTempCenti = -5_000;
        p.samples = 0;
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        escrow.release(orderId, 0, p, _signProof(carrierPk, p), a, _signAuth(authorizerPk, a));
        assertEq(_order(orderId).nextIndex, 1);
    }

    function test_T18_authorizationAmountChangedAfterSigning() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        bytes memory authSig = _signAuth(authorizerPk, a);
        a.amount = ORDER_TOTAL;
        _expectReleaseRevert(orderId, 0, p, _signProof(carrierPk, p), a, authSig, TradeEscrow.BadSignature.selector);
    }

    function test_T19_authorizationByExitKeyRevokedAuthorizerOrRandomKey() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        bytes memory issuerSig = _signProof(carrierPk, p);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);

        _expectReleaseRevert(orderId, 0, p, issuerSig, a, _signAuth(exitKeyPk, a), TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, _signAuth(attackerPk, a), TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, _signAuth(carrierPk, a), TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, "", TradeEscrow.BadSignature.selector);

        vm.prank(owner);
        registry.revokeAuthorizer(safe);
        a = _auth(orderId, 0, p);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, _signAuth(authorizerPk, a), TradeEscrow.BadSignature.selector);
    }

    function test_T19_authorizerThatIsAlsoExitKeyIsRefused() public {
        uint256 orderId = _createOrder();
        vm.prank(owner);
        registry.setExitKey(safe, authorizer);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        _expectSignedReleaseRevert(orderId, 0, p, _auth(orderId, 0, p), TradeEscrow.BadSignature.selector);
    }

    function test_T20_validlySignedAuthorizationForWrongFields() public {
        uint256 orderId = _createOrder();
        uint256 other = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);

        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        a.amount += 1;
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.AuthorizationMismatch.selector);

        a = _auth(orderId, 0, p);
        a.orderId = other;
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.AuthorizationMismatch.selector);

        a = _auth(orderId, 0, p);
        a.index = 1;
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.AuthorizationMismatch.selector);

        a = _auth(orderId, 0, p);
        a.proofHash = escrow.hashProof(p);
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.AuthorizationMismatch.selector);

        TradeEscrow.MilestoneProof memory otherProof = _proof(orderId, 0);
        otherProof.docHash = keccak256("another document");
        a = _auth(orderId, 0, otherProof);
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.AuthorizationMismatch.selector);
    }

    function test_T21_policyChangedAfterSigning() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);

        vm.prank(bank);
        registry.setAutoCap(safe, AUTO_CAP - 1);
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.PolicyVersionMismatch.selector);

        a = _auth(orderId, 0, p);
        vm.prank(bank);
        registry.bankFreeze(safe);
        vm.prank(bank);
        registry.bankUnfreeze(safe);
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.PolicyVersionMismatch.selector);

        a = _auth(orderId, 0, p);
        vm.prank(owner);
        registry.setReserveFloor(safe, RESERVE_FLOOR + 1, SCHEDULE_HASH);
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.PolicyVersionMismatch.selector);
    }

    function test_T22_expiredAuthorization() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        bytes memory issuerSig = _signProof(carrierPk, p);
        bytes memory authSig = _signAuth(authorizerPk, a);

        vm.warp(a.expiry + 1);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, authSig, TradeEscrow.Expired.selector);

        vm.warp(a.expiry);
        escrow.release(orderId, 0, p, issuerSig, a, authSig);
    }

    function test_T23_nonceReusedOnNextMilestone() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p0 = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a0 = _auth(orderId, 0, p0);
        escrow.release(orderId, 0, p0, _signProof(carrierPk, p0), a0, _signAuth(authorizerPk, a0));

        TradeEscrow.MilestoneProof memory p1 = _proof(orderId, 1);
        TradeEscrow.ReleaseAuthorization memory a1 = _auth(orderId, 1, p1);
        a1.nonce = a0.nonce;
        _expectSignedReleaseRevert(orderId, 1, p1, a1, TradeEscrow.NonceUsed.selector);
    }

    function test_releaseCheckOrderProofBeforeAuthorization() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        a.nonce = 0;
        a.expiry = 0;
        a.policyVersion = 0;
        a.amount = 1;
        bytes memory badAuthSig = _signAuth(attackerPk, a);

        p.docHash = bytes32(0);
        _expectReleaseRevert(orderId, 0, p, "", a, badAuthSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(
            orderId, 0, p, _signProof(carrierPk, p), a, badAuthSig, TradeEscrow.ConditionNotMet.selector
        );

        p = _proof(orderId, 0);
        _expectReleaseRevert(orderId, 0, p, _signProof(carrierPk, p), a, badAuthSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(
            orderId,
            0,
            p,
            _signProof(carrierPk, p),
            a,
            _signAuth(authorizerPk, a),
            TradeEscrow.AuthorizationMismatch.selector
        );
        a = _auth(orderId, 0, p);
        a.policyVersion = 0;
        a.expiry = 0;
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.PolicyVersionMismatch.selector);
    }

    function test_supplierFixedAtCreation() public {
        uint256 orderId = _createOrder();
        address otherSupplier = makeAddr("otherSupplier");
        vm.startPrank(safe);
        usdc.approve(address(escrow), ORDER_TOTAL);
        uint256 other = escrow.createOrder(otherSupplier, ORDER_TOTAL, TERMS_HASH, _terms(ORDER_TOTAL));
        vm.stopPrank();

        TradeEscrow.MilestoneProof memory p = _proof(other, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(other, 0, p);
        vm.prank(supplier);
        escrow.release(other, 0, p, _signProof(carrierPk, p), a, _signAuth(authorizerPk, a));

        assertEq(_usdcBalance(otherSupplier), 200 * USDC);
        assertEq(_usdcBalance(supplier), 0);
        assertEq(_order(orderId).supplier, supplier);
        assertEq(_order(other).supplier, otherSupplier);
    }

    function test_T24_buyerSafeWaivesHeldMilestone() public {
        uint256 orderId = _createOrder();
        _release(orderId, 0);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        p.maxTempCenti = 1_150;
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.ConditionNotMet.selector);

        uint256 amount = 400 * USDC;
        vm.expectEmit(true, true, true, true, address(escrow));
        emit TradeEscrow.MilestoneReleased(orderId, 1, supplier, amount, bytes32(0), bytes32(0), true);
        _execAsOwnerStrict(address(escrow), abi.encodeCall(TradeEscrow.waive, (orderId, 1)));

        assertEq(_usdcBalance(supplier), 200 * USDC + amount);
        assertEq(uint8(_mstatus(orderId, 1)), uint8(TradeEscrow.MilestoneStatus.WAIVED));
        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.nextIndex, 2);
        assertEq(o.released, 600 * USDC);
        assertEq(escrow.committedOf(safe), 400 * USDC);
        assertEq(escrow.escrowedTotal(), 400 * USDC);
    }

    function test_T24_waiveByOtherAddressFrozenOrOutOfOrder() public {
        uint256 orderId = _createOrder();

        address[4] memory others = [attacker, supplier, owner, authorizer];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(TradeEscrow.Unauthorized.selector);
            escrow.waive(orderId, 0);
        }

        vm.prank(bank);
        registry.bankFreeze(safe);
        vm.prank(safe);
        vm.expectRevert(TradeEscrow.Frozen.selector);
        escrow.waive(orderId, 0);
        vm.prank(bank);
        registry.bankUnfreeze(safe);

        vm.prank(owner);
        registry.ownerFreeze(safe);
        vm.prank(safe);
        vm.expectRevert(TradeEscrow.Frozen.selector);
        escrow.waive(orderId, 0);
        vm.prank(owner);
        registry.ownerUnfreeze(safe);

        vm.startPrank(safe);
        vm.expectRevert(TradeEscrow.OutOfOrder.selector);
        escrow.waive(orderId, 1);
        escrow.waive(orderId, 0);
        vm.expectRevert(TradeEscrow.OutOfOrder.selector);
        escrow.waive(orderId, 0);
        vm.expectRevert(TradeEscrow.OutOfOrder.selector);
        escrow.waive(orderId, 7);

        vm.expectRevert(TradeEscrow.Unauthorized.selector);
        escrow.waive(42, 0);
        vm.stopPrank();
    }

    function test_waiveCheckOrder() public {
        uint256 orderId = _createOrder();
        vm.prank(bank);
        registry.bankFreeze(safe);

        vm.prank(attacker);
        vm.expectRevert(TradeEscrow.Unauthorized.selector);
        escrow.waive(orderId, 2);

        vm.prank(safe);
        vm.expectRevert(TradeEscrow.OutOfOrder.selector);
        escrow.waive(orderId, 2);

        vm.warp(block.timestamp + 8 days);
        vm.startPrank(safe);
        escrow.refund(orderId);
        vm.expectRevert(TradeEscrow.OrderNotActive.selector);
        escrow.waive(orderId, 2);
        vm.stopPrank();
    }

    function test_waiveAllMilestonesCompletesOrder() public {
        uint256 orderId = _createOrder();
        vm.startPrank(safe);
        escrow.waive(orderId, 0);
        escrow.waive(orderId, 1);
        escrow.waive(orderId, 2);
        vm.stopPrank();
        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.COMPLETED));
        assertEq(o.nextIndex, 3);
        assertEq(_usdcBalance(supplier), ORDER_TOTAL);
        assertEq(escrow.committedOf(safe), 0);
    }

    function test_T25_refundBeforeAndAfterPendingDeadline() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        _release(orderId, 0);
        uint256 safeBefore = _usdcBalance(safe);

        vm.startPrank(safe);
        vm.expectRevert(TradeEscrow.DeadlineNotPassed.selector);
        escrow.refund(orderId);
        vm.warp(ms[0].deadline + 1);
        vm.expectRevert(TradeEscrow.DeadlineNotPassed.selector);
        escrow.refund(orderId);
        vm.warp(ms[1].deadline);
        vm.expectRevert(TradeEscrow.DeadlineNotPassed.selector);
        escrow.refund(orderId);
        vm.stopPrank();

        vm.warp(ms[1].deadline + 1);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit TradeEscrow.OrderRefunded(orderId, safe, 800 * USDC);
        _execAsOwnerStrict(address(escrow), abi.encodeCall(TradeEscrow.refund, (orderId)));

        assertEq(_usdcBalance(safe), safeBefore + 800 * USDC);
        assertEq(_usdcBalance(supplier), 200 * USDC);
        assertEq(_usdcBalance(address(escrow)), 0);
        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.REFUNDED));
        assertEq(o.released, 200 * USDC);
        assertEq(uint8(_mstatus(orderId, 0)), uint8(TradeEscrow.MilestoneStatus.RELEASED));
        assertEq(uint8(_mstatus(orderId, 1)), uint8(TradeEscrow.MilestoneStatus.REFUNDED));
        assertEq(uint8(_mstatus(orderId, 2)), uint8(TradeEscrow.MilestoneStatus.REFUNDED));
        assertEq(escrow.committedOf(safe), 0);
        assertEq(escrow.escrowedTotal(), 0);

        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        p.issuedAt = uint64(block.timestamp);
        _expectSignedReleaseRevert(orderId, 1, p, _auth(orderId, 1, p), TradeEscrow.OrderNotActive.selector);
    }

    function test_T26_refundWhileFrozenByOtherAddressAndTwice() public {
        uint256 orderId = _createOrder();
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(owner);
        registry.ownerFreeze(safe);
        vm.prank(bank);
        registry.bankFreeze(safe);

        address[4] memory others = [attacker, supplier, owner, bank];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(TradeEscrow.Unauthorized.selector);
            escrow.refund(orderId);
        }

        uint256 safeBefore = _usdcBalance(safe);
        vm.startPrank(safe);
        escrow.refund(orderId);
        assertEq(_usdcBalance(safe), safeBefore + ORDER_TOTAL);
        vm.expectRevert(TradeEscrow.OrderNotActive.selector);
        escrow.refund(orderId);
        vm.expectRevert(TradeEscrow.Unauthorized.selector);
        escrow.refund(777);
        vm.stopPrank();
    }

    function test_refundOnlyToBuyerSafeOfThatOrder() public {
        (address owner2,) = makeAddrAndKey("owner2");
        address safe2 = _deploySafe(owner2);
        vm.prank(owner2);
        registry.register(safe2, owner2, bank);
        usdc.mint(safe2, ORDER_TOTAL);
        vm.startPrank(safe2);
        usdc.approve(address(escrow), ORDER_TOTAL);
        uint256 order2 = escrow.createOrder(supplier, ORDER_TOTAL, TERMS_HASH, _terms(ORDER_TOTAL));
        vm.stopPrank();
        uint256 order1 = _createOrder();

        assertEq(escrow.committedOf(safe), ORDER_TOTAL);
        assertEq(escrow.committedOf(safe2), ORDER_TOTAL);
        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(safe);
        vm.expectRevert(TradeEscrow.Unauthorized.selector);
        escrow.refund(order2);

        vm.prank(safe2);
        escrow.refund(order2);
        assertEq(_usdcBalance(safe2), ORDER_TOTAL);
        assertEq(escrow.committedOf(safe2), 0);
        assertEq(escrow.committedOf(safe), ORDER_TOTAL);
        assertEq(_order(order1).status, uint8(TradeEscrow.OrderStatus.ACTIVE));
    }

    function test_T27_allThreeMilestonesPaid() public {
        uint256 committedBefore = escrow.committedOf(safe);
        uint256 orderId = _createOrder();
        _release(orderId, 0);
        _release(orderId, 1);
        _release(orderId, 2);

        TradeEscrow.Order memory o = _order(orderId);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.COMPLETED));
        assertEq(o.nextIndex, 3);
        assertEq(o.released, ORDER_TOTAL);
        for (uint8 i; i < 3; ++i) {
            assertEq(uint8(_mstatus(orderId, i)), uint8(TradeEscrow.MilestoneStatus.RELEASED));
        }
        assertEq(escrow.committedOf(safe), committedBefore);
        assertEq(escrow.escrowedTotal(), 0);
        assertEq(_usdcBalance(supplier), ORDER_TOTAL);
        assertEq(_usdcBalance(address(escrow)), 0);

        vm.warp(block.timestamp + 31 days);
        vm.startPrank(safe);
        vm.expectRevert(TradeEscrow.OrderNotActive.selector);
        escrow.refund(orderId);
        vm.expectRevert(TradeEscrow.OrderNotActive.selector);
        escrow.waive(orderId, 2);
        vm.stopPrank();
    }

    function _assertCheckMatchesRelease(
        uint256 orderId,
        uint8 index,
        TradeEscrow.MilestoneProof memory p,
        TradeEscrow.ReleaseAuthorization memory a,
        bytes4 err
    ) internal {
        (bool ok, bytes4 sel) = escrow.checkRelease(orderId, index, p, a);
        assertFalse(ok);
        assertEq(sel, err);
        _expectSignedReleaseRevert(orderId, index, p, a, err);
    }

    function test_T28_checkReleaseMatchesReleaseExceptSignatures() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);

        (bool ok, bytes4 sel) = escrow.checkRelease(orderId, 0, p, a);
        assertTrue(ok);
        assertEq(sel, bytes4(0));

        _assertCheckMatchesRelease(99, 0, p, a, TradeEscrow.OrderNotActive.selector);
        _assertCheckMatchesRelease(orderId, 1, p, a, TradeEscrow.OutOfOrder.selector);
        _assertCheckMatchesRelease(orderId, 9, p, a, TradeEscrow.OutOfOrder.selector);

        vm.prank(bank);
        registry.bankFreeze(safe);
        _assertCheckMatchesRelease(orderId, 0, p, a, TradeEscrow.Frozen.selector);
        vm.prank(bank);
        registry.bankUnfreeze(safe);
        a = _auth(orderId, 0, p);

        TradeEscrow.MilestoneProof memory bad = _proof(orderId, 0);
        bad.kind = 2;
        _assertCheckMatchesRelease(orderId, 0, bad, _auth(orderId, 0, bad), TradeEscrow.ProofMismatch.selector);

        bad = _proof(orderId, 0);
        bad.issuedAt = uint64(block.timestamp + 1);
        _assertCheckMatchesRelease(orderId, 0, bad, _auth(orderId, 0, bad), TradeEscrow.BadProofTime.selector);

        bad = _proof(orderId, 0);
        bad.docHash = bytes32(0);
        _assertCheckMatchesRelease(orderId, 0, bad, _auth(orderId, 0, bad), TradeEscrow.ConditionNotMet.selector);

        TradeEscrow.ReleaseAuthorization memory badAuth = _auth(orderId, 0, p);
        badAuth.amount -= 1;
        _assertCheckMatchesRelease(orderId, 0, p, badAuth, TradeEscrow.AuthorizationMismatch.selector);

        badAuth = _auth(orderId, 0, p);
        badAuth.policyVersion -= 1;
        _assertCheckMatchesRelease(orderId, 0, p, badAuth, TradeEscrow.PolicyVersionMismatch.selector);

        badAuth = _auth(orderId, 0, p);
        badAuth.expiry = uint64(block.timestamp - 1);
        _assertCheckMatchesRelease(orderId, 0, p, badAuth, TradeEscrow.Expired.selector);

        escrow.release(orderId, 0, p, _signProof(carrierPk, p), a, _signAuth(authorizerPk, a));
        TradeEscrow.MilestoneProof memory p1 = _proof(orderId, 1);
        TradeEscrow.ReleaseAuthorization memory a1 = _auth(orderId, 1, p1);
        a1.nonce = a.nonce;
        _assertCheckMatchesRelease(orderId, 1, p1, a1, TradeEscrow.NonceUsed.selector);

        bad = _proof(orderId, 1);
        bad.maxTempCenti = MAX_TEMP + 1;
        _assertCheckMatchesRelease(orderId, 1, bad, _auth(orderId, 1, bad), TradeEscrow.ConditionNotMet.selector);

        a1 = _auth(orderId, 1, p1);
        (ok, sel) = escrow.checkRelease(orderId, 1, p1, a1);
        assertTrue(ok);
        _expectReleaseRevert(
            orderId,
            1,
            p1,
            _signProof(carrierPk, p1),
            a1,
            _signAuth(authorizerPk, a1),
            TradeEscrow.BadSignature.selector
        );
        _expectReleaseRevert(
            orderId, 1, p1, _signProof(sensorPk, p1), a1, _signAuth(exitKeyPk, a1), TradeEscrow.BadSignature.selector
        );
    }

    function test_T30_signedForAnotherChainIdOrEscrow() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        bytes memory issuerSig = _signProof(carrierPk, p);
        bytes memory authSig = _signAuth(authorizerPk, a);

        TradeEscrow otherEscrow = new TradeEscrow(registry, IERC20(address(usdc)));
        _expectReleaseRevert(
            orderId, 0, p, _sign(carrierPk, otherEscrow.hashProof(p)), a, authSig, TradeEscrow.BadSignature.selector
        );
        _expectReleaseRevert(
            orderId,
            0,
            p,
            issuerSig,
            a,
            _sign(authorizerPk, otherEscrow.hashAuthorization(a)),
            TradeEscrow.BadSignature.selector
        );

        uint256 chainId = block.chainid;
        vm.chainId(8453);
        bytes memory foreignIssuerSig = _signProof(carrierPk, p);
        bytes memory foreignAuthSig = _signAuth(authorizerPk, a);
        vm.chainId(chainId);
        _expectReleaseRevert(orderId, 0, p, foreignIssuerSig, a, authSig, TradeEscrow.BadSignature.selector);
        _expectReleaseRevert(orderId, 0, p, issuerSig, a, foreignAuthSig, TradeEscrow.BadSignature.selector);

        escrow.release(orderId, 0, p, issuerSig, a, authSig);
    }

    function test_T31_vaultQuarantinedByExitAgentAfterSigning() public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        vm.prank(exitKey);
        registry.quarantine(safe, address(vaultA));
        _expectSignedReleaseRevert(orderId, 0, p, a, TradeEscrow.PolicyVersionMismatch.selector);
    }

    function test_releaseAndWaiveIgnoreDeadline() public {
        uint256 orderId = _createOrder();
        vm.warp(block.timestamp + 40 days);
        _release(orderId, 0);
        vm.prank(safe);
        escrow.waive(orderId, 1);
        assertEq(_order(orderId).nextIndex, 2);
    }

    function testFuzz_createOrderAnySplit(uint256 total, uint256 s0, uint256 s1) public {
        total = bound(total, 3, SAFE_FUNDING);
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(total);
        ms[0].amount = bound(s0, 1, total - 2);
        ms[1].amount = bound(s1, 1, total - ms[0].amount - 1);
        ms[2].amount = total - ms[0].amount - ms[1].amount;

        uint256 orderId = _createOrder(total, ms);
        assertEq(escrow.committedOf(safe), total);
        assertEq(escrow.escrowedTotal(), total);
        assertEq(_usdcBalance(address(escrow)), total);
        assertEq(_order(orderId).total, total);
    }

    function testFuzz_amountsNotSummingToTotalRevert(uint256 a0, uint256 a1, uint256 a2, uint256 total) public {
        a0 = bound(a0, 1, type(uint256).max);
        a1 = bound(a1, 1, type(uint256).max);
        a2 = bound(a2, 1, type(uint256).max);
        bool sums = a0 <= total && a1 <= total - a0 && a2 == total - a0 - a1;
        vm.assume(!sums);
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        ms[0].amount = a0;
        ms[1].amount = a1;
        ms[2].amount = a2;
        _expectCreateRevert(supplier, total, ms, TradeEscrow.AmountMismatch.selector);
    }

    function testFuzz_temperatureCondition(int32 boundA, int32 boundB, int32 lo, int32 hi, uint32 samples) public {
        (int32 bMin, int32 bMax) = boundA <= boundB ? (boundA, boundB) : (boundB, boundA);
        TradeEscrow.MilestoneTerms[3] memory ms = _terms(ORDER_TOTAL);
        ms[1].minTempCenti = bMin;
        ms[1].maxTempCenti = bMax;
        uint256 orderId = _createOrder(ORDER_TOTAL, ms);
        _release(orderId, 0);

        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        p.minTempCenti = lo;
        p.maxTempCenti = hi;
        p.samples = samples;
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 1, p);
        bool expectOk = samples > 0 && lo <= hi && lo >= bMin && hi <= bMax;

        (bool ok, bytes4 sel) = escrow.checkRelease(orderId, 1, p, a);
        assertEq(ok, expectOk);
        assertEq(sel, expectOk ? bytes4(0) : TradeEscrow.ConditionNotMet.selector);
        bytes memory issuerSig = _signProof(sensorPk, p);
        bytes memory authSig = _signAuth(authorizerPk, a);
        if (!expectOk) vm.expectRevert(TradeEscrow.ConditionNotMet.selector);
        escrow.release(orderId, 1, p, issuerSig, a, authSig);
    }

    function testFuzz_tamperedAuthorizationAmount(uint256 forged) public {
        uint256 orderId = _createOrder();
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 0, p);
        vm.assume(forged != a.amount);
        bytes memory authSig = _signAuth(authorizerPk, a);
        a.amount = forged;
        _expectReleaseRevert(orderId, 0, p, _signProof(carrierPk, p), a, authSig, TradeEscrow.BadSignature.selector);
    }

    function testFuzz_tamperedProofField(uint8 field, bytes32 value) public {
        uint256 orderId = _createOrder();
        _release(orderId, 0);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 1);
        bytes memory issuerSig = _signProof(sensorPk, p);
        bytes32 before = escrow.proofStructHash(p);
        field = field % 5;
        if (field == 0) p.docHash = value;
        else if (field == 1) p.minTempCenti = int32(int256(uint256(value)));
        else if (field == 2) p.maxTempCenti = int32(int256(uint256(value)));
        else if (field == 3) p.samples = uint32(uint256(value));
        else p.issuedAt = uint64(uint256(value));
        vm.assume(escrow.proofStructHash(p) != before);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, 1, p);
        _expectReleaseRevert(orderId, 1, p, issuerSig, a, _signAuth(authorizerPk, a), TradeEscrow.BadSignature.selector);
    }

    function testFuzz_proofIssuedAtWindow(uint64 issuedAt) public {
        uint256 orderId = _createOrder();
        uint64 createdAt = _order(orderId).createdAt;
        vm.warp(block.timestamp + 1 days);
        TradeEscrow.MilestoneProof memory p = _proof(orderId, 0);
        p.issuedAt = issuedAt;
        (bool ok, bytes4 sel) = escrow.checkRelease(orderId, 0, p, _auth(orderId, 0, p));
        bool inWindow = issuedAt >= createdAt && issuedAt <= block.timestamp;
        assertEq(ok, inWindow);
        assertEq(sel, inWindow ? bytes4(0) : TradeEscrow.BadProofTime.selector);
    }

    function testFuzz_refundOnlyAfterPendingDeadline(uint256 elapsed, bool releaseFirst) public {
        uint256 orderId = _createOrder();
        if (releaseFirst) _release(orderId, 0);
        (TradeEscrow.MilestoneTerms memory pending,) = escrow.getMilestone(orderId, releaseFirst ? 1 : 0);
        vm.warp(block.timestamp + bound(elapsed, 0, 60 days));
        uint256 expected = ORDER_TOTAL - _order(orderId).released;
        uint256 safeBefore = _usdcBalance(safe);

        vm.prank(safe);
        if (block.timestamp <= pending.deadline) {
            vm.expectRevert(TradeEscrow.DeadlineNotPassed.selector);
            escrow.refund(orderId);
        } else {
            escrow.refund(orderId);
            assertEq(_usdcBalance(safe), safeBefore + expected);
            assertEq(escrow.committedOf(safe), 0);
        }
    }
}
