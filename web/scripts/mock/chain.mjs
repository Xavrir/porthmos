// Dev only: deploys the AEGIS contracts from ../contracts/out onto a local Anvil, using Anvil's unlocked
// default accounts over JSON-RPC (no private key is read or written). Output: web/.mock/31337.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, http } from 'viem'
import { foundry } from 'viem/chains'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../../../contracts/out')
export const RPC = process.env.MOCK_RPC ?? 'http://127.0.0.1:8555'
export const MOCK_FILE = resolve(here, '../../.mock/31337.json')

export function artifact(file, name = file) {
  const j = JSON.parse(readFileSync(resolve(OUT, `${file}.sol/${name}.json`), 'utf8'))
  return { abi: j.abi, bytecode: j.bytecode.object }
}

export function clients() {
  const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } }
  const pub = createPublicClient({ chain, transport: http(RPC) })
  const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) })
  return { chain, pub, wallet }
}

async function main() {
  const { pub, wallet } = clients()
  const accounts = await pub.request({ method: 'eth_accounts' })
  const [deployer, , , authorizer, exitKey, executor, keeper, attacker] = accounts
  const w = wallet(deployer)
  const deploy = async (file, args = [], name = file) => {
    const a = artifact(file, name)
    const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode, args })
    const r = await pub.waitForTransactionReceipt({ hash })
    return r.contractAddress
  }
  const call = async (address, file, functionName, args) => {
    const hash = await w.writeContract({ address, abi: artifact(file).abi, functionName, args })
    await pub.waitForTransactionReceipt({ hash })
  }
  const usdc = await deploy('MockUSDC', [deployer])
  const priceFeed = await deploy('MockPriceFeed', [deployer, 100000000n])
  await call(priceFeed, 'MockPriceFeed', 'setKeeper', [keeper])
  const vaultA = await deploy('MockVault', [usdc, 'Aegis Vault A', 'avA', deployer])
  const vaultB = await deploy('MockVault', [usdc, 'Aegis Vault B', 'avB', deployer])
  await call(usdc, 'MockUSDC', 'setMinter', [vaultA, true])
  await call(usdc, 'MockUSDC', 'setMinter', [vaultB, true])
  const registry = await deploy('PolicyRegistry')
  const module = await deploy('AegisModule', [registry, usdc, priceFeed])
  const safeSingleton = await deploy('SafeL2')
  const safeProxyFactory = await deploy('SafeProxyFactory')
  const fallbackHandler = await deploy('CompatibilityFallbackHandler')
  const out = {
    chainId: 31337, usdc, priceFeed, vaultA, vaultB, registry, module, safeSingleton, safeProxyFactory, fallbackHandler,
    roles: { deployer, authorizer, exitKey, executor, keeper, attacker },
  }
  mkdirSync(dirname(MOCK_FILE), { recursive: true })
  writeFileSync(MOCK_FILE, JSON.stringify(out, null, 2))
  console.log(`[mock-chain] deployed to ${RPC}; wrote ${MOCK_FILE}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
