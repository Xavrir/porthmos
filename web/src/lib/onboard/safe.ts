import {
  encodeFunctionData, encodePacked, getAddress, getContractAddress, hexToBigInt, keccak256, pad, parseAbi, zeroAddress,
  type Address, type Hex,
} from 'viem'

export const SAFE_ABI = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function enableModule(address module)',
  'function isModuleEnabled(address module) view returns (bool)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
])

export const FACTORY_ABI = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'function proxyCreationCode() pure returns (bytes)',
])

export const SALT_TAG = 'aegis-v2'

export function saltNonceFor(owner: Address): bigint {
  return hexToBigInt(keccak256(encodePacked(['address', 'string'], [getAddress(owner), SALT_TAG])))
}

export function safeInitializer(owner: Address, fallbackHandler: Address): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'setup',
    args: [[getAddress(owner)], 1n, zeroAddress, '0x', getAddress(fallbackHandler), zeroAddress, 0n, zeroAddress],
  })
}

// SafeProxyFactory v1.4.1 deployProxy: salt = keccak(keccak(initializer) ++ saltNonce), code = creationCode ++ uint256(singleton).
export function predictSafeAddress(p: { factory: Address; singleton: Address; initializer: Hex; saltNonce: bigint; proxyCreationCode: Hex }): Address {
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(p.initializer), p.saltNonce]))
  const bytecode = encodePacked(['bytes', 'uint256'], [p.proxyCreationCode, hexToBigInt(getAddress(p.singleton))])
  return getAddress(getContractAddress({ opcode: 'CREATE2', from: getAddress(p.factory), salt, bytecodeHash: keccak256(bytecode) }))
}

export function createProxyCall(singleton: Address, initializer: Hex, saltNonce: bigint): Hex {
  return encodeFunctionData({ abi: FACTORY_ABI, functionName: 'createProxyWithNonce', args: [getAddress(singleton), initializer, saltNonce] })
}

// Safe accepts r = owner, s = 0, v = 1 without an ecrecover when msg.sender is that owner ("pre-validated" signature).
export function prevalidatedSignature(owner: Address): Hex {
  return encodePacked(['bytes32', 'bytes32', 'uint8'], [pad(getAddress(owner).toLowerCase() as Hex, { size: 32 }), pad('0x00', { size: 32 }), 1])
}

export function enableModuleCall(safe: Address, module: Address, owner: Address): Hex {
  const inner = encodeFunctionData({ abi: SAFE_ABI, functionName: 'enableModule', args: [getAddress(module)] })
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [getAddress(safe), 0n, inner, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, prevalidatedSignature(owner)],
  })
}
