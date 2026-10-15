// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";

interface ISafe {
    function execTransactionFromModuleReturnData(address to, uint256 value, bytes memory data, Enum.Operation operation)
        external
        returns (bool success, bytes memory returnData);

    function isOwner(address owner) external view returns (bool);

    function getThreshold() external view returns (uint256);
}
