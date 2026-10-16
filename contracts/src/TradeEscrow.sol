// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";

contract TradeEscrow is EIP712("TradeEscrow", "1"), ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        HANDOVER,
        ARRIVAL,
        QUALITY
    }

    enum OrderStatus {
        NONE,
        ACTIVE,
        COMPLETED,
        REFUNDED
    }

    enum MilestoneStatus {
        PENDING,
        RELEASED,
        WAIVED,
        REFUNDED
    }

    struct MilestoneTerms {
        uint256 amount;
        address issuer;
        uint8 kind;
        bool requireDoc;
        bool checkTemp;
        int32 minTempCenti;
        int32 maxTempCenti;
        uint64 deadline;
    }

    struct Order {
        address buyer;
        address supplier;
        uint64 createdAt;
        uint8 nextIndex;
        uint8 status;
        uint256 total;
        uint256 released;
        bytes32 termsHash;
    }

    struct MilestoneProof {
        uint256 orderId;
        uint8 index;
        uint8 kind;
        bytes32 docHash;
        int32 minTempCenti;
        int32 maxTempCenti;
        uint32 samples;
        uint64 issuedAt;
    }

    struct ReleaseAuthorization {
        uint256 orderId;
        uint8 index;
        uint256 amount;
        bytes32 proofHash;
        uint64 policyVersion;
        uint256 nonce;
        uint64 expiry;
    }

    struct Signatures {
        bool verify;
        bytes32 proofHash;
        bytes32 authDigest;
        bytes issuerSig;
        bytes authSig;
    }

    bytes32 public constant MILESTONE_PROOF_TYPEHASH = keccak256(
        "MilestoneProof(uint256 orderId,uint8 index,uint8 kind,bytes32 docHash,int32 minTempCenti,int32 maxTempCenti,uint32 samples,uint64 issuedAt)"
    );
    bytes32 public constant RELEASE_AUTHORIZATION_TYPEHASH = keccak256(
        "ReleaseAuthorization(uint256 orderId,uint8 index,uint256 amount,bytes32 proofHash,uint64 policyVersion,uint256 nonce,uint64 expiry)"
    );

    uint8 internal constant MILESTONES = 3;
    uint8 internal constant ACTIVE = uint8(OrderStatus.ACTIVE);
    uint8 internal constant COMPLETED = uint8(OrderStatus.COMPLETED);
    uint8 internal constant REFUNDED = uint8(OrderStatus.REFUNDED);

    IPolicyRegistry public immutable registry;
    IERC20 public immutable token;
    uint256 public nextOrderId = 1;
    uint256 public escrowedTotal;
    mapping(uint256 => Order) internal _orders;
    mapping(uint256 => MilestoneTerms[3]) internal _terms;
    mapping(uint256 => MilestoneStatus[3]) internal _mstatus;
    mapping(address => uint256) public committedOf;
    mapping(address => mapping(uint256 => bool)) public usedNonce;

    error Unauthorized();
    error NotRegistered();
    error Frozen();
    error BadSupplier();
    error BadIssuer();
    error BadMilestone();
    error AmountMismatch();
    error BadDeadline();
    error OrderNotActive();
    error OutOfOrder();
    error ProofMismatch();
    error BadSignature();
    error BadProofTime();
    error ConditionNotMet();
    error AuthorizationMismatch();
    error PolicyVersionMismatch();
    error Expired();
    error NonceUsed();
    error DeadlineNotPassed();

    event OrderCreated(
        uint256 indexed orderId, address indexed buyer, address indexed supplier, uint256 total, bytes32 termsHash
    );
    event MilestoneReleased(
        uint256 indexed orderId,
        uint8 index,
        address indexed supplier,
        uint256 amount,
        bytes32 proofHash,
        bytes32 authHash,
        bool waived
    );
    event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount);

    constructor(IPolicyRegistry registry_, IERC20 token_) {
        registry = registry_;
        token = token_;
    }

    function createOrder(address supplier, uint256 total, bytes32 termsHash, MilestoneTerms[3] calldata ms)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        address buyer = msg.sender;
        if (registry.owner(buyer) == address(0)) revert NotRegistered();
        if (_frozen(buyer)) revert Frozen();
        if (supplier == address(0) || supplier == buyer || supplier == address(this) || supplier == address(token)) {
            revert BadSupplier();
        }
        for (uint256 i; i < MILESTONES; ++i) {
            MilestoneTerms calldata m = ms[i];
            if (m.amount == 0 || m.kind != i || (m.checkTemp && m.minTempCenti > m.maxTempCenti)) {
                revert BadMilestone();
            }
        }
        for (uint256 i; i < MILESTONES; ++i) {
            address issuer = ms[i].issuer;
            if (issuer == address(0) || issuer == supplier) revert BadIssuer();
        }
        uint256 a0 = ms[0].amount;
        uint256 a1 = ms[1].amount;
        if (a0 > total || a1 > total - a0 || ms[2].amount != total - a0 - a1) revert AmountMismatch();
        if (block.timestamp >= ms[0].deadline || ms[0].deadline > ms[1].deadline || ms[1].deadline > ms[2].deadline) {
            revert BadDeadline();
        }

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            buyer: buyer,
            supplier: supplier,
            createdAt: uint64(block.timestamp),
            nextIndex: 0,
            status: ACTIVE,
            total: total,
            released: 0,
            termsHash: termsHash
        });
        for (uint256 i; i < MILESTONES; ++i) {
            _terms[orderId][i] = ms[i];
        }
        committedOf[buyer] += total;
        escrowedTotal += total;

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(buyer, address(this), total);
        if (token.balanceOf(address(this)) != balanceBefore + total) revert AmountMismatch();

        emit OrderCreated(orderId, buyer, supplier, total, termsHash);
    }

    function release(
        uint256 orderId,
        uint8 index,
        MilestoneProof calldata proof,
        bytes calldata issuerSig,
        ReleaseAuthorization calldata auth,
        bytes calldata authSig
    ) external nonReentrant {
        bytes32 proofHash = proofStructHash(proof);
        bytes32 authDigest = hashAuthorization(auth);
        bytes4 err =
            _releaseChecks(orderId, index, proof, auth, Signatures(true, proofHash, authDigest, issuerSig, authSig));
        if (err != bytes4(0)) _revertWith(err);

        usedNonce[_orders[orderId].buyer][auth.nonce] = true;
        (address supplier, uint256 amount) = _settleMilestone(orderId, index, MilestoneStatus.RELEASED);
        token.safeTransfer(supplier, amount);

        emit MilestoneReleased(orderId, index, supplier, amount, proofHash, authDigest, false);
    }

    function waive(uint256 orderId, uint8 index) external nonReentrant {
        Order storage order = _orders[orderId];
        if (msg.sender != order.buyer) revert Unauthorized();
        if (order.status != ACTIVE) revert OrderNotActive();
        if (index != order.nextIndex) revert OutOfOrder();
        if (_frozen(order.buyer)) revert Frozen();

        (address supplier, uint256 amount) = _settleMilestone(orderId, index, MilestoneStatus.WAIVED);
        token.safeTransfer(supplier, amount);

        emit MilestoneReleased(orderId, index, supplier, amount, bytes32(0), bytes32(0), true);
    }

    function refund(uint256 orderId) external nonReentrant {
        Order storage order = _orders[orderId];
        address buyer = order.buyer;
        if (msg.sender != buyer) revert Unauthorized();
        if (order.status != ACTIVE) revert OrderNotActive();
        uint8 next = order.nextIndex;
        if (block.timestamp <= _terms[orderId][next].deadline) revert DeadlineNotPassed();

        uint256 amount = order.total - order.released;
        for (uint256 i = next; i < MILESTONES; ++i) {
            _mstatus[orderId][i] = MilestoneStatus.REFUNDED;
        }
        order.status = REFUNDED;
        committedOf[buyer] -= amount;
        escrowedTotal -= amount;
        token.safeTransfer(buyer, amount);

        emit OrderRefunded(orderId, buyer, amount);
    }

    function checkRelease(
        uint256 orderId,
        uint8 index,
        MilestoneProof calldata proof,
        ReleaseAuthorization calldata auth
    ) external view returns (bool ok, bytes4 errorSelector) {
        errorSelector = _releaseChecks(orderId, index, proof, auth, Signatures(false, bytes32(0), bytes32(0), "", ""));
        ok = errorSelector == bytes4(0);
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function getMilestone(uint256 orderId, uint8 index) external view returns (MilestoneTerms memory, MilestoneStatus) {
        return (_terms[orderId][index], _mstatus[orderId][index]);
    }

    function hashProof(MilestoneProof calldata proof) external view returns (bytes32) {
        return _hashTypedDataV4(proofStructHash(proof));
    }

    function proofStructHash(MilestoneProof calldata proof) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MILESTONE_PROOF_TYPEHASH,
                proof.orderId,
                proof.index,
                proof.kind,
                proof.docHash,
                proof.minTempCenti,
                proof.maxTempCenti,
                proof.samples,
                proof.issuedAt
            )
        );
    }

    function hashAuthorization(ReleaseAuthorization calldata auth) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RELEASE_AUTHORIZATION_TYPEHASH,
                    auth.orderId,
                    auth.index,
                    auth.amount,
                    auth.proofHash,
                    auth.policyVersion,
                    auth.nonce,
                    auth.expiry
                )
            )
        );
    }

    function _releaseChecks(
        uint256 orderId,
        uint8 index,
        MilestoneProof calldata proof,
        ReleaseAuthorization calldata auth,
        Signatures memory sigs
    ) internal view returns (bytes4) {
        Order storage order = _orders[orderId];
        if (order.status != ACTIVE) return OrderNotActive.selector;
        if (index != order.nextIndex) return OutOfOrder.selector;
        address buyer = order.buyer;
        if (_frozen(buyer)) return Frozen.selector;

        MilestoneTerms memory m = _terms[orderId][index];
        if (proof.orderId != orderId || proof.index != index || proof.kind != m.kind) return ProofMismatch.selector;
        bytes32 proofHash = sigs.verify ? sigs.proofHash : proofStructHash(proof);
        if (sigs.verify) {
            address issuer = _recover(_hashTypedDataV4(proofHash), sigs.issuerSig);
            if (issuer == address(0) || issuer != m.issuer) return BadSignature.selector;
        }
        if (proof.issuedAt < order.createdAt || proof.issuedAt > block.timestamp) return BadProofTime.selector;
        if (!_conditionsMet(m, proof)) return ConditionNotMet.selector;

        if (sigs.verify) {
            address signer = _recover(sigs.authDigest, sigs.authSig);
            if (signer == address(0) || signer != registry.authorizer(buyer) || signer == registry.exitKey(buyer)) {
                return BadSignature.selector;
            }
        }
        if (auth.orderId != orderId || auth.index != index || auth.amount != m.amount || auth.proofHash != proofHash) {
            return AuthorizationMismatch.selector;
        }
        if (auth.policyVersion != registry.policyVersion(buyer)) return PolicyVersionMismatch.selector;
        if (block.timestamp > auth.expiry) return Expired.selector;
        if (usedNonce[buyer][auth.nonce]) return NonceUsed.selector;
        return bytes4(0);
    }

    function _conditionsMet(MilestoneTerms memory m, MilestoneProof calldata proof) internal pure returns (bool) {
        if (m.requireDoc && proof.docHash == bytes32(0)) return false;
        if (m.checkTemp) {
            if (
                proof.samples == 0 || proof.minTempCenti > proof.maxTempCenti || proof.minTempCenti < m.minTempCenti
                    || proof.maxTempCenti > m.maxTempCenti
            ) return false;
        }
        return true;
    }

    function _settleMilestone(uint256 orderId, uint8 index, MilestoneStatus paidAs)
        internal
        returns (address supplier, uint256 amount)
    {
        Order storage order = _orders[orderId];
        amount = _terms[orderId][index].amount;
        supplier = order.supplier;
        _mstatus[orderId][index] = paidAs;
        uint8 next = index + 1;
        order.nextIndex = next;
        order.released += amount;
        committedOf[order.buyer] -= amount;
        escrowedTotal -= amount;
        if (next == MILESTONES) order.status = COMPLETED;
    }

    function _frozen(address safe) internal view returns (bool) {
        return registry.ownerFrozen(safe) || registry.bankFrozen(safe);
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError ? signer : address(0);
    }

    function _revertWith(bytes4 selector) internal pure {
        assembly ("memory-safe") {
            mstore(0x00, selector)
            revert(0x00, 0x04)
        }
    }
}
