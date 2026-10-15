// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {ISafe} from "./interfaces/ISafe.sol";

contract PolicyRegistry is IPolicyRegistry {
    uint256 public constant QUARANTINE_COOLDOWN = 24 hours;

    mapping(address => address) public owner;
    mapping(address => address) public bank;
    mapping(address => address) public authorizer;
    mapping(address => address) public exitKey;

    mapping(address => uint256) public autoCap;
    mapping(address => uint256) public dailyCap;
    mapping(address => uint256) public bankLimit;
    mapping(address => uint256) public reserveFloor;
    mapping(address => bytes32) public scheduleHash;
    mapping(address => uint256) public maxBandWidth;
    mapping(address => uint256) public maxOracleAge;

    mapping(address => bool) public ownerFrozen;
    mapping(address => bool) public bankFrozen;

    mapping(address => mapping(address => bool)) public allowedVault;
    mapping(address => mapping(address => bool)) public quarantined;
    mapping(address => mapping(address => uint256)) public quarantinedAt;

    mapping(address => uint64) public policyVersion;

    error Unauthorized();

    event PolicyChanged(address indexed safe, uint64 version, bytes4 selector);
    event Quarantined(address indexed safe, address indexed vault, address by);

    modifier onlyOwner(address safe) {
        if (msg.sender != owner[safe]) revert Unauthorized();
        _;
        _bump(safe);
    }

    modifier onlyBank(address safe) {
        if (msg.sender != bank[safe]) revert Unauthorized();
        _;
        _bump(safe);
    }

    modifier onlyOwnerOrBank(address safe) {
        if (msg.sender != owner[safe] && msg.sender != bank[safe]) revert Unauthorized();
        _;
        _bump(safe);
    }

    /// @dev Callable by `owner_` only when the Safe has threshold 1; otherwise the Safe itself must call it.
    /// A single co-owner of a multi-owner Safe must not be able to take the registry owner role, which controls
    /// the vault allowlist and the authorizer.
    function register(address safe, address owner_, address bank_) external {
        if (owner[safe] != address(0) || owner_ == address(0)) revert Unauthorized();
        if (!ISafe(safe).isOwner(owner_)) revert Unauthorized();
        bool selfCall = msg.sender == safe;
        bool soleSigner = msg.sender == owner_ && ISafe(safe).getThreshold() == 1;
        if (!selfCall && !soleSigner) revert Unauthorized();
        owner[safe] = owner_;
        bank[safe] = bank_;
        _bump(safe);
    }

    function addVault(address safe, address vault) external onlyOwner(safe) {
        allowedVault[safe][vault] = true;
    }

    function removeVault(address safe, address vault) external onlyOwnerOrBank(safe) {
        allowedVault[safe][vault] = false;
    }

    function setAutoCap(address safe, uint256 v) external {
        _setTightenable(safe, autoCap, v);
    }

    function setDailyCap(address safe, uint256 v) external {
        _setTightenable(safe, dailyCap, v);
    }

    function setMaxBandWidth(address safe, uint256 v) external {
        _setTightenable(safe, maxBandWidth, v);
    }

    function setMaxOracleAge(address safe, uint256 v) external {
        _setTightenable(safe, maxOracleAge, v);
    }

    function setBankLimit(address safe, uint256 v) external onlyBank(safe) {
        bankLimit[safe] = v;
    }

    function setReserveFloor(address safe, uint256 floor, bytes32 scheduleHash_) external onlyOwner(safe) {
        reserveFloor[safe] = floor;
        scheduleHash[safe] = scheduleHash_;
    }

    function setAuthorizer(address safe, address a) external onlyOwner(safe) {
        authorizer[safe] = a;
    }

    function setExitKey(address safe, address k) external onlyOwner(safe) {
        exitKey[safe] = k;
    }

    function revokeAuthorizer(address safe) external onlyOwnerOrBank(safe) {
        authorizer[safe] = address(0);
        if (msg.sender == bank[safe]) bankFrozen[safe] = true;
    }

    function ownerFreeze(address safe) external onlyOwner(safe) {
        ownerFrozen[safe] = true;
    }

    function ownerUnfreeze(address safe) external onlyOwner(safe) {
        ownerFrozen[safe] = false;
    }

    function bankFreeze(address safe) external onlyBank(safe) {
        bankFrozen[safe] = true;
    }

    function bankUnfreeze(address safe) external onlyBank(safe) {
        bankFrozen[safe] = false;
    }

    function quarantine(address safe, address vault) external {
        if (msg.sender != owner[safe] && msg.sender != bank[safe] && msg.sender != exitKey[safe]) {
            revert Unauthorized();
        }
        quarantined[safe][vault] = true;
        quarantinedAt[safe][vault] = block.timestamp;
        emit Quarantined(safe, vault, msg.sender);
        _bump(safe);
    }

    function clearQuarantine(address safe, address vault) external onlyOwner(safe) {
        if (block.timestamp < quarantinedAt[safe][vault] + QUARANTINE_COOLDOWN) revert Unauthorized();
        quarantined[safe][vault] = false;
    }

    function _setTightenable(address safe, mapping(address => uint256) storage slot, uint256 v) internal {
        address sender = msg.sender;
        if (sender == owner[safe]) {
            slot[safe] = v;
        } else if (sender == bank[safe] && v < slot[safe]) {
            slot[safe] = v;
        } else {
            revert Unauthorized();
        }
        _bump(safe);
    }

    function _bump(address safe) internal {
        uint64 version = policyVersion[safe] + 1;
        policyVersion[safe] = version;
        emit PolicyChanged(safe, version, msg.sig);
    }
}
