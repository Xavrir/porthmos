# AEGIS Treasury contracts

Foundry project for the AEGIS Safe module, its policy registry and the demo mocks. The interface is
`docs/INTERFACES.md` section 1; the design and test list are `docs/TECHNICAL-DOCUMENT.md` sections 04 and 05.

| Contract | Purpose |
|---|---|
| `src/AegisModule.sol` | Safe module. Accepts only typed `DEPOSIT`/`REDEEM` actions signed as EIP-712 DARs; derives the approval tier; calls the Safe with `execTransactionFromModuleReturnData` |

Redeem skips freezes, policy version, allowlist, quarantine and oracle checks, but only for vaults the Safe has
deposited into through the module (`everDeposited`); any other vault reverts `NoPosition`. Delisted or quarantined
vaults with a module deposit stay redeemable.
| `src/PolicyRegistry.sol` | Per-Safe policy, role matrix, freezes, quarantine, `policyVersion` |
| `src/MockUSDC.sol` | 6-decimal ERC-20. `mint` is open on chain 31337; owner or registered minter elsewhere |
| `src/MockPriceFeed.sol` | Chainlink `AggregatorV3Interface`, 8 decimals. `setPrice` (admin), `poke` (admin or keeper) |
| `src/MockVault.sol` | OpenZeppelin ERC-4626 with `setLiquidityCap`, `accrue`, `setRevertMode` for stress scenarios |
| `src/TradeEscrow.sol` | TradeFlow escrow [Design v0.3]: three-milestone orders funded by a registered Safe; a release needs an issuer `MilestoneProof` and an Authorizer `ReleaseAuthorization` (EIP-712 domain `TradeEscrow`/`1`); pays only the fixed supplier, refunds only to the buyer Safe |

Dependencies are vendored in `lib/` (installed with `forge install --no-git`): forge-std, OpenZeppelin
Contracts v5.4.0, Safe smart account v1.4.1. Solidity 0.8.28.

## Build and test

```bash
eval "$(mise env -s bash)"   # only if forge is not on PATH
cd contracts
forge build
forge test -vv
```

Use a Foundry 1.8.x nightly (verified with 1.8.6-nightly `bbc7910` on 20 Oct 2026: 106 tests reported, all pass). The vendored forge-std 1.17.0 expects the newer `vm.lastCallGas()` result, so with Foundry 1.5.1-stable or 1.6.0-nightly one test (`test_T1_createOrderThroughSafeMultiSendCallOnly`) fails at its gas-logging line.

Tests deploy a real Safe v1.4.1 proxy (SafeL2 singleton, proxy factory, fallback handler) and enable the module
through an owner-signed Safe transaction.

| File | Covers |
|---|---|
| `test/AegisModule.t.sol` | C1 to C26 (`test_C<n>_...`) and extra module cases |
| `test/PolicyRegistry.t.sol` | R1 to R4 (`test_R<n>_...`) and the role matrix |
| `test/invariant/ContainmentInvariant.t.sol` | F1: adversary with bank, authorizer, exit and executor keys plus a malicious vault the owner never added |
| `test/invariant/ReserveFloorInvariant.t.sol` | F2: no deposit sequence leaves the Safe below the reserve floor |
| `test/Eip712.t.sol` | `hashDAR`/`hashApproval` equal the standard `eth_signTypedData_v4` digest |
| `test/TradeEscrow.t.sol` | TradeFlow T2 to T28, T30, T31: every `createOrder`, `release`, `waive`, `refund` check and error, check order, `checkRelease` parity, fuzz cases |
| `test/TradeEscrowFunding.t.sol` | T1: funding through a real Safe, delegatecall to MultiSendCallOnly (approve + createOrder), atomicity |
| `test/TradeEscrowEip712.t.sol` | T29: `hashProof`/`hashAuthorization` equal the `eth_signTypedData_v4` digest, including negative temperatures |
| `test/invariant/TradeEscrowInvariant.t.sol` | T32 to T35: escrow balance, payees, no double payment, refund timing and `committedOf`, with an adversary holding the Authorizer, Exit, issuer and Executor keys |

## Deploy to local Anvil

```bash
anvil                                   # separate terminal, chain 31337
cd contracts
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cat ../deployments/31337.json
```

`Deploy.s.sol`:

1. Deploys MockUSDC, MockPriceFeed (price 1.00, keeper = account 6), Vault A, Vault B, PolicyRegistry, AegisModule.
2. Uses the canonical Safe v1.4.1 addresses if they have code; on 31337 they do not, so it deploys SafeL2,
   SafeProxyFactory and CompatibilityFallbackHandler.
3. Creates the demo Safe (owner = account 1, threshold 1) and enables the module.
4. Owner registers the Safe and sets vaults, authorizer, exit key, caps, band width, oracle age and a 4,500 USDC
   reserve floor. Bank sets `bankLimit`. Values are those in INTERFACES.md 1.6.
5. Mints 10,000 USDC to the Safe and seeds 50,000 USDC of liquidity into each vault.
6. Writes `deployments/<chainId>.json`.

TradeFlow is a second script. `Deploy.s.sol` rewrites the whole deployments file, so TradeFlow keys go to a sidecar
and a merge adds them back (TD v0.4, C10). `cd service && make deploy` runs all three steps on 31337:

```bash
forge script script/DeployTradeEscrow.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ../service && uv run python scripts/merge_deployment.py --chain-id 31337 --rpc-url http://127.0.0.1:8545
```

`DeployTradeEscrow.s.sol` reads `registry` and `usdc` from `deployments/<chainId>.json`, deploys TradeEscrow, and on
31337 only deploys MultiSendCallOnly from `lib/safe-smart-account` (elsewhere it requires code at the canonical
`0x9641d764fc13c8B624c04430C7356C1C7C8102e2`). Demo issuer addresses are Anvil accounts 8 (carrier), 9 (sensor) and
10 (surveyor) on 31337, and `ISSUER_CARRIER_ADDRESS`, `ISSUER_SENSOR_ADDRESS`, `ISSUER_SURVEYOR_ADDRESS` elsewhere.
It writes `deployments/<chainId>.tradeflow.json`. `tradeEscrowBlock` is the last block mined before the broadcast,
a lower bound for log scans. The merge adds `tradeEscrow`, `multiSendCallOnly`, `tradeEscrowBlock` and `issuers` as two
lines before `"abis"`, and fails without writing if any other byte, key or value would change, if the sidecar was
deployed against another registry or token, or (with `--rpc-url`) if an address has no code.

Roles use the public Anvil accounts: 0 deployer/admin, 1 owner, 2 bank, 3 authorizer, 4 exit key, 5 executor,
6 keeper, 7 attacker. On a fresh Anvil the addresses are the same on every run. To deploy again on the same Anvil
instance, restart Anvil or set `SAFE_SALT` to a new value.

ABIs are the forge artifacts in `contracts/out/<File>.sol/<Contract>.json` after `forge build`.

## Attack evidence (E4a, E4b, E4d, E5)

```bash
forge script script/Attack.s.sol --rpc-url http://127.0.0.1:8545    # no --broadcast
```

The script signs each transaction itself and sends it with `eth_sendRawTransaction` at a fixed gas limit of
1,500,000. A reverting call is therefore still mined and gets a hash. Before each send it simulates the call and
checks the expected outcome; after mining it checks the receipt status. It prints every hash:

| Step | Sender | Expected |
|---|---|---|
| keeper poke, valid first deposit (owner Approval) | keeper, executor | success |
| E4b: the same deposit calldata replayed | attacker | `NonceUsed()` |
| E4a: DAR amount changed after signing | attacker | `BadSignature()` |
| E4d: DAR signed, admin moves price to 0.97, DAR submitted | executor | `PriceOutOfBand()` |
| E5: bank `revokeAuthorizer` (sets bank freeze), then a deposit | executor | `Frozen()` |
| E5: exit-key redeem during the freeze | executor | success |
| cleanup: price back to 1.00, bank unfreeze, owner restores authorizer | | success |

Confirm a revert reason independently:

```bash
cast receipt <hash> --rpc-url http://127.0.0.1:8545     # status 0 (failed)
cast run <hash> --rpc-url http://127.0.0.1:8545         # trace ends in e.g. [Revert] NonceUsed()
```

## Base Sepolia (deployed)

The contracts are deployed on Base Sepolia (84532); addresses are in `deployments/84532.json` and the README. The deployed runtime bytecode matches `forge build` of this repository (see `docs/EXECUTION_EVIDENCE.md` §4). The recorded evidence (E1 to E6g) was sent by `service/scripts/evidence_84532.py`, not by `Attack.s.sol`: the testnet roles did not hold enough ETH for the script's legacy pricing and 1,500,000 gas limit, so the Python script sends the same calls with EIP-1559 fees and an 800,000 gas limit.

To deploy again elsewhere, never use the public Anvil keys on a public network. Outside chain 31337 both scripts read every key from the environment and stop if one is missing:

```
DEPLOYER_KEY OWNER_KEY BANK_KEY AUTHORIZER_KEY EXIT_KEY EXECUTOR_KEY KEEPER_KEY ATTACKER_KEY
```

On chains other than 31337 `Deploy.s.sol` requires the canonical Safe v1.4.1 contracts to exist
(SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`,
fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`) and does not deploy its own. `Attack.s.sol` reads
`RPC_URL` (default `http://127.0.0.1:8545`).
