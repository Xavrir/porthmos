// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Enum} from "@safe-global/safe-smart-account/common/Enum.sol";
import {ISafe} from "./interfaces/ISafe.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";

contract AegisModule is EIP712, ReentrancyGuard {
    enum Op {
        DEPOSIT,
        REDEEM
    }

    enum Tier {
        T0,
        T1,
        T2,
        T3,
        T4
    }

    struct Approval {
        address safe;
        uint8 op;
        address vault;
        uint256 maxAmount;
        uint64 policyVersion;
        uint64 approvalExpiry;
        uint256 approvalNonce;
    }

    struct DAR {
        address safe;
        uint8 op;
        address vault;
        uint256 amount;
        uint256 minOut;
        uint64 policyVersion;
        int256 priceLow;
        int256 priceHigh;
        uint8 tier;
        bytes32 approvalHash;
        uint256 nonce;
        uint64 expiry;
        bytes32 evidenceHash;
    }

    struct Signatures {
        bool verify;
        bytes32 darHash;
        bytes authSig;
        bytes ownerSig;
        bytes bankSig;
    }

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "Approval(address safe,uint8 op,address vault,uint256 maxAmount,uint64 policyVersion,uint64 approvalExpiry,uint256 approvalNonce)"
    );
    bytes32 public constant DAR_TYPEHASH = keccak256(
        "DAR(address safe,uint8 op,address vault,uint256 amount,uint256 minOut,uint64 policyVersion,int256 priceLow,int256 priceHigh,uint8 tier,bytes32 approvalHash,uint256 nonce,uint64 expiry,bytes32 evidenceHash)"
    );

    uint8 internal constant OP_DEPOSIT = uint8(Op.DEPOSIT);
    uint8 internal constant OP_REDEEM = uint8(Op.REDEEM);
    uint8 internal constant T1 = uint8(Tier.T1);
    uint8 internal constant T2 = uint8(Tier.T2);
    uint8 internal constant T3 = uint8(Tier.T3);
    uint8 internal constant T4 = uint8(Tier.T4);

    IPolicyRegistry public immutable registry;
    IERC20 public immutable usdc;
    AggregatorV3Interface public immutable priceFeed;

    mapping(address safe => mapping(address vault => bool)) public everDeposited;
    mapping(address safe => mapping(uint256 nonce => bool)) public usedNonce;
    mapping(address safe => uint256 day) internal _depositDay;
    mapping(address safe => uint256 amount) internal _depositDayTotal;

    error Unauthorized();
    error BadSignature();
    error WrongOp();
    error Expired();
    error NonceUsed();
    error Frozen();
    error VaultQuarantined();
    error PolicyVersionMismatch();
    error VaultNotAllowed();
    error MissingApproval();
    error ApprovalMismatch();
    error ApprovalExceeded();
    error ApprovalExpired();
    error StaleOracle();
    error PriceOutOfBand();
    error BandTooWide();
    error ReserveFloorBreached();
    error DailyCapExceeded();
    error NoPosition();
    error SlippageExceeded();
    error ExecutionFailed();

    event AegisExecuted(
        address indexed safe,
        bytes32 indexed darHash,
        uint8 op,
        address indexed vault,
        uint256 assets,
        uint256 shares,
        uint8 tier,
        bytes32 evidenceHash
    );

    constructor(IPolicyRegistry registry_, IERC20 usdc_, AggregatorV3Interface priceFeed_) EIP712("AegisModule", "1") {
        registry = registry_;
        usdc = usdc_;
        priceFeed = priceFeed_;
    }

    function deposit(
        DAR calldata dar,
        bytes calldata authSig,
        bytes calldata ownerApprovalSig,
        bytes calldata bankApprovalSig,
        Approval calldata approval
    ) external nonReentrant {
        bytes32 darHash = hashDAR(dar);
        (bytes4 err, uint8 tier) =
            _depositChecks(dar, approval, Signatures(true, darHash, authSig, ownerApprovalSig, bankApprovalSig));
        if (err != bytes4(0)) _revertWith(err);

        if (tier >= T3) usedNonce[dar.safe][approval.approvalNonce] = true;
        _settleDeposit(dar, darHash, tier);
    }

    function redeem(DAR calldata dar, bytes calldata sig) external nonReentrant {
        bytes32 darHash = hashDAR(dar);
        bytes4 err = _redeemChecks(dar, _recover(darHash, sig), true);
        if (err != bytes4(0)) _revertWith(err);

        usedNonce[dar.safe][dar.nonce] = true;

        (uint256 assets, uint256 shares) = _executeRedeem(dar.safe, dar.vault, dar.amount);
        if (assets < dar.minOut) revert SlippageExceeded();

        emit AegisExecuted(dar.safe, darHash, OP_REDEEM, dar.vault, assets, shares, T1, dar.evidenceHash);
    }

    function check(DAR calldata dar, Approval calldata approval)
        external
        view
        returns (bool ok, bytes4 errorSelector, uint8 tier)
    {
        if (dar.op == OP_DEPOSIT) {
            (errorSelector, tier) = _depositChecks(dar, approval, Signatures(false, bytes32(0), "", "", ""));
        } else if (dar.op == OP_REDEEM) {
            errorSelector = _redeemChecks(dar, address(0), false);
            tier = T1;
        } else {
            errorSelector = WrongOp.selector;
        }
        ok = errorSelector == bytes4(0);
    }

    function requiredTier(address safe, address vault, uint256 amount) public view returns (uint8) {
        uint256 limit = registry.bankLimit(safe);
        if (limit != 0 && amount > limit) return T4;
        if (amount > registry.autoCap(safe) || !everDeposited[safe][vault]) return T3;
        return T2;
    }

    function hashDAR(DAR calldata dar) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            bytes.concat(
                abi.encode(
                    DAR_TYPEHASH, dar.safe, dar.op, dar.vault, dar.amount, dar.minOut, dar.policyVersion, dar.priceLow
                ),
                abi.encode(dar.priceHigh, dar.tier, dar.approvalHash, dar.nonce, dar.expiry, dar.evidenceHash)
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function hashApproval(Approval calldata approval) public view returns (bytes32) {
        return _hashTypedDataV4(approvalStructHash(approval));
    }

    function approvalStructHash(Approval calldata approval) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                APPROVAL_TYPEHASH,
                approval.safe,
                approval.op,
                approval.vault,
                approval.maxAmount,
                approval.policyVersion,
                approval.approvalExpiry,
                approval.approvalNonce
            )
        );
    }

    function depositedToday(address safe) public view returns (uint256) {
        return _depositDay[safe] == block.timestamp / 1 days ? _depositDayTotal[safe] : 0;
    }

    function _depositChecks(DAR calldata dar, Approval calldata approval, Signatures memory sigs)
        internal
        view
        returns (bytes4, uint8 tier)
    {
        address safe = dar.safe;
        uint8 minTier = requiredTier(safe, dar.vault, dar.amount);
        tier = dar.tier > minTier ? dar.tier : minTier;

        if (dar.op != OP_DEPOSIT) return (WrongOp.selector, tier);
        if (registry.ownerFrozen(safe) || registry.bankFrozen(safe)) return (Frozen.selector, tier);
        if (registry.quarantined(safe, dar.vault)) return (VaultQuarantined.selector, tier);
        uint64 version = registry.policyVersion(safe);
        if (dar.policyVersion != version) return (PolicyVersionMismatch.selector, tier);
        if (!registry.allowedVault(safe, dar.vault)) return (VaultNotAllowed.selector, tier);

        if (sigs.verify) {
            address signer = _recover(sigs.darHash, sigs.authSig);
            if (signer == address(0) || signer != registry.authorizer(safe) || signer == registry.exitKey(safe)) {
                return (BadSignature.selector, tier);
            }
        }

        if (tier >= T3) {
            bytes4 approvalErr = _approvalChecks(dar, approval, sigs, tier, version);
            if (approvalErr != bytes4(0)) return (approvalErr, tier);
        }

        return (_executionChecks(dar, approval, tier), tier);
    }

    function _approvalChecks(
        DAR calldata dar,
        Approval calldata approval,
        Signatures memory sigs,
        uint8 tier,
        uint64 version
    ) internal view returns (bytes4) {
        if (dar.approvalHash == bytes32(0)) return MissingApproval.selector;
        bytes32 structHash = approvalStructHash(approval);

        if (sigs.verify) {
            if (sigs.ownerSig.length == 0 || (tier >= T4 && sigs.bankSig.length == 0)) {
                return MissingApproval.selector;
            }
            bytes32 digest = _hashTypedDataV4(structHash);
            address ownerSigner = _recover(digest, sigs.ownerSig);
            if (ownerSigner == address(0) || ownerSigner != registry.owner(dar.safe)) return BadSignature.selector;
            if (tier >= T4) {
                address bankSigner = _recover(digest, sigs.bankSig);
                if (bankSigner == address(0) || bankSigner != registry.bank(dar.safe)) return BadSignature.selector;
            }
        }

        if (structHash != dar.approvalHash) return ApprovalMismatch.selector;
        if (approval.safe != dar.safe || approval.op != dar.op || approval.vault != dar.vault) {
            return ApprovalMismatch.selector;
        }
        if (dar.amount > approval.maxAmount) return ApprovalExceeded.selector;
        if (approval.policyVersion != version) return PolicyVersionMismatch.selector;
        if (block.timestamp > approval.approvalExpiry) return ApprovalExpired.selector;
        if (usedNonce[dar.safe][approval.approvalNonce]) return NonceUsed.selector;
        return bytes4(0);
    }

    function _executionChecks(DAR calldata dar, Approval calldata approval, uint8 tier) internal view returns (bytes4) {
        address safe = dar.safe;
        if (block.timestamp > dar.expiry) return Expired.selector;
        // Approval and DAR nonces share one used-set, and deposit() marks the approval nonce first.
        if (usedNonce[safe][dar.nonce] || (tier >= T3 && dar.nonce == approval.approvalNonce)) {
            return NonceUsed.selector;
        }

        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > registry.maxOracleAge(safe))
        {
            return StaleOracle.selector;
        }
        if (answer <= 0 || answer < dar.priceLow || answer > dar.priceHigh) return PriceOutOfBand.selector;
        uint256 bandWidth;
        // priceLow <= priceHigh holds here, so the two's-complement difference is the exact non-negative width.
        unchecked {
            bandWidth = uint256(dar.priceHigh) - uint256(dar.priceLow);
        }
        if (bandWidth > registry.maxBandWidth(safe)) return BandTooWide.selector;

        uint256 balance = usdc.balanceOf(safe);
        if (balance < dar.amount || balance - dar.amount < registry.reserveFloor(safe)) {
            return ReserveFloorBreached.selector;
        }
        if (depositedToday(safe) + dar.amount > registry.dailyCap(safe)) return DailyCapExceeded.selector;
        return bytes4(0);
    }

    function _redeemChecks(DAR calldata dar, address signer, bool verify) internal view returns (bytes4) {
        address safe = dar.safe;
        if (verify) {
            if (signer == address(0) || (signer != registry.authorizer(safe) && signer != registry.exitKey(safe))) {
                return BadSignature.selector;
            }
        }
        if (dar.op != OP_REDEEM) return WrongOp.selector;
        if (block.timestamp > dar.expiry) return Expired.selector;
        if (usedNonce[safe][dar.nonce]) return NonceUsed.selector;
        // Redeem skips the allowlist so delisted vaults stay exitable; this keeps the Safe from calling
        // redeem() on a contract it never deposited into.
        if (!everDeposited[safe][dar.vault]) return NoPosition.selector;
        (bool ok, uint256 shares) = _shareBalance(dar.vault, safe);
        if (!ok || dar.amount == 0 || shares < dar.amount) return NoPosition.selector;
        return bytes4(0);
    }

    function _settleDeposit(DAR calldata dar, bytes32 darHash, uint8 tier) internal {
        address safe = dar.safe;
        usedNonce[safe][dar.nonce] = true;

        (uint256 assets, uint256 shares) = _executeDeposit(safe, dar.vault, dar.amount);
        if (shares < dar.minOut) revert SlippageExceeded();

        everDeposited[safe][dar.vault] = true;
        _addDepositedToday(safe, dar.amount);
        emit AegisExecuted(safe, darHash, OP_DEPOSIT, dar.vault, assets, shares, tier, dar.evidenceHash);
    }

    function _executeDeposit(address safe, address vault, uint256 amount)
        internal
        returns (uint256 assets, uint256 shares)
    {
        uint256 usdcBefore = usdc.balanceOf(safe);
        uint256 sharesBefore = _shareBalanceOrFail(vault, safe);
        _approve(safe, vault, amount);
        _exec(safe, vault, abi.encodeCall(IERC4626.deposit, (amount, safe)));
        _approve(safe, vault, 0);
        assets = _subOrZero(usdcBefore, usdc.balanceOf(safe));
        shares = _subOrZero(_shareBalanceOrFail(vault, safe), sharesBefore);
    }

    function _executeRedeem(address safe, address vault, uint256 sharesIn)
        internal
        returns (uint256 assets, uint256 shares)
    {
        uint256 usdcBefore = usdc.balanceOf(safe);
        uint256 sharesBefore = _shareBalanceOrFail(vault, safe);
        _exec(safe, vault, abi.encodeCall(IERC4626.redeem, (sharesIn, safe, safe)));
        assets = _subOrZero(usdc.balanceOf(safe), usdcBefore);
        shares = _subOrZero(sharesBefore, _shareBalanceOrFail(vault, safe));
    }

    function _approve(address safe, address spender, uint256 amount) internal {
        bytes memory ret = _exec(safe, address(usdc), abi.encodeCall(IERC20.approve, (spender, amount)));
        if (ret.length != 0 && (ret.length < 32 || !abi.decode(ret, (bool)))) revert ExecutionFailed();
    }

    function _exec(address safe, address to, bytes memory data) internal returns (bytes memory) {
        try ISafe(safe).execTransactionFromModuleReturnData(to, 0, data, Enum.Operation.Call) returns (
            bool success, bytes memory returnData
        ) {
            if (!success) revert ExecutionFailed();
            return returnData;
        } catch {
            revert ExecutionFailed();
        }
    }

    function _shareBalance(address vault, address account) internal view returns (bool, uint256) {
        (bool ok, bytes memory ret) = vault.staticcall(abi.encodeCall(IERC20.balanceOf, (account)));
        if (!ok || ret.length < 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    function _shareBalanceOrFail(address vault, address account) internal view returns (uint256) {
        (bool ok, uint256 shares) = _shareBalance(vault, account);
        if (!ok) revert ExecutionFailed();
        return shares;
    }

    function _addDepositedToday(address safe, uint256 amount) internal {
        uint256 today = block.timestamp / 1 days;
        if (_depositDay[safe] != today) {
            _depositDay[safe] = today;
            _depositDayTotal[safe] = amount;
        } else {
            _depositDayTotal[safe] += amount;
        }
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError ? signer : address(0);
    }

    function _subOrZero(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : 0;
    }

    function _revertWith(bytes4 selector) internal pure {
        assembly ("memory-safe") {
            mstore(0x00, selector)
            revert(0x00, 0x04)
        }
    }
}
