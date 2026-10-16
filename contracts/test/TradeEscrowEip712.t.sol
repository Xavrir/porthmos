// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {TradeEscrowTestBase} from "./utils/TradeEscrowTestBase.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";

/// T29: the escrow digests equal Foundry's generic eth_signTypedData_v4 encoder (what viem and eth_account compute).
contract TradeEscrowEip712Test is TradeEscrowTestBase {
    string internal constant PROOF_TYPE =
        "MilestoneProof(uint256 orderId,uint8 index,uint8 kind,bytes32 docHash,int32 minTempCenti,int32 maxTempCenti,uint32 samples,uint64 issuedAt)";
    string internal constant AUTH_TYPE =
        "ReleaseAuthorization(uint256 orderId,uint8 index,uint256 amount,bytes32 proofHash,uint64 policyVersion,uint256 nonce,uint64 expiry)";
    string internal constant DOMAIN_TYPE =
        '"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}]';

    function _domain() internal view returns (string memory) {
        return string.concat(
            '"domain":{"name":"TradeEscrow","version":"1","chainId":',
            vm.toString(block.chainid),
            ',"verifyingContract":"',
            vm.toString(address(escrow)),
            '"}'
        );
    }

    function _negativeProof() internal view returns (TradeEscrow.MilestoneProof memory p) {
        p = TradeEscrow.MilestoneProof({
            orderId: 7,
            index: 1,
            kind: 1,
            docHash: keccak256("sensor log export"),
            minTempCenti: -2_150,
            maxTempCenti: -1_800,
            samples: 288,
            issuedAt: uint64(block.timestamp)
        });
    }

    function _proofJson(TradeEscrow.MilestoneProof memory p) internal view returns (string memory) {
        string memory head = string.concat(
            '{"types":{',
            DOMAIN_TYPE,
            ',"MilestoneProof":[{"name":"orderId","type":"uint256"},{"name":"index","type":"uint8"},{"name":"kind","type":"uint8"},{"name":"docHash","type":"bytes32"},{"name":"minTempCenti","type":"int32"},{"name":"maxTempCenti","type":"int32"},{"name":"samples","type":"uint32"},{"name":"issuedAt","type":"uint64"}]},',
            '"primaryType":"MilestoneProof",',
            _domain()
        );
        return string.concat(
            head,
            ',"message":{"orderId":"',
            vm.toString(p.orderId),
            '","index":',
            vm.toString(uint256(p.index)),
            ',"kind":',
            vm.toString(uint256(p.kind)),
            ',"docHash":"',
            vm.toString(p.docHash),
            '","minTempCenti":',
            vm.toString(int256(p.minTempCenti)),
            ',"maxTempCenti":',
            vm.toString(int256(p.maxTempCenti)),
            ',"samples":',
            vm.toString(uint256(p.samples)),
            ',"issuedAt":',
            vm.toString(uint256(p.issuedAt)),
            "}}"
        );
    }

    function test_T29_typeHashesMatchSpecTypeStrings() public view {
        assertEq(escrow.MILESTONE_PROOF_TYPEHASH(), keccak256(bytes(PROOF_TYPE)));
        assertEq(escrow.MILESTONE_PROOF_TYPEHASH(), vm.eip712HashType(PROOF_TYPE));
        assertEq(escrow.RELEASE_AUTHORIZATION_TYPEHASH(), keccak256(bytes(AUTH_TYPE)));
        assertEq(escrow.RELEASE_AUTHORIZATION_TYPEHASH(), vm.eip712HashType(AUTH_TYPE));
    }

    function test_T29_proofDigestWithNegativeTemperaturesMatchesTypedDataV4() public view {
        TradeEscrow.MilestoneProof memory p = _negativeProof();
        assertEq(escrow.hashProof(p), vm.eip712HashTypedData(_proofJson(p)));

        bytes32 structHash = vm.eip712HashStruct(PROOF_TYPE, abi.encode(p));
        assertEq(escrow.proofStructHash(p), structHash);
        bytes32 signExtended = keccak256(
            abi.encode(
                keccak256(bytes(PROOF_TYPE)),
                p.orderId,
                uint256(p.index),
                uint256(p.kind),
                p.docHash,
                int256(p.minTempCenti),
                int256(p.maxTempCenti),
                uint256(p.samples),
                uint256(p.issuedAt)
            )
        );
        assertEq(escrow.proofStructHash(p), signExtended, "int32 is sign-extended to 32 bytes");
        assertEq(escrow.hashProof(p), MessageHashUtils.toTypedDataHash(_domainSeparator(), structHash));
    }

    function test_T29_positiveProofDigestMatchesTypedDataV4() public view {
        TradeEscrow.MilestoneProof memory p = _negativeProof();
        p.minTempCenti = 200;
        p.maxTempCenti = 800;
        assertEq(escrow.hashProof(p), vm.eip712HashTypedData(_proofJson(p)));
    }

    function test_T29_authorizationDigestMatchesTypedDataV4() public view {
        TradeEscrow.MilestoneProof memory p = _negativeProof();
        TradeEscrow.ReleaseAuthorization memory a = TradeEscrow.ReleaseAuthorization({
            orderId: 7,
            index: 1,
            amount: 400 * USDC,
            proofHash: escrow.proofStructHash(p),
            policyVersion: 13,
            nonce: uint256(keccak256("aegis.release.nonce")),
            expiry: uint64(block.timestamp + 120)
        });
        string memory head = string.concat(
            '{"types":{',
            DOMAIN_TYPE,
            ',"ReleaseAuthorization":[{"name":"orderId","type":"uint256"},{"name":"index","type":"uint8"},{"name":"amount","type":"uint256"},{"name":"proofHash","type":"bytes32"},{"name":"policyVersion","type":"uint64"},{"name":"nonce","type":"uint256"},{"name":"expiry","type":"uint64"}]},',
            '"primaryType":"ReleaseAuthorization",',
            _domain()
        );
        string memory json = string.concat(
            head,
            ',"message":{"orderId":"',
            vm.toString(a.orderId),
            '","index":1,"amount":"',
            vm.toString(a.amount),
            '","proofHash":"',
            vm.toString(a.proofHash),
            '","policyVersion":',
            vm.toString(uint256(a.policyVersion)),
            ',"nonce":"',
            vm.toString(a.nonce),
            '","expiry":',
            vm.toString(uint256(a.expiry)),
            "}}"
        );
        assertEq(escrow.hashAuthorization(a), vm.eip712HashTypedData(json));
        assertEq(
            escrow.hashAuthorization(a),
            MessageHashUtils.toTypedDataHash(_domainSeparator(), vm.eip712HashStruct(AUTH_TYPE, abi.encode(a)))
        );
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("TradeEscrow"),
                keccak256("1"),
                block.chainid,
                address(escrow)
            )
        );
    }
}
