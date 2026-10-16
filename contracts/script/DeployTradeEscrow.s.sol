// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MultiSendCallOnly} from "@safe-global/safe-smart-account/libraries/MultiSendCallOnly.sol";

import {AegisScriptBase} from "./utils/AegisScriptBase.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";

/// Deploys TradeEscrow against the registry and MockUSDC in deployments/<chainId>.json and writes the TradeFlow keys
/// to deployments/<chainId>.tradeflow.json. service/scripts/merge_deployment.py then adds them to the main file.
contract DeployTradeEscrow is AegisScriptBase {
    address internal constant CANONICAL_MULTI_SEND_CALL_ONLY = 0x9641d764fc13c8B624c04430C7356C1C7C8102e2;
    uint32 internal constant CARRIER_INDEX = 8;
    uint32 internal constant SENSOR_INDEX = 9;
    uint32 internal constant SURVEYOR_INDEX = 10;

    struct Issuers {
        address carrier;
        address sensor;
        address surveyor;
    }

    function run() external {
        string memory deployment = vm.readFile(_deploymentPath());
        address registry = vm.parseJsonAddress(deployment, ".registry");
        address usdc = vm.parseJsonAddress(deployment, ".usdc");
        require(registry.code.length > 0 && usdc.code.length > 0, "registry or usdc has no code; run Deploy.s.sol");
        Issuers memory issuers = _issuers();
        // The script body runs before broadcast, so this is the last mined block: a lower bound for log scans.
        uint256 startBlock = block.number;

        vm.startBroadcast(_key("DEPLOYER_KEY", 0));
        TradeEscrow escrow = new TradeEscrow(IPolicyRegistry(registry), IERC20(usdc));
        address multiSend = _multiSendCallOnly();
        vm.stopBroadcast();

        require(address(escrow.registry()) == registry && address(escrow.token()) == usdc, "escrow wiring");
        _writeTradeflow(address(escrow), multiSend, startBlock, issuers, registry, usdc);
    }

    function _multiSendCallOnly() internal returns (address) {
        if (block.chainid == ANVIL_CHAIN_ID) return address(new MultiSendCallOnly());
        require(CANONICAL_MULTI_SEND_CALL_ONLY.code.length > 0, "canonical MultiSendCallOnly v1.4.1 missing");
        return CANONICAL_MULTI_SEND_CALL_ONLY;
    }

    /// Addresses only: on 31337 from the public Anvil mnemonic, elsewhere from the environment.
    function _issuers() internal view returns (Issuers memory i) {
        if (block.chainid == ANVIL_CHAIN_ID) {
            i.carrier = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, CARRIER_INDEX));
            i.sensor = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, SENSOR_INDEX));
            i.surveyor = vm.addr(vm.deriveKey(ANVIL_MNEMONIC, SURVEYOR_INDEX));
        } else {
            i.carrier = vm.envAddress("ISSUER_CARRIER_ADDRESS");
            i.sensor = vm.envAddress("ISSUER_SENSOR_ADDRESS");
            i.surveyor = vm.envAddress("ISSUER_SURVEYOR_ADDRESS");
        }
        require(i.carrier != address(0) && i.sensor != address(0) && i.surveyor != address(0), "issuer missing");
    }

    function _writeTradeflow(
        address escrow,
        address multiSend,
        uint256 startBlock,
        Issuers memory issuers,
        address registry,
        address usdc
    ) internal {
        string memory issuerJson = string.concat(
            '{"carrier": "',
            vm.toString(issuers.carrier),
            '", "sensor": "',
            vm.toString(issuers.sensor),
            '", "surveyor": "',
            vm.toString(issuers.surveyor),
            '"}'
        );
        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(block.chainid),
            ",\n",
            '  "deployedAgainst": {"registry": "',
            vm.toString(registry),
            '", "usdc": "',
            vm.toString(usdc),
            '"},\n'
        );
        json = string.concat(
            json,
            '  "tradeEscrow": "',
            vm.toString(escrow),
            '",\n  "multiSendCallOnly": "',
            vm.toString(multiSend),
            '",\n  "tradeEscrowBlock": ',
            vm.toString(startBlock),
            ',\n  "issuers": ',
            issuerJson,
            "\n}\n"
        );
        string memory path =
            string.concat(vm.projectRoot(), "/../deployments/", vm.toString(block.chainid), ".tradeflow.json");
        vm.writeFile(path, json);
        console2.log("Wrote", path);
    }
}
