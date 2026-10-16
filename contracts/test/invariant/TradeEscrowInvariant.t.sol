// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {TradeEscrowTestBase} from "../utils/TradeEscrowTestBase.sol";
import {TradeEscrow} from "../../src/TradeEscrow.sol";
import {PolicyRegistry} from "../../src/PolicyRegistry.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";

contract TradeEscrowHandler is Test {
    uint256 internal constant MAX_ORDERS = 16;

    struct Actors {
        address[2] buyers;
        address[2] owners;
        address[2] banks;
        address[2] suppliers;
        uint256[3] issuerPks;
        uint256 authorizerPk;
        uint256 exitKeyPk;
        uint256 attackerPk;
        address executor;
    }

    TradeEscrow internal immutable escrow;
    PolicyRegistry internal immutable registry;
    MockUSDC internal immutable usdc;
    Actors internal actors;
    uint256 internal nonceSeed;

    uint256[] public orderIds;
    mapping(uint256 orderId => uint256[3]) public payments;
    uint256 public funded;
    uint256 public paidToSuppliers;
    uint256 public refunded;
    uint256 public donated;
    bool public earlyRefund;
    bool public badPayout;
    uint256 public releases;
    uint256 public waives;
    uint256 public refunds;

    constructor(TradeEscrow escrow_, PolicyRegistry registry_, MockUSDC usdc_, Actors memory actors_) {
        escrow = escrow_;
        registry = registry_;
        usdc = usdc_;
        actors = actors_;
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function createOrder(uint256 buyerSeed, uint256 total, uint256 splitSeed, uint256 deadlineSeed) external {
        if (orderIds.length >= MAX_ORDERS) return;
        address buyer = actors.buyers[buyerSeed % 2];
        total = bound(total, 3, 20_000e6);
        TradeEscrow.MilestoneTerms[3] memory ms;
        uint256 a0 = bound(splitSeed, 1, total - 2);
        uint256 a1 = bound(splitSeed >> 128, 1, total - a0 - 1);
        uint256[3] memory amounts = [a0, a1, total - a0 - a1];
        uint64 deadline = uint64(block.timestamp);
        for (uint256 i; i < 3; ++i) {
            deadline += uint64(bound(uint256(keccak256(abi.encode(deadlineSeed, i))), i == 0 ? 1 : 0, 10 days));
            ms[i] = TradeEscrow.MilestoneTerms({
                amount: amounts[i],
                issuer: vm.addr(actors.issuerPks[i]),
                kind: uint8(i),
                requireDoc: true,
                checkTemp: i == 1,
                minTempCenti: i == 1 ? int32(200) : int32(0),
                maxTempCenti: i == 1 ? int32(800) : int32(0),
                deadline: deadline
            });
        }
        vm.startPrank(buyer);
        usdc.approve(address(escrow), total);
        try escrow.createOrder(
            actors.suppliers[(buyerSeed >> 1) & 1], total, keccak256(abi.encode(total)), ms
        ) returns (
            uint256 orderId
        ) {
            orderIds.push(orderId);
            funded += total;
        } catch {
            usdc.approve(address(escrow), 0);
        }
        vm.stopPrank();
    }

    struct ReleaseCall {
        uint256 orderId;
        uint8 index;
        TradeEscrow.MilestoneProof proof;
        bytes proofSig;
        TradeEscrow.ReleaseAuthorization auth;
        bytes authSig;
        address supplier;
        uint256 amount;
    }

    function release(uint256 orderSeed, uint256 variant, uint256 submitterSeed) external {
        if (orderIds.length == 0) return;
        variant = variant % 28;
        ReleaseCall memory c =
            _buildRelease(orderIds[orderSeed % orderIds.length], variant < 14 ? variant : 0, submitterSeed);
        uint256 supplierBefore = usdc.balanceOf(c.supplier);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        vm.prank(submitterSeed % 2 == 0 ? actors.executor : vm.addr(actors.attackerPk));
        try escrow.release(c.orderId, c.index, c.proof, c.proofSig, c.auth, c.authSig) {
            releases++;
            _recordPayout(c.orderId, c.index, c.amount, c.supplier, supplierBefore, escrowBefore);
        } catch {}
    }

    function _buildRelease(uint256 orderId, uint256 variant, uint256 submitterSeed)
        internal
        returns (ReleaseCall memory c)
    {
        TradeEscrow.Order memory o = escrow.getOrder(orderId);
        c.orderId = orderId;
        c.supplier = o.supplier;
        c.index = variant == 11 ? uint8(submitterSeed % 4) : o.nextIndex;
        uint8 termsIndex = c.index > 2 ? 2 : c.index;
        (TradeEscrow.MilestoneTerms memory m,) = escrow.getMilestone(orderId, termsIndex);
        c.amount = m.amount;
        c.proof = TradeEscrow.MilestoneProof({
            orderId: orderId,
            index: c.index,
            kind: termsIndex,
            docHash: keccak256(abi.encode("doc", orderId, c.index)),
            minTempCenti: variant == 10 ? int32(150) : int32(300),
            maxTempCenti: variant == 10 ? int32(9_999) : int32(700),
            samples: 12,
            issuedAt: uint64(block.timestamp)
        });
        c.auth = TradeEscrow.ReleaseAuthorization({
            orderId: orderId,
            index: c.index,
            amount: variant == 9 ? m.amount + 1 : m.amount,
            proofHash: escrow.proofStructHash(c.proof),
            policyVersion: registry.policyVersion(o.buyer) - (variant == 12 ? 1 : 0),
            nonce: variant == 13 ? nonceSeed : ++nonceSeed,
            expiry: uint64(block.timestamp + 120)
        });
        uint256 proofKey = variant == 6 ? actors.issuerPks[(termsIndex + 1) % 3] : actors.issuerPks[termsIndex];
        uint256 authKey = variant == 7 ? actors.exitKeyPk : variant == 8 ? actors.attackerPk : actors.authorizerPk;
        c.proofSig = _sign(proofKey, escrow.hashProof(c.proof));
        c.authSig = _sign(authKey, escrow.hashAuthorization(c.auth));
    }

    function waive(uint256 orderSeed, uint256 callerSeed, uint256 indexSeed) external {
        if (orderIds.length == 0) return;
        uint256 orderId = orderIds[orderSeed % orderIds.length];
        TradeEscrow.Order memory o = escrow.getOrder(orderId);
        address caller = _caller(callerSeed, o.buyer);
        uint8 index = indexSeed % 4 == 0 ? uint8(indexSeed % 3) : o.nextIndex;
        uint256 amount;
        if (index < 3) {
            (TradeEscrow.MilestoneTerms memory m,) = escrow.getMilestone(orderId, index);
            amount = m.amount;
        }
        uint256 supplierBefore = usdc.balanceOf(o.supplier);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        vm.prank(caller);
        try escrow.waive(orderId, index) {
            waives++;
            if (caller != o.buyer) badPayout = true;
            _recordPayout(orderId, index, amount, o.supplier, supplierBefore, escrowBefore);
        } catch {}
    }

    function refund(uint256 orderSeed, uint256 callerSeed) external {
        if (orderIds.length == 0) return;
        uint256 orderId = orderIds[orderSeed % orderIds.length];
        TradeEscrow.Order memory o = escrow.getOrder(orderId);
        address caller = _caller(callerSeed, o.buyer);
        bool beforeDeadline;
        if (o.nextIndex < 3) {
            (TradeEscrow.MilestoneTerms memory pending,) = escrow.getMilestone(orderId, o.nextIndex);
            beforeDeadline = block.timestamp <= pending.deadline;
        }
        uint256 expected = o.total - o.released;
        uint256 buyerBefore = usdc.balanceOf(o.buyer);
        vm.prank(caller);
        try escrow.refund(orderId) {
            refunds++;
            uint256 received = usdc.balanceOf(o.buyer) - buyerBefore;
            if (beforeDeadline) earlyRefund = true;
            if (caller != o.buyer || received != expected) badPayout = true;
            refunded += received;
        } catch {}
    }

    function setFreeze(uint256 seed) external {
        uint256 b = seed % 2;
        address buyer = actors.buyers[b];
        uint256 action = (seed >> 1) % 6;
        vm.startPrank(action % 2 == 0 ? actors.banks[b] : actors.owners[b]);
        if (action == 0) registry.bankFreeze(buyer);
        else if (action == 1) registry.ownerFreeze(buyer);
        else if (action % 2 == 0) registry.bankUnfreeze(buyer);
        else registry.ownerUnfreeze(buyer);
        vm.stopPrank();
    }

    function donate(uint256 amount) external {
        amount = bound(amount, 1, 1_000e6);
        usdc.mint(address(escrow), amount);
        donated += amount;
    }

    function attackerSteal(uint256 amount, uint256 orderSeed) external {
        address attacker = vm.addr(actors.attackerPk);
        amount = bound(amount, 1, 100_000e6);
        vm.startPrank(attacker);
        try usdc.transferFrom(address(escrow), attacker, amount) {} catch {}
        if (orderIds.length > 0) {
            uint256 orderId = orderIds[orderSeed % orderIds.length];
            try escrow.refund(orderId) {
                badPayout = true;
            } catch {}
            try escrow.waive(orderId, escrow.getOrder(orderId).nextIndex) {
                badPayout = true;
            } catch {}
        }
        vm.stopPrank();
    }

    function passTime(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function _recordPayout(
        uint256 orderId,
        uint8 index,
        uint256 amount,
        address supplier,
        uint256 supplierBefore,
        uint256 escrowBefore
    ) internal {
        payments[orderId][index]++;
        uint256 paid = usdc.balanceOf(supplier) - supplierBefore;
        if (paid != amount || escrowBefore - usdc.balanceOf(address(escrow)) != amount) badPayout = true;
        paidToSuppliers += paid;
    }

    function _caller(uint256 seed, address buyer) internal view returns (address) {
        uint256 c = seed % 4;
        if (c == 0) return vm.addr(actors.attackerPk);
        if (c == 1) return actors.buyers[0] == buyer ? actors.buyers[1] : actors.buyers[0];
        return buyer;
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}

/// T32 to T35: escrow accounting, payees, no double payment, refund timing and per-buyer commitments, with an
/// adversary holding the Authorizer, Exit, issuer and Executor keys.
contract TradeEscrowInvariantTest is TradeEscrowTestBase {
    TradeEscrowHandler internal handler;
    address internal safe2;
    address internal owner2;
    address internal bank2;
    address internal supplier2;

    function setUp() public override {
        super.setUp();
        owner2 = makeAddr("owner2");
        bank2 = makeAddr("bank2");
        supplier2 = makeAddr("supplier2");
        safe2 = _deploySafe(owner2);
        vm.startPrank(owner2);
        registry.register(safe2, owner2, bank2);
        registry.setAuthorizer(safe2, authorizer);
        registry.setExitKey(safe2, exitKey);
        vm.stopPrank();
        usdc.mint(safe, 1_000_000 * USDC);
        usdc.mint(safe2, 1_000_000 * USDC);

        TradeEscrowHandler.Actors memory actors = TradeEscrowHandler.Actors({
            buyers: [safe, safe2],
            owners: [owner, owner2],
            banks: [bank, bank2],
            suppliers: [supplier, supplier2],
            issuerPks: [carrierPk, sensorPk, surveyorPk],
            authorizerPk: authorizerPk,
            exitKeyPk: exitKeyPk,
            attackerPk: attackerPk,
            executor: executor
        });
        handler = new TradeEscrowHandler(escrow, registry, usdc, actors);
        targetContract(address(handler));
    }

    function _unreleasedActive(address buyer, bool anyBuyer) internal view returns (uint256 sum) {
        uint256 n = handler.orderCount();
        for (uint256 i; i < n; ++i) {
            TradeEscrow.Order memory o = escrow.getOrder(handler.orderIds(i));
            if (o.status == uint8(TradeEscrow.OrderStatus.ACTIVE) && (anyBuyer || o.buyer == buyer)) {
                sum += o.total - o.released;
            }
        }
    }

    function invariant_T32_escrowBalanceEqualsUnreleased() public view {
        assertEq(escrow.escrowedTotal(), _unreleasedActive(address(0), true), "escrowedTotal");
        assertEq(usdc.balanceOf(address(escrow)), escrow.escrowedTotal() + handler.donated(), "escrow balance");
    }

    function invariant_T33_tokensLeaveOnlyToSupplierOrBuyer() public view {
        assertFalse(handler.badPayout(), "payout to a wrong address or of a wrong amount");
        address[7] memory outsiders = [attacker, executor, authorizer, exitKey, carrier, sensor, surveyor];
        for (uint256 i; i < outsiders.length; ++i) {
            assertEq(usdc.balanceOf(outsiders[i]), 0, "adversary balance rose");
        }
        assertEq(usdc.balanceOf(supplier) + usdc.balanceOf(supplier2), handler.paidToSuppliers(), "supplier receipts");
        assertEq(
            handler.paidToSuppliers() + handler.refunded() + escrow.escrowedTotal(), handler.funded(), "funds conserved"
        );
    }

    function invariant_T34_noDoublePayment() public view {
        uint256 n = handler.orderCount();
        for (uint256 k; k < n; ++k) {
            uint256 orderId = handler.orderIds(k);
            TradeEscrow.Order memory o = escrow.getOrder(orderId);
            assertLe(o.released, o.total);
            assertEq(o.status == uint8(TradeEscrow.OrderStatus.COMPLETED), o.nextIndex == 3, "completed iff 3 paid");
            uint256 paid;
            for (uint8 i; i < 3; ++i) {
                (TradeEscrow.MilestoneTerms memory m, TradeEscrow.MilestoneStatus st) = escrow.getMilestone(orderId, i);
                bool isPaid = st == TradeEscrow.MilestoneStatus.RELEASED || st == TradeEscrow.MilestoneStatus.WAIVED;
                assertEq(isPaid, i < o.nextIndex, "paid exactly below nextIndex");
                assertEq(handler.payments(orderId, i), isPaid ? 1 : 0, "each milestone paid at most once");
                if (isPaid) paid += m.amount;
                if (!isPaid) {
                    TradeEscrow.MilestoneStatus expected = o.status == uint8(TradeEscrow.OrderStatus.REFUNDED)
                        ? TradeEscrow.MilestoneStatus.REFUNDED
                        : TradeEscrow.MilestoneStatus.PENDING;
                    assertEq(uint8(st), uint8(expected));
                }
            }
            assertEq(o.released, paid, "released equals paid milestones");
        }
    }

    function invariant_T35_refundTimingAndCommitments() public view {
        assertFalse(handler.earlyRefund(), "refund before the pending deadline");
        assertEq(escrow.committedOf(safe), _unreleasedActive(safe, false), "committedOf safe");
        assertEq(escrow.committedOf(safe2), _unreleasedActive(safe2, false), "committedOf safe2");
    }

    function afterInvariant() public view {
        console2.log("orders", handler.orderCount());
        console2.log("releases", handler.releases());
        console2.log("waives", handler.waives());
        console2.log("refunds", handler.refunds());
    }
}
