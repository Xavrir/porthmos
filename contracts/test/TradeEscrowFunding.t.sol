// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";
import {MultiSendCallOnly} from "@safe-global/safe-smart-account/libraries/MultiSendCallOnly.sol";
import {TradeEscrowTestBase} from "./utils/TradeEscrowTestBase.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";

/// T1: the buyer Safe funds an order in one owner-signed Safe transaction that delegatecalls MultiSendCallOnly
/// with approve(escrow, total) and createOrder(...).
contract TradeEscrowFundingTest is TradeEscrowTestBase {
    MultiSendCallOnly internal multiSend;

    function setUp() public override {
        super.setUp();
        multiSend = new MultiSendCallOnly();
    }

    function _packed(uint8 operation, address to, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodePacked(operation, to, uint256(0), data.length, data);
    }

    function _fundingBatch(uint256 approveAmount, uint256 total) internal view returns (bytes memory) {
        return abi.encodeCall(
            MultiSendCallOnly.multiSend,
            (bytes.concat(
                    _packed(0, address(usdc), abi.encodeCall(IERC20.approve, (address(escrow), approveAmount))),
                    _packed(
                        0,
                        address(escrow),
                        abi.encodeCall(TradeEscrow.createOrder, (supplier, total, TERMS_HASH, _terms(total)))
                    )
                ))
        );
    }

    function _execDelegateCallAsOwner(bytes memory data) internal returns (bool) {
        bytes memory prevalidated = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        vm.prank(owner);
        return safeContract.execTransaction(
            address(multiSend),
            0,
            data,
            Enum.Operation.DelegateCall,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            prevalidated
        );
    }

    function test_T1_createOrderThroughSafeMultiSendCallOnly() public {
        bytes memory data = _fundingBatch(ORDER_TOTAL, ORDER_TOTAL);
        uint256 safeBefore = _usdcBalance(safe);
        uint256 safeNonce = safeContract.nonce();

        vm.expectEmit(true, true, true, true, address(escrow));
        emit TradeEscrow.OrderCreated(1, safe, supplier, ORDER_TOTAL, TERMS_HASH);
        assertTrue(_execDelegateCallAsOwner(data));
        emit log_named_uint(
            "gas: Safe execTransaction, MultiSendCallOnly approve + createOrder", vm.lastCallGas().gasTotalUsed
        );

        assertEq(safeContract.nonce(), safeNonce + 1);
        assertEq(_usdcBalance(address(escrow)), ORDER_TOTAL);
        assertEq(_usdcBalance(safe), safeBefore - ORDER_TOTAL);
        assertEq(escrow.committedOf(safe), ORDER_TOTAL);
        assertEq(escrow.escrowedTotal(), ORDER_TOTAL);
        assertEq(usdc.allowance(safe, address(escrow)), 0, "allowance consumed in the same transaction");
        TradeEscrow.Order memory o = _order(1);
        assertEq(o.buyer, safe);
        assertEq(o.supplier, supplier);
        assertEq(o.status, uint8(TradeEscrow.OrderStatus.ACTIVE));
    }

    function test_T1_fundingIsAtomicWhenCreateOrderFails() public {
        bytes memory data = _fundingBatch(ORDER_TOTAL - 1, ORDER_TOTAL);
        uint256 safeBefore = _usdcBalance(safe);
        vm.expectRevert(bytes("GS013"));
        _execDelegateCallAsOwner(data);

        vm.prank(bank);
        registry.bankFreeze(safe);
        data = _fundingBatch(ORDER_TOTAL, ORDER_TOTAL);
        vm.expectRevert(bytes("GS013"));
        _execDelegateCallAsOwner(data);

        assertEq(_usdcBalance(safe), safeBefore);
        assertEq(usdc.allowance(safe, address(escrow)), 0);
        assertEq(escrow.nextOrderId(), 1);
        assertEq(escrow.committedOf(safe), 0);
    }

    function test_T1_multiSendCallOnlyRefusesNestedDelegateCall() public {
        bytes memory data = abi.encodeCall(
            MultiSendCallOnly.multiSend,
            (_packed(1, address(usdc), abi.encodeCall(IERC20.approve, (attacker, type(uint256).max))))
        );
        vm.expectRevert(bytes("GS013"));
        _execDelegateCallAsOwner(data);
        assertEq(usdc.allowance(safe, attacker), 0);
    }

    function test_T1_fundingRequiresOwnerSignature() public {
        bytes memory data = _fundingBatch(ORDER_TOTAL, ORDER_TOTAL);
        bytes memory prevalidated = abi.encodePacked(bytes32(uint256(uint160(attacker))), bytes32(0), uint8(1));
        vm.prank(attacker);
        vm.expectRevert(bytes("GS026"));
        safeContract.execTransaction(
            address(multiSend),
            0,
            data,
            Enum.Operation.DelegateCall,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            prevalidated
        );
    }
}
