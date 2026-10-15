// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {AegisScriptBase} from "./utils/AegisScriptBase.sol";
import {RawTx} from "./utils/RawTx.sol";
import {AegisModule} from "../src/AegisModule.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";

/// Broadcasts the E4a, E4b, E4d and E5 evidence transactions against an existing deployment.
/// Every transaction is signed here and sent with eth_sendRawTransaction at a fixed gas limit, so a call
/// that reverts is still mined and gets a hash (wallet libraries refuse to send a transaction whose gas
/// estimate reverts). Run without --broadcast: this script sends its own transactions.
contract Attack is AegisScriptBase {
    uint256 internal constant FIXED_GAS = 1_500_000;
    uint256 internal constant WAIT_POLLS = 120;

    struct Sent {
        string label;
        bytes32 hash;
        string expected;
        uint256 status;
    }

    string internal rpcUrl;
    Keys internal k;
    AegisModule internal module;
    PolicyRegistry internal registry;
    MockPriceFeed internal feed;
    address internal safe;
    address internal vaultA;
    uint256 internal nonceCounter;
    uint256 internal runSalt;
    Sent[] internal sent;

    function run() external {
        rpcUrl = vm.envOr("RPC_URL", string("http://127.0.0.1:8545"));
        k = _keys();
        runSalt = vm.unixTime();
        _loadDeployment();

        _send(k.keeper, address(feed), abi.encodeCall(MockPriceFeed.poke, ()), "setup: keeper refreshes oracle", "");

        bytes memory validDeposit = _depositCall(500e6, false);
        _send(k.executor, address(module), validDeposit, "E4b setup: valid deposit", "");
        _send(k.attacker, address(module), validDeposit, "E4b: replayed DAR", "NonceUsed()");

        _send(k.attacker, address(module), _depositCall(300e6, true), "E4a: amount tampered", "BadSignature()");

        bytes memory signedBeforeMove = _depositCall(300e6, false);
        _send(
            k.deployer, address(feed), abi.encodeCall(MockPriceFeed.setPrice, (97_000_000)), "E4d setup: price 0.97", ""
        );
        _send(k.executor, address(module), signedBeforeMove, "E4d: out-of-band submit", "PriceOutOfBand()");
        _send(
            k.deployer,
            address(feed),
            abi.encodeCall(MockPriceFeed.setPrice, (INITIAL_PRICE)),
            "E4d cleanup: price 1.00",
            ""
        );

        _send(
            k.bank,
            address(registry),
            abi.encodeCall(PolicyRegistry.revokeAuthorizer, (safe)),
            "E5 setup: bank revoke+freeze",
            ""
        );
        _send(k.executor, address(module), _depositCall(300e6, false), "E5: deposit while bank-frozen", "Frozen()");
        _send(k.executor, address(module), _exitRedeemCall(), "E5: exit redeem still executes", "");
        _send(
            k.bank,
            address(registry),
            abi.encodeCall(PolicyRegistry.bankUnfreeze, (safe)),
            "E5 cleanup: bank unfreeze",
            ""
        );
        _send(
            k.owner,
            address(registry),
            abi.encodeCall(PolicyRegistry.setAuthorizer, (safe, vm.addr(k.authorizer))),
            "E5 cleanup: owner restores authorizer",
            ""
        );

        _printSummary();
    }

    function _loadDeployment() internal {
        string memory json = vm.readFile(_deploymentPath());
        module = AegisModule(vm.parseJsonAddress(json, ".module"));
        registry = PolicyRegistry(vm.parseJsonAddress(json, ".registry"));
        feed = MockPriceFeed(vm.parseJsonAddress(json, ".priceFeed"));
        safe = vm.parseJsonAddress(json, ".safe");
        vaultA = vm.parseJsonAddress(json, ".vaultA");
    }

    function _depositCall(uint256 amount, bool tamperAfterSigning) internal returns (bytes memory) {
        _refresh();
        uint8 tier = module.requiredTier(safe, vaultA, amount);
        uint64 version = registry.policyVersion(safe);
        uint64 nowTs = _now();
        (, int256 price,,,) = feed.latestRoundData();

        AegisModule.Approval memory ap;
        bytes memory ownerSig;
        if (tier >= 3) {
            ap = AegisModule.Approval(safe, 0, vaultA, amount, version, nowTs + 1 days, _nonce());
            ownerSig = _sign(k.owner, module.hashApproval(ap));
        }
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 0,
            vault: vaultA,
            amount: amount,
            minOut: IERC4626(vaultA).previewDeposit(amount) * 995 / 1000,
            policyVersion: version,
            priceLow: price - 1e6,
            priceHigh: price + 1e6,
            tier: tier,
            approvalHash: tier >= 3 ? module.approvalStructHash(ap) : bytes32(0),
            nonce: _nonce(),
            expiry: nowTs + 120,
            evidenceHash: keccak256(abi.encode("aegis.attack-script", runSalt, nonceCounter))
        });
        bytes memory authSig = _sign(k.authorizer, module.hashDAR(dar));
        if (tamperAfterSigning) dar.amount = amount * 3;
        return abi.encodeCall(AegisModule.deposit, (dar, authSig, ownerSig, "", ap));
    }

    function _exitRedeemCall() internal returns (bytes memory) {
        _refresh();
        uint256 shares = IERC20(vaultA).balanceOf(safe) / 2;
        AegisModule.DAR memory dar = AegisModule.DAR({
            safe: safe,
            op: 1,
            vault: vaultA,
            amount: shares,
            minOut: IERC4626(vaultA).previewRedeem(shares) * 995 / 1000,
            policyVersion: registry.policyVersion(safe),
            priceLow: 0,
            priceHigh: 0,
            tier: 1,
            approvalHash: bytes32(0),
            nonce: _nonce(),
            expiry: _now() + 120,
            evidenceHash: keccak256(abi.encode("aegis.attack-script.exit", runSalt))
        });
        return abi.encodeCall(AegisModule.redeem, (dar, _sign(k.exitKey, module.hashDAR(dar))));
    }

    function _send(uint256 pk, address to, bytes memory data, string memory label, string memory expectedError)
        internal
    {
        address from = vm.addr(pk);
        _refresh();
        uint256 nonce = vm.getNonce(from);
        _simulate(from, to, data, expectedError);

        RawTx.Tx memory t = RawTx.Tx({
            nonce: nonce,
            gasPrice: block.basefee * 2 + 1 gwei,
            gasLimit: FIXED_GAS,
            to: to,
            value: 0,
            data: data,
            chainId: block.chainid
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(RawTx.signingPayload(t)));
        bytes memory raw = RawTx.signed(t, v, r, s);
        bytes32 hash = bytes32(vm.rpc(rpcUrl, "eth_sendRawTransaction", string.concat('["', vm.toString(raw), '"]')));

        _waitUntilMined(from, t.nonce);
        uint256 status = vm.parseJsonUint(
            vm.rpcJson(rpcUrl, "eth_getTransactionReceipt", string.concat('["', vm.toString(hash), '"]')), ".status"
        );
        bool expectRevert = bytes(expectedError).length != 0;
        require(status == (expectRevert ? 0 : 1), string.concat(label, ": unexpected receipt status"));

        sent.push(Sent(label, hash, expectRevert ? expectedError : "success", status));
        console2.log(label);
        console2.log("  tx:", vm.toString(hash));
        console2.log("  expected:", expectRevert ? expectedError : "success", "| receipt status:", status);
    }

    /// Runs the call on a fresh fork first so a wrong precondition fails here, not as an unexplained revert.
    /// In script mode a pranked top-level call bumps the sender nonce on the fork, so read the nonce before this.
    function _simulate(address from, address to, bytes memory data, string memory expectedError) internal {
        vm.prank(from);
        (bool ok, bytes memory ret) = to.call(data);
        if (bytes(expectedError).length == 0) {
            require(ok, "simulation: expected success but call reverted");
        } else {
            require(!ok && ret.length >= 4, "simulation: expected a revert");
            require(bytes4(ret) == bytes4(keccak256(bytes(expectedError))), "simulation: unexpected revert reason");
        }
    }

    function _waitUntilMined(address from, uint256 nonce) internal {
        for (uint256 i; i < WAIT_POLLS; i++) {
            _refresh();
            if (vm.getNonce(from) > nonce) return;
            vm.sleep(1000);
        }
        revert("transaction not mined in time");
    }

    function _refresh() internal {
        vm.createSelectFork(rpcUrl);
    }

    /// Anvil only mines on demand, so the latest block time can lag the wall clock by minutes.
    function _now() internal view returns (uint64) {
        uint256 wall = vm.unixTime() / 1000;
        return uint64(wall > block.timestamp ? wall : block.timestamp);
    }

    function _nonce() internal returns (uint256) {
        return uint256(keccak256(abi.encode("aegis.attack-script.nonce", runSalt, ++nonceCounter)));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _printSummary() internal view {
        console2.log("");
        console2.log("Summary (label | tx hash | expected | status)");
        for (uint256 i; i < sent.length; i++) {
            console2.log(
                string.concat(
                    sent[i].label,
                    " | ",
                    vm.toString(sent[i].hash),
                    " | ",
                    sent[i].expected,
                    " | ",
                    vm.toString(sent[i].status)
                )
            );
        }
    }
}
