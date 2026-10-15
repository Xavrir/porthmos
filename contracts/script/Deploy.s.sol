// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Safe} from "@safe-global/safe-smart-account/Safe.sol";
import {SafeL2} from "@safe-global/safe-smart-account/SafeL2.sol";
import {SafeProxyFactory} from "@safe-global/safe-smart-account/proxies/SafeProxyFactory.sol";
import {CompatibilityFallbackHandler} from "@safe-global/safe-smart-account/handler/CompatibilityFallbackHandler.sol";
import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";

import {AegisScriptBase} from "./utils/AegisScriptBase.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";
import {MockVault} from "../src/MockVault.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {AegisModule} from "../src/AegisModule.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";

contract Deploy is AegisScriptBase {
    address internal constant CANONICAL_SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address internal constant CANONICAL_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address internal constant CANONICAL_FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;

    struct Deployed {
        MockUSDC usdc;
        MockPriceFeed feed;
        MockVault vaultA;
        MockVault vaultB;
        PolicyRegistry registry;
        AegisModule module;
        address safe;
        address singleton;
        address factory;
        address fallbackHandler;
    }

    function run() external {
        Keys memory k = _keys();
        Deployed memory d = _deployContracts(k);
        _configureAsOwner(d, k);

        vm.startBroadcast(k.bank);
        d.registry.setBankLimit(d.safe, BANK_LIMIT);
        vm.stopBroadcast();

        require(Safe(payable(d.safe)).isModuleEnabled(address(d.module)), "module not enabled");
        _writeDeployment(d, k);
    }

    function _deployContracts(Keys memory k) internal returns (Deployed memory d) {
        address deployer = vm.addr(k.deployer);
        vm.startBroadcast(k.deployer);
        d.usdc = new MockUSDC(deployer);
        d.feed = new MockPriceFeed(deployer, INITIAL_PRICE);
        d.feed.setKeeper(vm.addr(k.keeper));
        d.vaultA = new MockVault(IERC20(address(d.usdc)), "Aegis Vault A", "avA", deployer);
        d.vaultB = new MockVault(IERC20(address(d.usdc)), "Aegis Vault B", "avB", deployer);
        d.usdc.setMinter(address(d.vaultA), true);
        d.usdc.setMinter(address(d.vaultB), true);
        d.registry = new PolicyRegistry();
        d.module = new AegisModule(d.registry, IERC20(address(d.usdc)), AggregatorV3Interface(address(d.feed)));

        (d.singleton, d.factory, d.fallbackHandler) = _safeInfrastructure();
        d.safe = _createSafe(d, vm.addr(k.owner));

        d.usdc.mint(deployer, 2 * VAULT_SEED);
        d.usdc.approve(address(d.vaultA), VAULT_SEED);
        d.vaultA.deposit(VAULT_SEED, deployer);
        d.usdc.approve(address(d.vaultB), VAULT_SEED);
        d.vaultB.deposit(VAULT_SEED, deployer);
        d.usdc.mint(d.safe, SAFE_FUNDING);
        vm.stopBroadcast();
    }

    function _configureAsOwner(Deployed memory d, Keys memory k) internal {
        address owner = vm.addr(k.owner);
        vm.startBroadcast(k.owner);
        _enableModule(d.safe, address(d.module), owner);
        d.registry.register(d.safe, owner, vm.addr(k.bank));
        d.registry.addVault(d.safe, address(d.vaultA));
        d.registry.addVault(d.safe, address(d.vaultB));
        d.registry.setAuthorizer(d.safe, vm.addr(k.authorizer));
        d.registry.setExitKey(d.safe, vm.addr(k.exitKey));
        d.registry.setAutoCap(d.safe, AUTO_CAP);
        d.registry.setDailyCap(d.safe, DAILY_CAP);
        d.registry.setMaxBandWidth(d.safe, MAX_BAND_WIDTH);
        d.registry.setMaxOracleAge(d.safe, MAX_ORACLE_AGE);
        d.registry.setReserveFloor(d.safe, RESERVE_FLOOR, bytes32(0));
        vm.stopBroadcast();
    }

    function _enableModule(address safe, address module, address owner) internal {
        bytes memory prevalidated = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        Safe(payable(safe))
            .execTransaction(
                safe,
                0,
                abi.encodeCall(Safe(payable(safe)).enableModule, (module)),
                Enum.Operation.Call,
                0,
                0,
                0,
                address(0),
                payable(address(0)),
                prevalidated
            );
    }

    function _safeInfrastructure() internal returns (address singleton, address factory, address handler) {
        if (
            CANONICAL_SAFE_L2.code.length > 0 && CANONICAL_PROXY_FACTORY.code.length > 0
                && CANONICAL_FALLBACK_HANDLER.code.length > 0
        ) {
            console2.log("Using canonical Safe v1.4.1 deployment");
            return (CANONICAL_SAFE_L2, CANONICAL_PROXY_FACTORY, CANONICAL_FALLBACK_HANDLER);
        }
        require(block.chainid == ANVIL_CHAIN_ID, "canonical Safe v1.4.1 contracts missing on this chain");
        console2.log("Canonical Safe not found on 31337; deploying SafeL2, SafeProxyFactory, fallback handler");
        singleton = address(new SafeL2());
        factory = address(new SafeProxyFactory());
        handler = address(new CompatibilityFallbackHandler());
    }

    function _createSafe(Deployed memory d, address owner) internal returns (address) {
        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory initializer = abi.encodeCall(
            Safe.setup, (owners, 1, address(0), "", d.fallbackHandler, address(0), 0, payable(address(0)))
        );
        uint256 saltNonce = vm.envOr("SAFE_SALT", uint256(0));
        return address(SafeProxyFactory(d.factory).createProxyWithNonce(d.singleton, initializer, saltNonce));
    }

    function _writeDeployment(Deployed memory d, Keys memory k) internal {
        string memory roles = string.concat(
            _field("owner", vm.toString(vm.addr(k.owner)), true, false),
            _field("bank", vm.toString(vm.addr(k.bank)), true, false),
            _field("authorizer", vm.toString(vm.addr(k.authorizer)), true, false),
            _field("exitKey", vm.toString(vm.addr(k.exitKey)), true, false),
            _field("executor", vm.toString(vm.addr(k.executor)), true, false),
            _field("keeper", vm.toString(vm.addr(k.keeper)), true, true)
        );
        string memory params = string.concat(
            _field("autoCap", vm.toString(AUTO_CAP), true, false),
            _field("dailyCap", vm.toString(DAILY_CAP), true, false),
            _field("bankLimit", vm.toString(BANK_LIMIT), true, true),
            ",\n              ",
            _field("reserveFloor", vm.toString(RESERVE_FLOOR), true, false),
            _field("maxBandWidth", vm.toString(MAX_BAND_WIDTH), true, false),
            _field("maxOracleAge", vm.toString(MAX_ORACLE_AGE), false, true)
        );
        string memory json = string.concat("{\n", '  "chainId": ', vm.toString(block.chainid), ",\n");
        json = string.concat(
            json,
            _pair("usdc", address(d.usdc), true, false),
            _pair("priceFeed", address(d.feed), false, false),
            _pair("vaultA", address(d.vaultA), false, false),
            _pair("vaultB", address(d.vaultB), false, true)
        );
        json = string.concat(
            json,
            _pair("registry", address(d.registry), true, false),
            _pair("module", address(d.module), false, false),
            _pair("safe", d.safe, false, true)
        );
        json = string.concat(
            json, _pair("safeSingleton", d.singleton, true, false), _pair("safeProxyFactory", d.factory, false, true)
        );
        json = string.concat(
            json,
            '  "roles": { ',
            roles,
            " },\n",
            '  "params": { ',
            params,
            " },\n",
            '  "abis": "contracts/out (forge artifacts)"\n}\n'
        );
        string memory path = _deploymentPath();
        vm.writeFile(path, json);
        console2.log("Wrote", path);
    }

    function _field(string memory key, string memory value, bool quoted, bool last)
        internal
        pure
        returns (string memory)
    {
        string memory q = quoted ? '"' : "";
        return string.concat('"', key, '": ', q, value, q, last ? "" : ", ");
    }

    function _pair(string memory key, address value, bool lineStart, bool lineEnd)
        internal
        pure
        returns (string memory)
    {
        return string.concat(lineStart ? '  "' : '"', key, '": "', vm.toString(value), lineEnd ? '",\n' : '", ');
    }
}
