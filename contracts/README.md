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

Dependencies are vendored in `lib/` (installed with `forge install --no-git`): forge-std, OpenZeppelin
Contracts v5.4.0, Safe smart account v1.4.1. Solidity 0.8.28.

## Build and test

```bash
eval "$(mise env -s bash)"   # only if forge is not on PATH
cd contracts
forge build
forge test -vv
```

Tests deploy a real Safe v1.4.1 proxy (SafeL2 singleton, proxy factory, fallback handler) and enable the module
through an owner-signed Safe transaction.

| File | Covers |
|---|---|
| `test/AegisModule.t.sol` | C1 to C26 (`test_C<n>_...`) and extra module cases |
| `test/PolicyRegistry.t.sol` | R1 to R4 (`test_R<n>_...`) and the role matrix |
| `test/invariant/ContainmentInvariant.t.sol` | F1: adversary with bank, authorizer, exit and executor keys plus a malicious vault the owner never added |
| `test/invariant/ReserveFloorInvariant.t.sol` | F2: no deposit sequence leaves the Safe below the reserve floor |
| `test/Eip712.t.sol` | `hashDAR`/`hashApproval` equal the standard `eth_signTypedData_v4` digest |

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

## Base Sepolia (not done)

Base Sepolia (84532) deployment has not been run. It needs funded keys that the user must provide; the public
Anvil keys must never be used on a public network. Outside chain 31337 both scripts read every key from the
environment and stop if one is missing:

```
DEPLOYER_KEY OWNER_KEY BANK_KEY AUTHORIZER_KEY EXIT_KEY EXECUTOR_KEY KEEPER_KEY ATTACKER_KEY
```

On chains other than 31337 `Deploy.s.sol` requires the canonical Safe v1.4.1 contracts to exist
(SafeL2 `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762`, factory `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67`,
fallback handler `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99`) and does not deploy its own. `Attack.s.sol` reads
`RPC_URL` (default `http://127.0.0.1:8545`).
