// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// RLP encoding for signed legacy (EIP-155) transactions.
library RawTx {
    struct Tx {
        uint256 nonce;
        uint256 gasPrice;
        uint256 gasLimit;
        address to;
        uint256 value;
        bytes data;
        uint256 chainId;
    }

    function signingPayload(Tx memory t) internal pure returns (bytes memory) {
        return _encode(t, t.chainId, 0, 0);
    }

    function signed(Tx memory t, uint8 v, bytes32 r, bytes32 s) internal pure returns (bytes memory) {
        uint256 v155 = t.chainId * 2 + 35 + (v - 27);
        return _encode(t, v155, uint256(r), uint256(s));
    }

    function _encode(Tx memory t, uint256 a, uint256 b, uint256 c) private pure returns (bytes memory) {
        bytes memory payload = bytes.concat(
            encodeUint(t.nonce),
            encodeUint(t.gasPrice),
            encodeUint(t.gasLimit),
            encodeBytes(abi.encodePacked(t.to)),
            encodeUint(t.value),
            encodeBytes(t.data)
        );
        payload = bytes.concat(payload, encodeUint(a), encodeUint(b), encodeUint(c));
        return bytes.concat(_header(0xc0, payload.length), payload);
    }

    function encodeUint(uint256 x) internal pure returns (bytes memory) {
        return encodeBytes(_minimalBigEndian(x));
    }

    function encodeBytes(bytes memory b) internal pure returns (bytes memory) {
        if (b.length == 1 && uint8(b[0]) < 0x80) return b;
        return bytes.concat(_header(0x80, b.length), b);
    }

    function _header(uint8 offset, uint256 length) private pure returns (bytes memory) {
        if (length <= 55) return abi.encodePacked(uint8(offset + length));
        bytes memory len = _minimalBigEndian(length);
        return bytes.concat(abi.encodePacked(uint8(offset + 55 + len.length)), len);
    }

    function _minimalBigEndian(uint256 x) private pure returns (bytes memory out) {
        uint256 n;
        for (uint256 y = x; y != 0; y >>= 8) {
            n++;
        }
        out = new bytes(n);
        for (uint256 i = n; i > 0; i--) {
            out[i - 1] = bytes1(uint8(x));
            x >>= 8;
        }
    }
}
