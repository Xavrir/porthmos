// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// Test double shaped like Coinbase Smart Wallet: one EOA owner, ERC-1271 over a replay-safe EIP-712 wrap of the
/// hash (so the owner's signature never recovers to the wallet address), owner-only execute and atomic executeBatch.
/// Used only by the service's SIWE tests and the browser QA on Anvil; never deployed to a public chain.
contract MockSmartWallet {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes32 internal constant MESSAGE_TYPEHASH = keccak256("MockSmartWalletMessage(bytes32 hash)");
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    address public immutable owner;

    error NotOwner();
    error CallFailed(uint256 index, bytes reason);

    constructor(address owner_) {
        owner = owner_;
    }

    receive() external payable {}

    function replaySafeHash(bytes32 hash) public view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("Mock Smart Wallet"), keccak256("1"), block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(MESSAGE_TYPEHASH, hash))));
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(replaySafeHash(hash), signature);
        return err == ECDSA.RecoverError.NoError && signer == owner ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, bytes memory out) = target.call{value: value}(data);
        if (!ok) revert CallFailed(0, out);
        return out;
    }

    function executeBatch(Call[] calldata calls) external {
        if (msg.sender != owner) revert NotOwner();
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory out) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, out);
        }
    }
}

/// CREATE2 factory, so a wallet has an address (and can sign ERC-6492 messages) before it is deployed.
contract MockSmartWalletFactory {
    event AccountCreated(address indexed account, address indexed owner, uint256 nonce);

    function createAccount(address owner, uint256 nonce) external returns (MockSmartWallet account) {
        address predicted = getAddress(owner, nonce);
        if (predicted.code.length > 0) return MockSmartWallet(payable(predicted));
        account = new MockSmartWallet{salt: _salt(owner, nonce)}(owner);
        emit AccountCreated(address(account), owner, nonce);
    }

    function getAddress(address owner, uint256 nonce) public view returns (address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(MockSmartWallet).creationCode, abi.encode(owner)));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(owner, nonce), codeHash)))));
    }

    function _salt(address owner, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, nonce));
    }
}
