# Design Tribunal: AEGIS Technical Document v0.1

## Verdict

**NOT READY.** Rule 2 applies: the review confirmed one Critical finding.

## Architecture fit and reuse

This is a document-only review, so architecture fit is not verified against code. No code repository exists yet.

| Capability | Disposition | Seam |
|---|---|---|
| Custody wallet | REUSE | Safe smart account, `execTransactionFromModule` |
| Vault interface | REUSE | ERC-4626 (`deposit`, `redeem`, `maxRedeem`) |
| Approval signatures | REUSE | EIP-712 |
| Price feed interface | REUSE | Chainlink `AggregatorV3Interface` (on a mock) |
| AegisModule, PolicyRegistry | NEW | Custom contracts; S1 records Zodiac Roles as a rejected alternative |
| Reserve, risk, planner, verifier, simulator, authorizer, executor, Exit Agent, ledger | NEW | Python service |

## Confirmed findings

### [Critical] A single bank key can rotate the Authorizer and add vaults, and nobody is named to lift a bank pause

- **Evidence:**
  - `S1:L287`: "The owner or bank can pause and rotate the key".
  - `S1:L304` and `S5:L132`: the bank sets approved vaults.
  - `S1:L115`: "owner and bank roles", with no role matrix.
  - `S1:L270`: names who can pause, but nobody who can unpause.
  - These conflict with `S1:L286` ("cannot move funds") and `S1:L291`.
- **Broken behavior:** One compromised non-owner key can move funds out of the treasury. The design claims that only the owner key can do this.
- **Failure scenario:**
  1. An attacker with the bank key rotates the Authorizer to their own key.
  2. They allowlist a fake ERC-4626 vault that sends deposited USDC to them.
  3. They sign T2 deposits. The tier is chosen by the signer, so "first allocation needs T3" is not enforced.
  4. They repeat this every day up to `dailyCap`, until the Safe reaches the reserve floor.
  5. If the owner can unpause a bank pause, the kill switch is advisory only.
- **Impact:** Funds are lost and cannot be recovered. The structural-containment claim (`S1:L43`) and the kill-switch requirement (`S5:L94`, `S5:L194`) both fail.
- **Architecture fit:** NEW. PolicyRegistry is a custom contract, so S1 must define its permissions.
- **Recommended change:** Publish a role matrix for each function:
  - Adding a vault, loosening a cap, lowering the floor and rotating the Authorizer need the owner.
  - The bank may only remove a vault, tighten a limit or pause.
  - Only the bank can clear a bank pause.
  - Add bank `revokeAuthorizer`, so that "agent role revoked" (`S5:L194`) is real.
- **Acceptance check:** Foundry tests in which these calls revert:
  - `setAuthorizer` called from the bank.
  - `addVault` called from the bank.
  - The owner unpausing a bank pause.
  - A DAR signed by a revoked Authorizer, which must revert `BadSignature`.
- **Confidence:** medium. A joint-consent reading of L304 exists, but L287 has no such reading.

### [Medium] The approval tier is chosen by the signer, the T4 bank limit has no on-chain field, and the price band has no width limit

- **Evidence:**
  - `S1:L271`: signatures are required "as required by `tier`".
  - `S1:L275`: `autoCap` is skipped when tier ≥ T3.
  - `S1:L253` and `S1:L254`: T3 covers "first allocation" and T4 covers "bank's per-client limit".
  - No registry field holds a bank limit, and no check uses one.
- **Broken behavior:** Bank escalation (`S5:L94`) works off-chain only. If `dailyCap` is used as the bank limit, T4 can never execute.
- **Failure scenario:**
  - A 4,000 deposit is tagged T3, with the owner's signature only. It executes without bank approval.
  - A compromised Authorizer signs the price band `[0, max]`, so the state-bound price check means nothing.
- **Impact:** The bank-oversight claim is not enforced. The owner can still act through the Safe directly, so this is Medium.
- **Architecture fit:** NEW (AegisModule and PolicyRegistry).
- **Recommended change:**
  - Add `bankLimit` and `maxBandWidth` to the registry.
  - The module derives the required signatures from the amount, the first-use flag for each vault, and `bankLimit`, and applies whichever tier is higher, derived or declared.
- **Acceptance check:** These tests revert `MissingApproval`:
  - A first-use deposit tagged T2.
  - A deposit above `bankLimit` without a bank signature.

  And:
  - An over-wide band reverts.
- **Confidence:** high.

### [Medium] Pause, a policy-version change, or a delisted vault also blocks protective exits

- **Evidence:**
  - `S1:L268`: the checks run "For each call".
  - Step 1 (`!paused`), step 4 (`policyVersion`) and step 5 (allowlist) apply to redeems as well as deposits.
  - `S1:L257`: every policy change invalidates every DAR.
  - These conflict with `S1:L57` ("risk-reducing actions have a lower bar") and `S5:L156`.
- **Broken behavior:** The Exit Agent cannot exit in the situations where an exit matters most.
- **Failure scenario:**
  - The bank presses the kill switch during a depeg. The T1 redeem reverts `Paused`.
  - An invoice arrives (E3) while an exit is in flight. The redeem reverts `PolicyVersionMismatch`.
  - The owner removes a troubled vault from the allowlist. All redeems from it revert `VaultNotAllowed`.
- **Impact:** Funds stay in the distressed vault until the owner exits by hand.
- **Architecture fit:** NEW (AegisModule check order).
- **Recommended change:** Apply steps 1, 4 and 5 to `deposit` only. A `redeem` with receiver = Safe keeps the signature, expiry and nonce checks, and is allowed from any vault where the Safe holds shares. If a full freeze is ever needed, record it as a separate, explicit decision.
- **Acceptance check:** These execute:
  - A T1 redeem while paused.
  - A redeem after a version bump.
  - A redeem after delisting.

  A deposit in each of those states still reverts.
- **Confidence:** high.

### [Medium] The on-chain reserve floor is never synchronised with the obligation-derived reserve

- **Evidence:**
  - `S1:L41`: the floor is "derived from the actual payment schedule ... enforced on-chain".
  - `S1:L140`: obligations are entered in the app.
  - `S1:L257` and `S1:L328`: the floor is a registry value set by a separate transaction.
  - No flow connects `R_required` to `reserveFloor`.
- **Broken behavior:** Innovation claim 1 is not delivered. The contract may protect the wrong number.
- **Failure scenario:**
  - A new 1,500 invoice makes `R_required` 6,000, but the floor stays at 4,500. A faulty or compromised path deposits down to 4,500.
  - After payroll is paid, the stale higher floor blocks all deposits.
- **Impact:** The obligation can be short on its due date, or deposits break with no clear reason.
- **Architecture fit:** NEW (link between the Reserve Engine and the registry).
- **Recommended change:**
  - Every obligation approval or settlement produces an owner-signed `setReserveFloor(R_required)`.
  - The planner returns HOLD (`FloorOutOfSync`) while `reserveFloor < R_required`.
- **Acceptance check:** Add an obligation without a sync. The planner holds. After the sync, `reserveFloor == R_required`, and a breaching deposit reverts.
- **Confidence:** high.

### [Medium] What the owner and bank sign, and how it survives final revalidation, is undefined

- **Evidence:**
  - `S1:L179`: `SIMULATED → AWAITING_APPROVAL → FINAL_REVALIDATION → DAR_SIGNED`.
  - `S1:L271`: owner and bank signatures over the DAR.
  - The DAR includes `oracleRound`, the price band, `nonce` and `expiry` (`S1:L264`).
- **Broken behavior:** S1 does not say which struct the humans sign. If revalidation changes any field, their signatures stop verifying.
- **Failure scenario:** The owner approves. The oracle round advances before the Authorizer signs. The owner's signature no longer matches, and the workflow loops back to replan (`S1:L183`).
- **Impact:** The T3 and T4 approval flows cannot be built as written.
- **Architecture fit:** NEW (DAR schema).
- **Recommended change:**
  - Humans sign a separate `Approval{safe, op, vault, maxAmount, policyVersion, approvalExpiry, approvalNonce}`.
  - The Authorizer signs the final DAR, which carries the `approvalHash`.
  - The module checks that the DAR stays within the Approval.
- **Acceptance check:** The owner signs an Approval, the round advances, and a new DAR under that Approval executes. A DAR above `maxAmount` reverts.
- **Confidence:** medium.

### [Medium] The Simulator needs a signed DAR, but signing happens only after simulation

- **Evidence:**
  - `S1:L109`: "eth_call of the exact module call, with the signed DAR".
  - `S1:L110`: "Signs the DAR only after verification and simulation succeed".
  - `S1:L179`: SIMULATED comes before DAR_SIGNED.
- **Broken behavior:** Simulation always reverts at step 2. Signing first instead breaks the gate.
- **Failure scenario:** Every action fails closed at SIMULATED. Alternatively, the team signs first, so signed but unverified DARs sit in the queue.
- **Impact:** The pipeline cannot be built as written.
- **Architecture fit:** NEW (Simulator).
- **Recommended change:**
  - Simulate through a view `preview(dar)` that skips signature checks, or through an `eth_call` state override or an Anvil fork.
  - After signing, re-run `eth_call` with the real signatures before submitting.
- **Acceptance check:** A T3 flow reaches SIMULATED before any signature exists, and the preview and execution results match.
- **Confidence:** high.

### [Medium] The Exit Agent's signing key and path are undefined, and a compromised Executor can hold back exits

- **Evidence:**
  - The diagram at `S1:L85` sends Exit Agent DARs straight to the Executor.
  - T1 needs the Authorizer's signature (`S1:L251`).
  - The key table (`S1:L283` to `S1:L289`) has no Exit Agent key.
  - `S1:L112` says "may only reduce exposure", but no on-chain check enforces it.
  - `S1:L111` says Executor compromise "grants nothing". This ignores liveness.
- **Broken behavior:** Either the always-on monitor holds the Authorizer key, which breaks key separation, or the path is undefined. Nothing on-chain limits the Exit Agent's key to redeems.
- **Failure scenario:**
  - A compromised Exit Agent process signs T2 deposits.
  - A compromised Executor drops every protective DAR during a depeg.
- **Impact:** Key separation is not verifiable, and exits can be censored.
- **Architecture fit:** NEW.
- **Recommended change:**
  - Register a separate Exit key that the module accepts only for `REDEEM` with receiver = Safe.
  - Make module entry points permissionless, so any address can submit a signed DAR.
  - Name a fallback submitter.
- **Acceptance check:**
  - The Exit key signing a DEPOSIT reverts.
  - A valid T1 DAR submitted from a non-Executor address executes.
- **Confidence:** high.

### [Medium] A full protective redeem reverts under the liquidity trigger it is meant to handle

- **Evidence:**
  - `S1:L215`: exit when withdrawable liquidity is below 1.2 × the position.
  - `S1:L221` and `S1:L276`: an unsized `redeem`.
  - Public standard behavior: ERC-4626 `redeem` reverts when shares exceed `maxRedeem`.
  - Only the stale-oracle exit is tested (C13).
- **Broken behavior:** The liquidity exit cannot complete.
- **Failure scenario:** The admin sets vault liquidity to 0.5 × the position. Every Exit Agent loop reverts.
- **Impact:** The core risk control fails in its own scenario. The owner can still redeem by hand.
- **Architecture fit:** REUSE ERC-4626 (`maxRedeem`, `previewRedeem`).
- **Recommended change:**
  - Use `shares = min(position, maxRedeem(Safe))`, and set `minAssets` from `previewRedeem` minus a tolerance.
  - Repeat every window until the position is closed.
- **Acceptance check:** With liquidity at 0.5 × the position, a partial redeem executes and the remainder follows later.
- **Confidence:** high.

### [Medium] The module does not check the Safe call result, so a failed redeem can produce false execution evidence

- **Evidence:**
  - Public standard behavior: `execTransactionFromModule` returns `false` when the inner call fails. It does not revert.
  - `S1:L276` and `S1:L277`: the module enforces `minOut` and emits `AegisExecuted`, but no success check is specified.
- **Broken behavior:** A failed protective redeem with `minAssets = 0` still uses up the nonce and emits `AegisExecuted`.
- **Failure scenario:** This combines with the partial-liquidity finding above. The redeem fails inside the vault, but the ledger and the Bank Risk Desk show a completed exit.
- **Impact:** The execution evidence is false.
- **Architecture fit:** REUSE (Safe module API).
- **Recommended change:** `require(success)` on every Safe call, or use `execTransactionFromModuleReturnData`. Measure the actual changes in shares and assets.
- **Acceptance check:** With a mock vault that reverts on redeem, the module reverts `ExecutionFailed` and emits no event.
- **Confidence:** medium.

### [Medium] "Only more conservative" does not stop the LLM from choosing the riskiest plan option

- **Evidence:**
  - `S1:L168`: the LLM "may select one option" and may only reduce amounts.
  - `S5:L141`: "hanya boleh lebih konservatif" (it may only be more conservative).
- **Broken behavior:** Among the options the planner returns, a manipulated model can pick the one with the most risk.
- **Failure scenario:** The options are hold, conservative and aggressive. Injected metadata pushes the model to pick aggressive, and the validator accepts it.
- **Impact:** The S1:L168 claim is overstated, and exposure rises within policy.
- **Architecture fit:** NEW (Proposal Validator).
- **Recommended change:** The planner marks one default option. The LLM may choose only the default, hold, or an option that is at or below the default for every venue. Any other choice escalates to T3.
- **Acceptance check:** A test double picks the aggressive option, and the result is rejected or escalated.
- **Confidence:** high.

### [Medium] The agent state machine has no reject, hold, deny, clarify or correct states

- **Evidence:**
  - `S1:L177` to `S1:L183`: a linear chain whose only terminals are CONFIRMED and REVERTED.
  - `S3:L8`: the judges score "clarification, correction and fallback".
- **Broken behavior:** S1 does not define what happens on a policy rejection, a simulation failure, a denied approval, a hold, or a user correction.
- **Failure scenario:** The owner denies a T3 action and says "do 2,000 instead". No transition exists for this.
- **Impact:** A judged interaction criterion cannot be traced, and rejections may never reach the ledger.
- **Architecture fit:** NEW.
- **Recommended change:**
  - Add the states HELD, POLICY_REJECTED, SIM_FAILED, APPROVAL_DENIED, CANCELLED and NEEDS_CLARIFICATION, each going to EXPLAINED.
  - Add a correction transition from AWAITING_APPROVAL back to OPTION_SELECTED.
- **Acceptance check:** The A2 scripted tasks include a denial-then-correction case. The ledger shows the denied DAR, the replanned DAR and the final transaction hash.
- **Confidence:** high.

### [Medium] Tests and evidence do not cover the core state-bound checks, and reverted-transaction hashes cannot be produced as planned

- **Evidence:**
  - `S1:L351` to `S1:L365` have no test for:
    - oracle round mismatch
    - price out of band
    - stale oracle on deposit
    - T4
    - registry roles
    - partial exit
    - a failed inner call
  - `E1` to `E5` (`S1:L383` to `S1:L389`) have no "conditions changed, DAR rejected" case, which `S5:L200` requires.
  - `S1:L279` relies on reverted transaction hashes. Public standard behavior: viem estimates gas first and refuses to send a transaction that would revert, and the Simulator blocks it earlier still.
- **Broken behavior:** Innovation claim 2 has neither tests nor judge-visible evidence. E4a, E4b and E5 may never be broadcast.
- **Failure scenario:** On the deadline day, the attack scenarios have no on-chain hash.
- **Impact:** Points are lost in Security & Compliance and Task Completion.
- **Architecture fit:** NEW (test plan).
- **Recommended change:**
  - Add tests for every item listed above.
  - Add E4d: sign a deposit, move the price out of band, submit, and record the revert.
  - Add `script/Attack.s.sol`, which sends with a fixed gas limit.
  - Add an adversarial actor and a malicious-vault fixture to fuzz test F1.
- **Acceptance check:** Every check in step 6 has a test. E4a, E4b, E4d and E5 have transaction hashes with status 0 and the typed error.
- **Confidence:** high.

### [Medium] A pending deposit can land in a vault the Exit Agent has just left because of liquidity stress

- **Evidence:**
  - Step 6 (`S1:L275`) has no liquidity check.
  - No rule excludes a vault after an exit. The hysteresis rule (`S1:L219`) covers only drift.
- **Broken behavior:** Funds can return to a stressed vault within the expiry of a pending DAR.
- **Failure scenario:**
  1. A T3 deposit into Vault B is pending.
  2. A liquidity trigger fires and the Exit Agent redeems from Vault B.
  3. The pending deposit lands.
  4. The next cycle redeems again, and the loop repeats.
- **Impact:** Exposure oscillates, and gas and `dailyCap` are wasted.
- **Architecture fit:** NEW.
- **Recommended change:** Quarantine a vault after a trigger. The Exit key may set a per-vault `depositsPaused` flag, only the owner clears it, and the planner excludes the vault during a cooldown.
- **Acceptance check:** A pending deposit after the trigger reverts `VaultQuarantined`.
- **Confidence:** medium.

### [Medium] Agent tools have no tenant binding

- **Evidence:**
  - `S1:L136` lists the tools with no session binding.
  - The service serves many clients (`S1:L29`, `S1:L44`).
  - `S1:L307` covers only leakage to the LLM provider.
  - `S3:L7` scores data extraction.
- **Broken behavior:** S1 does not say that a tool scopes its data to the authenticated client.
- **Failure scenario:** Client A's chat, or injected metadata, asks for Client B's treasury state.
- **Impact:** Cross-client data extraction, which is a scored security failure.
- **Architecture fit:** NEW (tool layer).
- **Recommended change:** Tools take the Safe from the server-side session and ignore any client ID the LLM supplies. Bank-desk access is a separate read-only role.
- **Acceptance check:** A cross-client request in A5 returns no data and is logged.
- **Confidence:** medium.

### [Medium] The Bank Risk Desk trusts a ledger the server can edit

- **Evidence:**
  - `S1:L113`: "Append-only by convention".
  - `S1:L243`: a compromised server is in the threat model.
  - `S1:L44`: the bank gets a "live view".
- **Broken behavior:** Oversight data comes from the component that might be compromised.
- **Failure scenario:** An attacker with server access rewrites rows that record rejected attempts. The bank sees a clean history.
- **Impact:** Oversight can be blinded. On-chain events remain correct.
- **Architecture fit:** NEW.
- **Recommended change:**
  - The desk reads `AegisExecuted` events and balances directly over RPC.
  - It flags mismatches with the ledger.
  - The ledger rows are hash-chained.
- **Acceptance check:** Tampering with one row raises a mismatch alert on the desk.
- **Confidence:** medium.

### [Medium] There is no evidence-first cut line or checkpoint for the E1 to E5 hashes

- **Evidence:**
  - `S3:L6`: task completion (40%) is judged by on-chain transaction hashes.
  - `S1:L326` to `S1:L389` list a large scope with no priority order.
- **Broken behavior:** Nothing protects the scored evidence from scope slip.
- **Failure scenario:** Work on extras (AgentDojo adaptation, baselines, fuzzing) uses up day 5, and the E-hashes are missing.
- **Impact:** The main scoring evidence is lost.
- **Architecture fit:** NEW (plan).
- **Recommended change:**
  - Mark these as must-have: the module and registry, the deterministic pipeline, the Exit Agent, owner signing, bank pause, and E1 to E5.
  - Mark the rest as stretch.
  - Add a day-4 checkpoint that requires all E hashes.
- **Acceptance check:** A dated plan maps each E scenario to a day, and the hashes exist by day 4.
- **Confidence:** medium.

## Areas checked

- **S1** (Technical Document v0.1), every section:
  - 01: the claims
  - 02: principles, components, decisions, tools
  - 03: state machine, algorithms, Exit Agent
  - 04: tiers, module steps 1 to 8, key table, mitigations
  - 05: deployment, the C, F, A and E tests, limitations
- **S2** (official Topics & Rules) and **S3** (official website judging text).
- **S4a**, **S4b**, **S4c** (official templates). S1 contains all S4a sections.
- **S5** (product concept v1.1): bank oversight, the "more conservative" rule, the demo scenarios.
- **Baseline:** none. No code repository exists yet.
- **Excluded sources:** the author's chat explanations, and any prior review conclusions. No prior reviews existed.

## Gaps and assumptions

| Gap | What would resolve it |
|---|---|
| Whether T3 and T4 can execute at all also depends on how often the oracle updates relative to the DAR expiry and the time a human takes to approve. S1 states neither. | The heartbeat, the keeper interval, the DAR expiry for each tier, and a target for approval latency. |
| The MockPriceFeed needs a keeper or update rule, and the deployment plan has none. Without updates, the staleness trigger fires all the time. With frequent updates, round-bound DARs expire. | A MockPriceFeed specification (who updates `updatedAt`, and how often), a heartbeat value stored in the registry, and a keeper step in deployment. |
| Whether the scope can be built in 6 days depends on team size and skills. | The team list and an effort estimate per component. |
| Judges' reading of "can spend on-chain" (S3:L13) against an agent that only deposits and redeems. S2 lists asset management, so the review found no broken requirement. | Organiser clarification, or a short traceability table in section 01 mapping the Topic F wording to E-scenario hashes. |
| Whether the bank must also be able to freeze protective exits. The recommended change exempts them. | An explicit product decision recorded in S1. |
