import { parseAbi } from 'viem'

export const ESCROW_ABI = parseAbi([
  'struct MilestoneTerms { uint256 amount; address issuer; uint8 kind; bool requireDoc; bool checkTemp; int32 minTempCenti; int32 maxTempCenti; uint64 deadline; }',
  'struct Order { address buyer; address supplier; uint64 createdAt; uint8 nextIndex; uint8 status; uint256 total; uint256 released; bytes32 termsHash; }',
  'function createOrder(address supplier, uint256 total, bytes32 termsHash, MilestoneTerms[3] ms) returns (uint256 orderId)',
  'function waive(uint256 orderId, uint8 index)',
  'function refund(uint256 orderId)',
  'function committedOf(address safe) view returns (uint256)',
  'function getOrder(uint256 orderId) view returns (Order)',
  'function getMilestone(uint256 orderId, uint8 index) view returns (MilestoneTerms, uint8)',
  'event OrderCreated(uint256 indexed orderId, address indexed buyer, address indexed supplier, uint256 total, bytes32 termsHash)',
  'event MilestoneReleased(uint256 indexed orderId, uint8 index, address indexed supplier, uint256 amount, bytes32 proofHash, bytes32 authHash, bool waived)',
  'event OrderRefunded(uint256 indexed orderId, address indexed buyer, uint256 amount)',
  'error Unauthorized()', 'error NotRegistered()', 'error Frozen()', 'error BadSupplier()', 'error BadIssuer()', 'error BadMilestone()',
  'error AmountMismatch()', 'error BadDeadline()', 'error OrderNotActive()', 'error OutOfOrder()', 'error ProofMismatch()',
  'error BadSignature()', 'error BadProofTime()', 'error ConditionNotMet()', 'error AuthorizationMismatch()',
  'error PolicyVersionMismatch()', 'error Expired()', 'error NonceUsed()', 'error DeadlineNotPassed()',
])

export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
])

export const MULTISEND_ABI = parseAbi(['function multiSend(bytes transactions) payable'])

export const FREEZE_ABI = parseAbi([
  'function ownerFrozen(address safe) view returns (bool)',
  'function bankFrozen(address safe) view returns (bool)',
  'function reserveFloor(address safe) view returns (uint256)',
])
