// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AegisTestBase} from "./AegisTestBase.sol";
import {TradeEscrow} from "../../src/TradeEscrow.sol";

abstract contract TradeEscrowTestBase is AegisTestBase {
    uint256 internal constant ORDER_TOTAL = 1_000 * USDC;
    int32 internal constant MIN_TEMP = 200;
    int32 internal constant MAX_TEMP = 800;
    bytes32 internal constant TERMS_HASH = keccak256("aegis.test.terms");

    TradeEscrow internal escrow;

    address internal supplier;
    address internal carrier;
    uint256 internal carrierPk;
    address internal sensor;
    uint256 internal sensorPk;
    address internal surveyor;
    uint256 internal surveyorPk;

    function setUp() public virtual override {
        super.setUp();
        escrow = new TradeEscrow(registry, IERC20(address(usdc)));
        supplier = makeAddr("supplier");
        (carrier, carrierPk) = makeAddrAndKey("carrier");
        (sensor, sensorPk) = makeAddrAndKey("sensor");
        (surveyor, surveyorPk) = makeAddrAndKey("surveyor");
    }

    function _terms(uint256 total) internal view returns (TradeEscrow.MilestoneTerms[3] memory ms) {
        uint256 a0 = total * 20 / 100;
        uint256 a1 = total * 40 / 100;
        ms[0] = TradeEscrow.MilestoneTerms({
            amount: a0,
            issuer: carrier,
            kind: uint8(TradeEscrow.Kind.HANDOVER),
            requireDoc: true,
            checkTemp: false,
            minTempCenti: 0,
            maxTempCenti: 0,
            deadline: uint64(block.timestamp + 7 days)
        });
        ms[1] = TradeEscrow.MilestoneTerms({
            amount: a1,
            issuer: sensor,
            kind: uint8(TradeEscrow.Kind.ARRIVAL),
            requireDoc: true,
            checkTemp: true,
            minTempCenti: MIN_TEMP,
            maxTempCenti: MAX_TEMP,
            deadline: uint64(block.timestamp + 21 days)
        });
        ms[2] = TradeEscrow.MilestoneTerms({
            amount: total - a0 - a1,
            issuer: surveyor,
            kind: uint8(TradeEscrow.Kind.QUALITY),
            requireDoc: true,
            checkTemp: false,
            minTempCenti: 0,
            maxTempCenti: 0,
            deadline: uint64(block.timestamp + 30 days)
        });
    }

    function _createOrder() internal returns (uint256) {
        return _createOrder(ORDER_TOTAL, _terms(ORDER_TOTAL));
    }

    function _createOrder(uint256 total, TradeEscrow.MilestoneTerms[3] memory ms) internal returns (uint256 orderId) {
        vm.startPrank(safe);
        usdc.approve(address(escrow), total);
        orderId = escrow.createOrder(supplier, total, TERMS_HASH, ms);
        vm.stopPrank();
    }

    function _expectCreateRevert(address supplier_, uint256 total, TradeEscrow.MilestoneTerms[3] memory ms, bytes4 err)
        internal
    {
        vm.startPrank(safe);
        usdc.approve(address(escrow), total);
        vm.expectRevert(err);
        escrow.createOrder(supplier_, total, TERMS_HASH, ms);
        vm.stopPrank();
    }

    function _issuerPk(uint8 index) internal view returns (uint256) {
        if (index == 0) return carrierPk;
        if (index == 1) return sensorPk;
        return surveyorPk;
    }

    function _proof(uint256 orderId, uint8 index) internal view returns (TradeEscrow.MilestoneProof memory p) {
        bool temp = index == 1;
        p = TradeEscrow.MilestoneProof({
            orderId: orderId,
            index: index,
            kind: index,
            docHash: keccak256(abi.encode("aegis.test.doc", orderId, index)),
            minTempCenti: temp ? int32(350) : int32(0),
            maxTempCenti: temp ? int32(620) : int32(0),
            samples: temp ? uint32(96) : uint32(0),
            issuedAt: uint64(block.timestamp)
        });
    }

    function _auth(uint256 orderId, uint8 index, TradeEscrow.MilestoneProof memory p)
        internal
        returns (TradeEscrow.ReleaseAuthorization memory a)
    {
        (TradeEscrow.MilestoneTerms memory m,) = escrow.getMilestone(orderId, index);
        a = TradeEscrow.ReleaseAuthorization({
            orderId: orderId,
            index: index,
            amount: m.amount,
            proofHash: escrow.proofStructHash(p),
            policyVersion: registry.policyVersion(safe),
            nonce: _nextNonce(),
            expiry: uint64(block.timestamp + 120)
        });
    }

    function _signProof(uint256 pk, TradeEscrow.MilestoneProof memory p) internal view returns (bytes memory) {
        return _sign(pk, escrow.hashProof(p));
    }

    function _signAuth(uint256 pk, TradeEscrow.ReleaseAuthorization memory a) internal view returns (bytes memory) {
        return _sign(pk, escrow.hashAuthorization(a));
    }

    function _release(uint256 orderId, uint8 index) internal {
        TradeEscrow.MilestoneProof memory p = _proof(orderId, index);
        TradeEscrow.ReleaseAuthorization memory a = _auth(orderId, index, p);
        vm.prank(executor);
        escrow.release(orderId, index, p, _signProof(_issuerPk(index), p), a, _signAuth(authorizerPk, a));
    }

    function _expectReleaseRevert(
        uint256 orderId,
        uint8 index,
        TradeEscrow.MilestoneProof memory p,
        bytes memory issuerSig,
        TradeEscrow.ReleaseAuthorization memory a,
        bytes memory authSig,
        bytes4 err
    ) internal {
        vm.expectRevert(err);
        vm.prank(executor);
        escrow.release(orderId, index, p, issuerSig, a, authSig);
    }

    /// Signs the proof and the authorization with the right keys, then expects `err`.
    function _expectSignedReleaseRevert(
        uint256 orderId,
        uint8 index,
        TradeEscrow.MilestoneProof memory p,
        TradeEscrow.ReleaseAuthorization memory a,
        bytes4 err
    ) internal {
        _expectReleaseRevert(orderId, index, p, _signProof(_issuerPk(index), p), a, _signAuth(authorizerPk, a), err);
    }

    function _order(uint256 orderId) internal view returns (TradeEscrow.Order memory) {
        return escrow.getOrder(orderId);
    }

    function _mstatus(uint256 orderId, uint8 index) internal view returns (TradeEscrow.MilestoneStatus status) {
        (, status) = escrow.getMilestone(orderId, index);
    }

    function _execAsOwnerStrict(address to, bytes memory data) internal {
        assertTrue(_execAsOwner(to, data), "Safe transaction failed");
    }
}
