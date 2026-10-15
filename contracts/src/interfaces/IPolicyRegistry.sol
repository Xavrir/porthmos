// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPolicyRegistry {
    function owner(address safe) external view returns (address);
    function bank(address safe) external view returns (address);
    function authorizer(address safe) external view returns (address);
    function exitKey(address safe) external view returns (address);
    function autoCap(address safe) external view returns (uint256);
    function dailyCap(address safe) external view returns (uint256);
    function bankLimit(address safe) external view returns (uint256);
    function reserveFloor(address safe) external view returns (uint256);
    function scheduleHash(address safe) external view returns (bytes32);
    function maxBandWidth(address safe) external view returns (uint256);
    function maxOracleAge(address safe) external view returns (uint256);
    function ownerFrozen(address safe) external view returns (bool);
    function bankFrozen(address safe) external view returns (bool);
    function allowedVault(address safe, address vault) external view returns (bool);
    function quarantined(address safe, address vault) external view returns (bool);
    function quarantinedAt(address safe, address vault) external view returns (uint256);
    function policyVersion(address safe) external view returns (uint64);
}
