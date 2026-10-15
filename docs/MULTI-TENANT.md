# AEGIS Treasury: Multi-tenant App Spec (v2)

Extends `docs/INTERFACES.md` (v1). Where this file and v1 disagree, this file wins. If an implementer must change a contract here, edit this file in the same change and add a line to the Changelog at the bottom.

## Goal

Any visitor of the public site creates their own AEGIS treasury on Base Sepolia (84532) in under a minute, then uses it for real: the agent plans, the contract enforces, every action is a real transaction. No smart-contract changes and no redeploy: the 84532 contracts in `deployments/84532.json` already key every rule by Safe. The existing Safe in that file stays as the **reference treasury** (the recorded evidence); visitors cannot act on it.

Non-goals: mainnet, real funds, per-tenant vaults or price feeds, account recovery beyond a key file download.

## Roles per tenant

| Role | Holder | Notes |
|---|---|---|
| owner | Visitor. Default: a burner key generated in the browser. Optional: injected wallet (MetaMask, Rabby, Coinbase extension). | Safe owner, threshold 1, registry owner |
| bank | Visitor. Always a second burner key generated in the browser. | Lets one visitor sit in both seats of their own treasury |
| authorizer, exitKey, executor, keeper | Server (shared AEGIS operator keys, the existing 84532 keys) | Same addresses for every tenant |
| faucet | Server (the existing DEPLOYER key, which owns MockUSDC) | ETH drip and test USDC mint |
| attacker | Server (existing ATTACKER key) | Sends the per-tenant refused attacks |

Browser key storage: `localStorage["aegis.wallet.v1"] = {version:1, chainId:84532, owner:{type:"burner",pk}|{type:"injected",address}, bank:{pk}, safe}`. The UI offers "Download keys" (JSON file) and "Import keys". It states plainly: testnet only, anyone with this file controls this test treasury. No key ever goes to the server or into the bundle.

## Onboarding (client-driven; every step is a real tx)

All parameters come from `GET /api/onboard/config`, never hard-coded in the web app.

1. Client creates or loads the keys.
2. `POST /api/onboard/fund {owner, bank, issuedAt, signature}`. `signature` = owner `personal_sign` of
   `AEGIS onboarding\nowner: <checksum>\nbank: <checksum>\nchainId: 84532\nissuedAt: <ISO-8601>` (max age 5 min).
   Server tops each address up to the target balance in config (`ethOwner`, `ethBank`) if it is below half of it, once per address ever. Returns `{txs:[{address, hash, amountWei}]}` (empty if no drip was needed). Waits for receipts before returning (timeout 60 s, then returns hashes with `pending:true`).
3. Owner sends `SafeProxyFactory.createProxyWithNonce(singleton, setup([owner], 1, 0x0, 0x, fallbackHandler, 0x0, 0, 0x0), saltNonce)` with `saltNonce = uint256(keccak256(abi.encodePacked(owner, "aegis-v2")))`. The client predicts the Safe address before sending and skips this step if code already exists there.
4. Owner sends `Safe.execTransaction(safe, 0, enableModule(module), 0, 0, 0, 0, 0x0, 0x0, sig)` with the pre-validated signature form (`r = owner`, `s = 0`, `v = 1`, valid because `msg.sender == owner`).
5. Owner sends, in order: `register(safe, owner, bank)`, `addVault(vaultA)`, `addVault(vaultB)`, `setAuthorizer(authorizer)`, `setExitKey(exitKey)`, `setAutoCap`, `setDailyCap`, `setMaxBandWidth`, `setMaxOracleAge` (values from config `params`). Reserve floor starts at 0 and is set later by the obligation flow.
6. Bank sends `setBankLimit(safe, params.bankLimit)`.
7. `POST /api/onboard/activate {safe, owner, issuedAt, signature}` (same message format as the session message in v1 with role `owner`). Server verifies on-chain: Safe threshold 1 with `owner` as an owner, module enabled, `registry.owner == owner`, `bank != 0 && bank != owner`, authorizer and exitKey equal the server keys, both vaults allowed, every cap within `paramBounds`. Then it mints `testUsdc` to the Safe once (recorded so a second call never mints again), stores the tenant, and starts serving it. Returns `{safe, mintTx, tenant}`.

Steps 3 to 6 are skipped if the chain already shows them done. `GET /api/onboard/status?owner=0x..` returns `{safe, steps:{funded, safeDeployed, moduleEnabled, registered, vaults, authorizer, exitKey, caps, bankLimit, activated}}` read from the chain and DB, so the client resumes after a reload.

Burner path: the client sends steps 3 to 6 automatically and shows a stepper with one explorer link per tx. Injected path: try EIP-5792 `wallet_sendCalls` for steps 4 and 5 when the wallet reports atomic batch support; otherwise send them one by one with a clear "n of 10" progress. The bank steps always use the burner bank key.

`GET /api/onboard/config` returns:
```json
{ "chainId": 84532, "rpcUrl": "<public RPC for the browser>", "explorer": "https://sepolia.basescan.org",
  "safeSingleton": "0x..", "safeProxyFactory": "0x..", "fallbackHandler": "0x..",
  "registry": "0x..", "module": "0x..", "usdc": "0x..", "priceFeed": "0x..",
  "vaults": [{"address":"0x..","name":"Vault A"},{"address":"0x..","name":"Vault B"}],
  "operator": {"authorizer":"0x..","exitKey":"0x..","executor":"0x..","keeper":"0x.."},
  "params": {"autoCap":"1000000000","dailyCap":"5000000000","bankLimit":"3000000000","maxBandWidth":"2000000","maxOracleAge":180},
  "paramBounds": {"autoCapMax":"10000000000","dailyCapMax":"50000000000","bankLimitMax":"50000000000","maxBandWidthMax":"5000000","maxOracleAgeMax":3600},
  "ethOwner": "50000000000000", "ethBank": "20000000000000", "testUsdc": "100000000000",
  "referenceSafe": "0x..", "onboardingOpen": true }
```
`fallbackHandler` is read from the deployments file when present, else the canonical v1.4.1 CompatibilityFallbackHandler for that chain.

## Tenants

- Table `tenants(safe PK, owner, bank, created_at, activated_at, mint_tx, ip_hash)` in the service SQLite DB. Loaded at start by every process; new tenants are picked up by all five processes within 10 s without restart.
- The reference Safe from the deployments file is tenant zero, flagged `reference`. The keeper and Exit Agent protect it like any tenant; no public session can bind to it, because its owner key is not public.

## Sessions and isolation

- `REQUIRE_SESSION_SIG=1` in production: every `POST /api/session` needs the v1 signed message.
- Owner session binds to the one tenant where `registry.owner(safe) == address`. Bank session binds to the tenants where `registry.bank(safe) == address`, read-only in the API except the bank actions it signs itself on-chain.
- Every endpoint, tool and the LLM agent read the Safe from the session only. `/api/stream`, `/api/ledger`, `/api/events`, `/api/approvals/pending`, `/api/requests/*`, `/api/bank/clients` return only the session's tenants. A test proves tenant A cannot read or act on tenant B by any endpoint, including the SSE stream.

## Per-tenant stress and attack actions (84532)

- Obligation shock: the normal `POST /api/obligations` flow (owner burner sends the floor update).
- `POST /api/tenant/attack {kind: "tampered" | "replay"}` (owner session). The server ATTACKER key broadcasts a transaction against the session's Safe with a fixed gas limit so it is mined and reverts: `tampered` = a DAR signed by the authorizer for a small valid deposit, with the amount changed after signing (expects `BadSignature`); `replay` = re-submits this tenant's last executed DAR (expects `NonceUsed`; returns 409 `NothingToReplay` if none). The DAR used by `tampered` must not be valid as signed, and it is never submitted untampered. Returns `{kind, txHash, reverted:true, error:"BadSignature"}` after the receipt; the ledger records it.
- Bank actions (freeze, unfreeze, revoke authorizer, remove vault, tighten caps) are sent by the bank burner directly to the registry. The UI then shows the agent's next action being refused on-chain and the Exit Agent still able to redeem.
- Market scenarios (`depeg`, `liquidity`, `stale`, `restore`) move shared contracts, so on 84532 they need header `X-Aegis-Admin: <ADMIN_TOKEN>`. `GET /api/market` (public) reports the current market state so every tenant sees an active market event.

## Abuse limits (env-configurable)

| Limit | Default |
|---|---|
| Onboarding per IP per day | 3 |
| Total tenants | 300 (then `onboardingOpen:false`) |
| Faucet ETH per UTC day | 0.003 ETH |
| Chat messages per tenant | 20 per 10 min |
| LLM calls overall | 300 per hour, then deterministic mode with a notice |
| Attack actions per tenant | 6 per hour |

Errors use the v1 error shape with codes `RateLimited`, `OnboardingClosed`, `FaucetEmpty`, `NotActivated`, `BadOnboardingState`.

## LLM

OpenAI-compatible via `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Production: CLIProxyAPI on the same host, model `claude-haiku-5-5`. Any LLM error or timeout (20 s) falls back to deterministic mode for that request; the reply says so in one short line. The LLM still only proposes; nothing in this spec gives it a key or a Safe choice.

## CORS and hosting

- `ALLOWED_ORIGINS` (CSV), default `https://aegis-treasury-eta.vercel.app,http://localhost:5173,http://localhost:4173`. Allow headers `Content-Type, X-Aegis-Session, X-Aegis-Admin`; methods GET, POST, OPTIONS; no credentials.
- Public API: `https://aegis-api.150-109-23-187.sslip.io` behind the existing RuteAman Caddy on the Tencent CVM. Container files in `deploy/tencent/` (Dockerfile, compose, env example). One image runs all five processes; memory limit 512 MB; SQLite and logs on a volume.
- Web build reads `VITE_API_URL`. Health check `GET /api/health` must report chain id, block lag, keeper last poke, LLM mode, tenant count, `onboardingOpen`.

## Web

- Landing CTA: "Create your treasury" (primary) and "See the on-chain proof" (replay of the reference treasury, unchanged).
- `/start`: onboarding stepper (burner default, "Use my own wallet" secondary), live tx links, resumable.
- Seat chooser on app pages: "Owner seat" and "Bank seat" of my treasury (both keys local), "Just look" (replay). No seat if no treasury yet: send to `/start`.
- All existing pages (Treasury, Copilot, Risk, Audit, Bank desk) work in live mode for the session's tenant. If the API is unreachable, the site falls back to replay with a visible banner.
- Owner-signed items (EIP-712 Approvals, floor update txs, freeze) sign with the local burner without a wallet popup, after an in-page confirm that shows what is being signed.

## API details (service implementation, v2.1)

Additive to the shapes above unless marked as a change.

- `POST /api/session`: the response adds `safes` (owner: `[safe]`; bank: every tenant whose registry bank is the address).
- `GET /api/onboard/status?owner=` returns `{safe, owner, bank, steps, tenant}`. `safe` is the predicted address; `bank` is set once registered; `tenant` is set once activated.
- `POST /api/onboard/fund` returns `{txs:[{address, hash, amountWei, pending}], pending}`.
- `POST /api/onboard/activate`: `safe` must equal the address predicted for `owner` (genuine proxy of the configured singleton, factory and fallback handler), and one owner holds at most one treasury. On failure: 409 `{error:"BadOnboardingState", detail, failed:[...]}` with codes `SafeNotDeployed ThresholdNotOne OwnerNotOnSafe ModuleNotEnabled RegistryOwnerMismatch BadBank WrongAuthorizer WrongExitKey VaultMissing:<name> AutoCapOutOfBounds DailyCapOutOfBounds MaxBandWidthOutOfBounds MaxOracleAgeOutOfBounds BankLimitOutOfBounds UnexpectedSafeAddress OwnerHasTreasury ActivationInProgress`. Every cap must be above 0 and at most its bound.
- `GET /api/obligations` (owner session) adds `floorUpdate` `{to, data, value, floor, scheduleHash}`. A new tenant starts with floor 0 while the required reserve is the 500 USDC buffer, so the agent holds until the owner sends this transaction.
- `POST /api/agent/chat`: when the LLM fails, times out or is over budget, the response has `mode:"deterministic"`, `llmFallback:"error"|"limit"`, and the last line of `reply` is the notice. After an LLM error or timeout the service skips the LLM for 30 s, so an outage costs one timeout, not one per request. 429 `RateLimited` over the chat limit.
- `POST /api/tenant/attack`: `{kind, txHash, reverted, error}` plus `pending:true` if no receipt within 60 s. Errors: 400 `UnknownAttack`, 409 `NothingToReplay`, 429 `RateLimited`, 503 `AttackerUnavailable`. The Authorizer signs the `tampered` DAR only with an expiry at least one hour in the past, so the signed form can never execute.
- `POST /api/demo/scenario` body `{name, vault?, cap?}` (`vault`: address or "Vault A"/"Vault B"; `cap`: raw liquidity cap, default 1,000 USDC without a session). With a valid `X-Aegis-Admin` no session is needed. Off 31337: 403 `AdminRequired` without the header; `obligation` returns 403 `DemoDisabled`.
- `GET /api/market` returns `{price, roundId, updatedAt, ageSeconds, stale, maxOracleAge, pegDeviationPct, keeper:{paused, lastPoke}, vaults:[{address, name, totalAssets, liquidityCapped, remainingLiquidity}], active:["depeg"|"liquidity"|"stale"], scenario:{name, at, by}|null, time}`.
- `GET /api/health` (change): the `safes` list is removed. Adds `referenceSafe`, `tenantCount` (activated, excluding the reference), `onboardingOpen`, `llmMode` (`llm`, `deterministic` or `rate-limited`), `blockLagSeconds`, `keeper:{paused, lastPoke:{tx, at}, oracleUpdatedAt, oracleAgeSeconds}`.
- `GET /api/ledger` (change): `integrity` is `{ok, rows, broken}` where `rows` counts the returned rows and `broken` lists only the session's tenants.
- SSE: events that carry a `safe` reach only sessions of that tenant; market-wide events (oracle pokes, market scenarios) have `safe:null` and reach everyone. New event types: `tenant`, `attack`.
- The Exit Agent watches only tenants that hold vault shares; a tenant without a position has nothing to exit, and its deposits are already held by the planner and the module oracle checks.
- `deployments/31337.json` now includes `fallbackHandler` (the locally deployed CompatibilityFallbackHandler).

## Changelog

- v2 (2026-10-15): initial multi-tenant spec.
- v2.1 (2026-10-15): service implementation details: session `safes`, onboarding status/fund/activate shapes and failure codes, owner `floorUpdate` on GET /api/obligations, LLM fallback fields and 30 s cooldown, attack and scenario details, `GET /api/market` shape, health fields (`safes` removed), tenant-scoped ledger integrity, `fallbackHandler` in deployments/31337.json.
