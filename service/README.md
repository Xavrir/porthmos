# AEGIS Treasury service

Off-chain service for AEGIS Treasury: the deterministic treasury core, the agent, the persisted workflow,
the Decision Ledger, and the key-holding processes (Authorizer, Exit Agent, Executor, Keeper). The contract
it talks to is `docs/INTERFACES.md` sections 1.4 to 1.6; the API it serves is section 2. Design:
`docs/TECHNICAL-DOCUMENT.md` sections 02 to 05.

## Processes and keys

| Process | Command | Key it loads | Role |
|---|---|---|---|
| `api` | `python -m aegis api` (port 8787) | `DEPLOYER_KEY` (faucet, test USDC mint), `ADMIN_KEY` (market scenarios; falls back to `DEPLOYER_KEY`), `ATTACKER_KEY` (per-tenant refused attacks) | FastAPI, agent, deterministic core, workflow, ledger, SSE, onboarding |
| `authorizer` | `python -m aegis authorizer` (127.0.0.1:8788, internal token) | `AUTHORIZER_KEY` | Re-verifies every DAR independently, then signs |
| `exit_agent` | `python -m aegis exit_agent` | `EXIT_KEY` | Triggers, quarantine, redeem-only DARs, self-submit fallback |
| `executor` | `python -m aegis executor` | `EXECUTOR_KEY` | Relays signed DARs, pays gas, no authority |
| `keeper` | `python -m aegis keeper` | `KEEPER_KEY` | `poke()` every 60 s (test infrastructure) |

Each process reads only its own key at the point of use (`config.load_key`), and `scripts/dev.sh` also unsets
the other keys in each process environment. `python -m aegis all` (`aegis/supervisor.py`, used by the container in
`deploy/tencent/`) starts the five processes the same way, restarts one that exits, and forwards SIGTERM. The LLM path holds no key. The processes share one SQLite file
(WAL): workflow records, the hash-chained ledger and the submission queue. The Authorizer keeps its own
`*-authorizer.db` of signed nonces.

## Run

```bash
make install                 # uv sync
make test                    # uv run pytest -m "not integration"

make dev-fake                # offline demo: in-memory chain, all workers in-process, API on :8787

make anvil                   # terminal 1: anvil --block-time 2 (chain 31337)
make deploy                  # terminal 2: contracts/script/Deploy.s.sol -> deployments/31337.json
make dev                     # terminal 2: all five processes against Anvil, logs in var/log/
make test-integration        # end-to-end against Anvil (needs a fresh deploy; snapshots and reverts)
```

`make dev` reads `.env` if present (copy `.env.example`). On chain 31337 every key falls back to the public
Anvil test key for its role, so no `.env` is needed locally. On any other chain every key must be set, session
signatures are required and demo scenarios are disabled. Run Anvil with `--block-time 2`; the Exit Agent counts
blocks (it also has a wall-clock fallback for automine Anvil).

Environment: `RPC_URL`, `CHAIN_ID`, `DEPLOYMENTS_PATH`, `CONTRACTS_OUT`, `AEGIS_DB`, `INTERNAL_TOKEN`,
`DEMO_MODE`, `REQUIRE_SESSION_SIG`, `API_PORT`, `AUTHORIZER_URL`, `API_INTERNAL_URL`, `LLM_BASE_URL`,
`LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT`, `EXECUTOR_WITHHOLD_EXITS` (A9 demo), `VAULT_A_APY`, `VAULT_B_APY`.
Multi-tenant (docs/MULTI-TENANT.md): `ALLOWED_ORIGINS`, `SIWE_DOMAINS`, `ADMIN_TOKEN`, `ONBOARDING_OPEN`, `PUBLIC_RPC_URL`,
`EXPLORER_URL`, `TRUST_PROXY`, `IP_HASH_SALT`, `TENANT_*`, `FAUCET_ETH_*`, `TEST_USDC_MINT`, `LIMIT_*`,
`AEGIS_LOG_DIR`, `API_ACCESS_LOG`. Every variable is documented in `deploy/tencent/aegis.env.example`.

ABIs: loaded from `contracts/out/<Name>.sol/<Name>.json` when present; any entry missing there falls back to the
hand-written minimal ABI in `aegis/chain/abi.py`.

## Base Sepolia evidence

`make evidence-sepolia` runs `scripts/evidence_84532.py`. It reads the testnet keys from
`../.secrets/base-sepolia.env` at runtime only. It reproduces the `Attack.s.sol` sequence (E4b, E4a, E4d, E5)
while the service is stopped. Then it starts the five processes against 84532 with `REQUIRE_SESSION_SIG=1` and a
random `INTERNAL_TOKEN`, and drives the API with signed sessions and EIP-712 Approvals: E4c, E1, E3, and E2 last.
E2 quarantines every vault for 24 h. Results merge into `../deployments/evidence-84532.json`; every hash is
checked against its receipt. Select phases with `ARGS="--phases attack,e4c,e1,e3,e2"`. After an E2 run, rerun the
attack phase with `ARGS="--phases attack --clear-quarantine"` once the 24 h cooldown (chain time) has passed.

## Code map

| Path | Component (TECHNICAL-DOCUMENT 02) |
|---|---|
| `aegis/core/state.py` | State Analyzer (only chain reader for the core) |
| `aegis/core/reserve.py` | Reserve Engine: `R_required`, buffer, `scheduleHash`, floor sync |
| `aegis/core/risk.py` | Risk Engine: triggers, ranking score, quarantine cooldown |
| `aegis/core/planner.py` | Allocation Planner: greedy, 60% cap, min trade, 5% band, default option |
| `aegis/core/validator.py` | Proposal Validator: only-more-conservative rule, T3 escalation |
| `aegis/core/policy.py` | Policy Verifier: checks and tier derivation (mirror of `requiredTier`) |
| `aegis/core/actions.py` | Action Builder: Approval envelopes and DARs |
| `aegis/core/simulator.py` | Simulator: `module.check`, vault `eth_call`, final signed `eth_call` |
| `aegis/core/pipeline.py` | Shared glue used by the API workflow and by the Authorizer |
| `aegis/agent/` | Agent: rule-based intent parsing, tools, optional OpenAI-compatible LLM |
| `aegis/workflow.py` | Persisted state machine |
| `aegis/ledger.py` | Hash-chained Decision Ledger and reconciliation with `AegisExecuted` |
| `aegis/procs/` | Authorizer, Exit Agent, Executor, Keeper |
| `aegis/chain/rpc.py`, `aegis/chain/fake.py` | JSON-RPC client; in-memory chain mirroring the module rules for tests |
| `aegis/eip712.py` | Approval and DAR typed data, digests, signing (domain `AegisModule` / `1`) |
| `aegis/tenants.py` | Tenant table (reference Safe = tenant zero), cached reload shared by all processes |
| `aegis/onboarding.py` | `/api/onboard/*`: config, faucet drip, resumable status, on-chain verification, one-time mint |
| `aegis/attacks.py`, `aegis/market.py` | Per-tenant refused attacks; shared market state and scenarios |
| `aegis/limits.py` | Sliding-window rate limits in SQLite |
| `aegis/chain/safe.py` | Safe v1.4.1 setup, salt and CREATE2 address prediction for onboarding |
| `aegis/supervisor.py` | `python -m aegis all` process supervisor |

## API

All endpoints of INTERFACES section 2 are implemented. Amounts are `{"raw", "display"}`. Prices are
`{"raw", "display"}` with 8 decimals.

Session: `GET /api/auth/nonce`, then `POST /api/session {message, signature}` with a Sign-In with Ethereum (EIP-4361)
message signed by personal_sign. It returns `{token, role, address, safe, safes, expiresAt, readOnly, auth}` and also
sets an `aegis_session` HttpOnly cookie. Send `X-Aegis-Session: <token>`. An owner session is bound to the Safe
whose registry owner is the signed address; a bank session reads the Safes whose registry bank is that address. The
message (format in docs/TECHNICAL-DOCUMENT.md 04, Signed structures; code in `aegis/siwe.py`):

```
localhost:5173 wants you to sign in with your Ethereum account:
0x70997970C51812dc3A010C7d01b50e0d17dc79C8

Sign in to Porthmos as owner.

URI: http://localhost:5173
Version: 1
Chain ID: 31337
Nonce: <from GET /api/auth/nonce, single use>
Issued At: <RFC 3339, within 10 minutes>
Expiration Time: <in the future, within 1 hour of Issued At>
Resources:
- urn:porthmos:role:owner
```

Domains come from `SIWE_DOMAINS` (default `porthmos.vercel.app,aegis-treasury-eta.vercel.app,localhost:*,127.0.0.1:*`).
Smart contract wallets sign with ERC-1271 or ERC-6492. With `REQUIRE_SESSION_SIG=0` (the default on 31337 only) an
unsigned `{role, address}` body still opens a session for local tests.

The owner never passes a Safe. A bank session may pass `?safe=` to pick one of its own Safes. An owner passing
another Safe gets `403 CrossClientRefused`, and the attempt is written to the ledger.

Errors are `{"error": <code>, "detail": <text>}` with a 4xx status.

Notes for the web app:

- `POST /api/agent/chat {message, requestId?}` returns `{reply, requestId, state, mode, actionCard?,
  clarification?, obligationDraft?}`. `requestId` is optional and continues a `NEEDS_CLARIFICATION` request; without
  it, an answer that fills the missing fields continues the latest pending clarification.
- `actionCard.approvalTypedData` is ready for `eth_signTypedData_v4`. Integer fields in `message` are decimal
  strings; convert them to `BigInt` before calling viem `signTypedData`. Post the signature with the unchanged
  `message` object to `/api/requests/{id}/approval`. T4 needs the owner, then the bank (bank session).
- `POST /api/obligations` returns `{obligation, floorUpdate: {to, data, value, floor, scheduleHash}}`; the owner
  wallet sends `{to, data, value}` (registry `setReserveFloor`). `confirmedInflow: true` records a confirmed inflow.
- `GET /api/stream` (SSE): `hello`, `state`, `ledger`, `risk`, `execution`, `submission`, `alert`, `obligation`,
  `scenario`, `oracle`. EventSource cannot set headers: use the cookie (same origin) or `?session=<token>`.
- Extra endpoints: `GET /api/alerts` (critical exit alerts) and, only with `AEGIS_CHAIN=fake`,
  `POST /api/demo/fake/apply-floor` (stands in for the owner wallet sending `floorUpdate`).
- Demo scenarios (31337 and `DEMO_MODE`): `depeg` sets the price to 0.985; `liquidity` caps the largest held vault
  at half the position; `stale` pauses the keeper and advances time past `maxOracleAge`; `obligation` adds a
  2,000 USDC invoice and returns its `floorUpdate`; `restore` resets price, liquidity and keeper. Quarantine is
  not cleared by `restore`: only the owner can clear it after 24 h.

## Agent

Tools (all bound to the session Safe; extra arguments are dropped and flagged): `get_treasury_state`,
`get_obligations`, `get_risk_report`, `plan_allocation`, `propose_action(option_id, reductions?)`,
`explain_decision(request_id)`.

Deterministic mode (no `LLM_*`): rule-based intent kinds `ALLOCATE`, `REDEEM`, `REBALANCE`, `STATUS`, `RISK`,
`EXPLAIN`, `MANDATE`, `TRANSFER_OUT`, `CANCEL`; amount and date parsing; clarification when a mandate lacks amount
or due date, or a deposit says "some" without an amount; template replies. LLM mode uses an OpenAI-compatible
`/chat/completions` endpoint for intent, option choice and wording. Its output is validated: unknown kinds or
option IDs fall back to the rules, a rule-detected transfer request is never upgraded, and vault names, metadata
and the owner message are passed as labelled quoted data. Obligations are never created from chat: a mandate
produces an `obligationDraft` that the owner must add through `/api/obligations`.

## Workflow

States are exactly those of INTERFACES section 2. Every transition is stored with a timestamp and the input
versions it used (block, `policyVersion`, oracle round, on-chain and computed `scheduleHash`, `planHash`).
Ledger rows are written for `HELD`, `POLICY_REJECTED`, `SIM_FAILED`, `AWAITING_APPROVAL`, `APPROVED`,
`APPROVAL_DENIED`, `APPROVAL_EXPIRED`, `DAR_SIGNED`, `SUBMITTED`, `CONFIRMED`, `REVERTED`, `CANCELLED`, plus
exit-agent, obligation, cross-client and scenario events.

`FINAL_REVALIDATION` reloads state, rebuilds the plan and the action for the selected option, and simulates
again. If the action no longer fits the human Approval (vault or op changed, amount above `maxAmount`, policy
version changed, expired, tier raised), it returns to `STATE_LOADED` and replans (at most 3 times). Only then is
the Authorizer asked to sign, and the signed DAR gets one final `eth_call` before it is queued for the Executor.

## Tests

| ID | Where |
|---|---|
| A1 | `tests/test_core.py::TestReserveA1` |
| A2 | `tests/test_workflow.py::TestScriptedTasksA2` (allocate, routine T2, hold, obligation change, clarification, denial then correction, T4, expiry, revalidation replan, cancel) |
| A3 | `tests/test_workflow.py::test_same_request_ten_times_a3` |
| A4 | `tests/test_core.py::TestValidatorAndPolicy::test_above_default_escalates_to_t3_a4`, `tests/test_workflow.py::test_llm_above_default_escalates_a4` |
| A5 | `tests/test_workflow.py::test_injection_set_a5`, `tests/test_api.py::test_cross_client_refused_and_logged`, `tests/test_authorizer_llm.py` |
| A6 | `tests/test_core.py::TestCounterfactualA6` |
| A7 | `tests/test_core.py::TestPlanner::test_floor_out_of_sync_holds_a7`, `tests/test_workflow.py::test_floor_out_of_sync_hold_a7` |
| A8 | `tests/test_workflow.py::test_partial_exit_then_rest_a8`, `tests/integration/test_anvil.py` |
| A9 | `tests/test_workflow.py::test_executor_withholds_exit_self_submit_a9`, `tests/integration/test_anvil.py` |
| A10 | `tests/test_workflow.py::test_ledger_edit_shows_mismatch_a10` |
| Multi-tenant | `tests/test_multitenant.py` (onboarding checks, mint once, isolation incl. SSE, limits, LLM fallback, market), `tests/integration/test_multitenant_anvil.py` (two tenants end to end on Anvil) |

Unit tests run against `aegis/chain/fake.py`. `tests/integration/` (marker `integration`) runs against Anvil with
the deployed contracts: T3 and T2 deposits, replayed and tampered DARs, partial exit with self-submit, depeg exit,
and ledger reconciliation. It needs a fresh `Deploy.s.sol` state and leaves the chain as it found it.

## Interpretations and deviations

- Liquidity trigger: ERC-4626 `maxRedeem(owner)` never exceeds the owner's balance, so `maxRedeem < 1.2 x position`
  would always fire. The trigger compares the vault's releasable liquidity (`min(idle USDC, remainingLiquidity())`)
  with 1.2 x our position. Exit sizing still uses `min(position, maxRedeem(Safe))` as specified.
- Quarantine call: TECHNICAL-DOCUMENT 03 names `setDepositsPaused(vault)`; INTERFACES and the contract use
  `quarantine(safe, vault)`, which is what the Exit Agent calls. The single feed means a depeg or stale oracle
  quarantines and exits every vault.
- A quarantined vault with a position keeps being exited each window until the position is zero, even after the
  trigger clears, since only the owner can lift quarantine.
- T1/T2 go `SIMULATED -> FINAL_REVALIDATION` directly (the diagram brackets `AWAITING_APPROVAL` as conditional).
- An Authorizer refusal or a failed final signed `eth_call` moves the request to `CANCELLED` with the reason
  (the diagram has no failure edge from `FINAL_REVALIDATION`/`DAR_SIGNED`; `CANCELLED` is reachable from any
  non-terminal state).
- Transfer requests, read-only questions and mandates run the normal pipeline and end in `HELD` (reasons
  `NotRepresentable`, `ReadOnly`, `AwaitingObligationConfirmation`) instead of new states.
- Reserve: unsettled overdue obligations count at `t = now`; at equal timestamps outflows are applied before
  inflows; `F` (fee reserve) defaults to 0 because gas is paid in ETH by the Executor.
- Floor sync holds only when the on-chain floor is below `R_required`; a higher floor is more conservative.
- Planner: one action per request. The default is the first leg (protective redemptions first, then deposits in
  ranking order). The option set also has a half-size and an `autoCap`-size variant of the default and a full
  redeem per position. Choosing another vault's leg is above the default and escalates to T3.
- Deposit price band: centred on the current price, width `min(1%, maxBandWidth)`, clipped to the 1% peg band.
- Deposit simulation before signing uses `previewDeposit` plus `module.check`; an `eth_call` of `vault.deposit`
  from the Safe would revert without the module's `approve`. The final signed `eth_call` of `module.deposit`
  covers the full path before broadcast.
- The Authorizer checks the schedule it is sent against the on-chain floor and the DAR's evidence hash; the
  schedule itself is owner-entered data held by the API.
- Sessions add an optional signed-message proof (required off 31337); the spec body `{role, address}` works on 31337.
- Demo seed: on 31337 with `DEMO_MODE`, a Safe with no obligations gets "Payroll (demo seed)" 4,000 USDC due in
  14 days, whose reserve (4,500 USDC) equals the deployed floor.
