import { describe, expect, it } from 'vitest'
import { encodePacked, getContractAddress, hexToBigInt, keccak256, toHex, type Hex } from 'viem'
import { enableModuleCall, predictSafeAddress, prevalidatedSignature, safeInitializer, saltNonceFor } from './safe'

// Recorded on a local Anvil: SafeProxyFactory v1.4.1 built from contracts/, createProxyWithNonce mined at this address.
const VECTOR = {
  factory: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
  singleton: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
  fallbackHandler: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
  owner: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  saltNonce: 3054326808677938962659880465231054386575593543584515807846311605175586544249n,
  safe: '0xE3BB581d18aaF6cB2fE9BfCa612861a31eEdCe79',
} as const

const PROXY_CREATION_CODE = [
  '0x6080604052348015600e575f5ffd5b50604051610163380380610163833981016040819052602b9160b2565b6001600160a01b038116608f576040',
  '5162461bcd60e51b815260206004820152602260248201527f496e76616c69642073696e676c65746f6e20616464726573732070726f766964604482',
  '015261195960f21b606482015260840160405180910390fd5b5f80546001600160a01b0319166001600160a01b039290921691909117905560dd565b',
  '5f6020828403121560c1575f5ffd5b81516001600160a01b038116811460d6575f5ffd5b9392505050565b607a806100e95f395ff3fe60806040525f',
  '80546001600160a01b03169035632cf35bc960e11b01602657805f5260205ff35b365f5f375f5f365f845af490503d5f5f3e80603f573d5ffd5b503d',
  '5ff3fea264697066735822122097edf9844a9ad1c5d855a758c90c474eb6bc377d9ed40b5357c59fc1fbc5013164736f6c634300081c0033',
].join('') as Hex

describe('saltNonce', () => {
  it('is uint256(keccak256(abi.encodePacked(owner, "aegis-v2")))', () => {
    expect(saltNonceFor(VECTOR.owner)).toBe(VECTOR.saltNonce)
    expect(saltNonceFor(VECTOR.owner.toLowerCase() as `0x${string}`)).toBe(VECTOR.saltNonce)
    const manual = hexToBigInt(keccak256(`${VECTOR.owner.toLowerCase()}${toHex('aegis-v2').slice(2)}` as Hex))
    expect(saltNonceFor(VECTOR.owner)).toBe(manual)
  })
})

describe('predictSafeAddress', () => {
  const initializer = safeInitializer(VECTOR.owner, VECTOR.fallbackHandler)

  it('matches the address the factory deployed', () => {
    expect(predictSafeAddress({ factory: VECTOR.factory, singleton: VECTOR.singleton, initializer, saltNonce: VECTOR.saltNonce, proxyCreationCode: PROXY_CREATION_CODE })).toBe(VECTOR.safe)
  })

  it('agrees with viem getContractAddress over the same CREATE2 inputs', () => {
    const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(initializer), VECTOR.saltNonce]))
    const bytecode = encodePacked(['bytes', 'uint256'], [PROXY_CREATION_CODE, hexToBigInt(VECTOR.singleton)])
    expect(getContractAddress({ opcode: 'CREATE2', from: VECTOR.factory, salt, bytecode })).toBe(VECTOR.safe)
  })

  it('changes with the owner', () => {
    const other = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
    const safe = predictSafeAddress({ factory: VECTOR.factory, singleton: VECTOR.singleton, initializer: safeInitializer(other, VECTOR.fallbackHandler), saltNonce: saltNonceFor(other), proxyCreationCode: PROXY_CREATION_CODE })
    expect(safe).not.toBe(VECTOR.safe)
  })
})

describe('pre-validated signature', () => {
  it('is r = owner, s = 0, v = 1 (65 bytes)', () => {
    const sig = prevalidatedSignature(VECTOR.owner)
    expect(sig.length).toBe(2 + 65 * 2)
    expect(sig).toBe(`0x000000000000000000000000${VECTOR.owner.slice(2).toLowerCase()}${'0'.repeat(64)}01`)
  })

  it('is embedded in execTransaction(safe, 0, enableModule(module), Call, 0, 0, 0, 0x0, 0x0, sig)', () => {
    const data = enableModuleCall(VECTOR.safe, '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6', VECTOR.owner)
    expect(data.slice(0, 10)).toBe('0x6a761202')
    expect(data).toContain('610b5925')
    expect(data).toContain(prevalidatedSignature(VECTOR.owner).slice(2))
  })
})
