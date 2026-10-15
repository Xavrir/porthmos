// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

abstract contract AegisScriptBase is Script {
    uint256 internal constant ANVIL_CHAIN_ID = 31337;
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    uint256 internal constant AUTO_CAP = 1_000e6;
    uint256 internal constant DAILY_CAP = 5_000e6;
    uint256 internal constant BANK_LIMIT = 3_000e6;
    uint256 internal constant RESERVE_FLOOR = 4_500e6;
    uint256 internal constant MAX_BAND_WIDTH = 2_000_000;
    uint256 internal constant MAX_ORACLE_AGE = 180;
    uint256 internal constant SAFE_FUNDING = 10_000e6;
    uint256 internal constant VAULT_SEED = 50_000e6;
    int256 internal constant INITIAL_PRICE = 1e8;

    struct Keys {
        uint256 deployer;
        uint256 owner;
        uint256 bank;
        uint256 authorizer;
        uint256 exitKey;
        uint256 executor;
        uint256 keeper;
        uint256 attacker;
    }

    /// Public Anvil keys on 31337 only; any other chain must supply every key through the environment.
    function _keys() internal view returns (Keys memory k) {
        k.deployer = _key("DEPLOYER_KEY", 0);
        k.owner = _key("OWNER_KEY", 1);
        k.bank = _key("BANK_KEY", 2);
        k.authorizer = _key("AUTHORIZER_KEY", 3);
        k.exitKey = _key("EXIT_KEY", 4);
        k.executor = _key("EXECUTOR_KEY", 5);
        k.keeper = _key("KEEPER_KEY", 6);
        k.attacker = _key("ATTACKER_KEY", 7);
    }

    function _key(string memory name, uint32 anvilIndex) internal view returns (uint256) {
        if (block.chainid == ANVIL_CHAIN_ID) return vm.envOr(name, vm.deriveKey(ANVIL_MNEMONIC, anvilIndex));
        return vm.envUint(name);
    }

    function _deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".json");
    }
}
