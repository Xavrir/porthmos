// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AegisTestBase} from "./utils/AegisTestBase.sol";
import {AegisModule} from "../src/AegisModule.sol";

/// Cross-checks the module digests against Foundry's generic eth_signTypedData_v4 encoder, which is what
/// wallets (viem, MetaMask) compute for the service and web clients.
contract Eip712Test is AegisTestBase {
    string internal constant DOMAIN_TYPE =
        '"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}]';

    function _domain() internal view returns (string memory) {
        return string.concat(
            '"domain":{"name":"AegisModule","version":"1","chainId":',
            vm.toString(block.chainid),
            ',"verifyingContract":"',
            vm.toString(address(module)),
            '"}'
        );
    }

    function test_approvalDigestMatchesTypedDataV4() public {
        AegisModule.Approval memory ap = _approval(address(vaultA), 1_234 * USDC);
        string memory json = string.concat(
            '{"types":{',
            DOMAIN_TYPE,
            ',"Approval":[{"name":"safe","type":"address"},{"name":"op","type":"uint8"},{"name":"vault","type":"address"},{"name":"maxAmount","type":"uint256"},{"name":"policyVersion","type":"uint64"},{"name":"approvalExpiry","type":"uint64"},{"name":"approvalNonce","type":"uint256"}]},',
            '"primaryType":"Approval",',
            _domain(),
            ',"message":{"safe":"',
            vm.toString(ap.safe),
            '","op":0,"vault":"',
            vm.toString(ap.vault),
            '","maxAmount":"',
            vm.toString(ap.maxAmount),
            '","policyVersion":',
            vm.toString(uint256(ap.policyVersion)),
            ',"approvalExpiry":',
            vm.toString(uint256(ap.approvalExpiry)),
            ',"approvalNonce":"',
            vm.toString(ap.approvalNonce),
            '"}}'
        );
        assertEq(module.hashApproval(ap), vm.eip712HashTypedData(json));
    }

    function test_darDigestMatchesTypedDataV4() public {
        AegisModule.DAR memory dar = _depositDar(address(vaultB), 777 * USDC, 3, keccak256("approval"));
        dar.minOut = 700 * USDC;
        string memory types = string.concat(
            '{"types":{',
            DOMAIN_TYPE,
            ',"DAR":[{"name":"safe","type":"address"},{"name":"op","type":"uint8"},{"name":"vault","type":"address"},{"name":"amount","type":"uint256"},{"name":"minOut","type":"uint256"},{"name":"policyVersion","type":"uint64"},{"name":"priceLow","type":"int256"},{"name":"priceHigh","type":"int256"},{"name":"tier","type":"uint8"},{"name":"approvalHash","type":"bytes32"},{"name":"nonce","type":"uint256"},{"name":"expiry","type":"uint64"},{"name":"evidenceHash","type":"bytes32"}]},',
            '"primaryType":"DAR",',
            _domain()
        );
        string memory message = string.concat(
            ',"message":{"safe":"',
            vm.toString(dar.safe),
            '","op":0,"vault":"',
            vm.toString(dar.vault),
            '","amount":"',
            vm.toString(dar.amount),
            '","minOut":"',
            vm.toString(dar.minOut),
            '","policyVersion":',
            vm.toString(uint256(dar.policyVersion)),
            ',"priceLow":"',
            vm.toString(dar.priceLow),
            '","priceHigh":"',
            vm.toString(dar.priceHigh)
        );
        message = string.concat(
            message,
            '","tier":3,"approvalHash":"',
            vm.toString(dar.approvalHash),
            '","nonce":"',
            vm.toString(dar.nonce),
            '","expiry":',
            vm.toString(uint256(dar.expiry)),
            ',"evidenceHash":"',
            vm.toString(dar.evidenceHash),
            '"}}'
        );
        assertEq(module.hashDAR(dar), vm.eip712HashTypedData(string.concat(types, message)));
    }
}
