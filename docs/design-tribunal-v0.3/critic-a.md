# Critic A: traceability, contracts, boundaries, architecture fit

Artifact: docs/TECHNICAL-DOCUMENT.md v0.3 (S1, working copy over HEAD f02d49e). Lens: requirement traceability, acceptance criteria, contract consistency, API and data boundaries, compatibility, architecture fit, scope conflicts, missing decisions.

Verified as consistent (no candidate): every registry getter TradeEscrow reads exists in `IPolicyRegistry` (S6 interfaces/IPolicyRegistry.sol L5-21), `policyVersion` is `uint64` as in the `ReleaseAuthorization` type string; freeze, unfreeze, quarantine, floor update and cap changes all bump `policyVersion` (S6 L37-53, L131-139, L158-161), so T21 and T31 hold; `revokeAuthorizer` sets the authorizer to zero (S6 L110-113), so the "not to zero" rule in release step 8 is needed and matches AegisModule's `_recover` with `tryRecover` (S7 L397-400); the shared error names keep the AegisModule meaning; the reference Safe is unfrozen with the Authorizer restored and holds 9,750 USDC (S15 evidence-84532.json `postconditions`), so E6a can fund 1,000.

---

## A1. The E6 evidence plan cannot show agent-driven settlement, and it contradicts itself

- Proposed severity: High
- Source locator: S1 L1080 (E6c "The service holds"), L1086 ("with the service stopped during the run"), L1110 (cut line orders "(2) ... E6 recorded by the evidence script, which needs no UI" before "(3) Proof Verifier, Authorizer `/sign-release` and the API"), L49 (Topic F traceability row for conditional settlement points to E6a to E6g), L1058 (T43 runs the service path on Anvil only). Existing pattern: service/scripts/evidence_84532.py L3-6 (phase 2 starts the five real processes against 84532 and drives the HTTP API for E1, E3, E2).
- Scope link: TARGET T1 (E6 evidence plan, test plan, cut line).
- Broken requirement: Competition rules (authority 1: judged on real tx hashes of an agent wallet, Topic F). S5 section 17 L357: "AI membaca status pengiriman, memverifikasi bukti, menentukan jumlah yang boleh dilepas, lalu membayar di testnet", and the second scenario is a hold. TD L41 and L49 claim agent-executed conditional settlement with E6 as evidence.
- Concrete failure scenario: On 18 Oct the team follows L1086 and L1110. The service is stopped. The script signs every `ReleaseAuthorization` with the raw Authorizer key and sends every release itself. E6b and E6e are mined, but no Proof Verifier ran, the Authorizer process never re-verified, no `PROOF_RECEIVED`, `MILESTONE_HELD`, `RELEASE_SIGNED` or `MILESTONE_RELEASED` row exists, and the sender is the script key, not the Executor. E6c says "The service holds", but no service runs, so the only E6c artifact is a reverted tx. After the freeze, step (3) may land, but E6 is not re-recorded, because the hosted service changes only by rollback (L1110).
- Impact: The TradeFlow hashes prove the contract rules only. They do not show the agent reading a proof, holding, or executing a release, which is the Topic F claim in L49 and the S5 section 17 demo. A judge who reads `evidence-84532.json` sees script-sent releases with no ledger trail, unlike E1 to E3. The 40% criterion weights these hashes.
- Architecture disposition: EXTEND scripts/evidence_84532.py phase-2 pattern (start the five processes against 84532, drive the HTTP API, attach `ledgerRef`).
- Minimal design change: (1) State that E6 runs with the processes running (the hosted service stopped, a local five-process run against 84532, as for E1 to E3). Signing does not consume tx nonces, and the attack and freeze txs are sent by ATTACKER and BANK, which the service never uses as senders, so "service stopped" is not needed. (2) E6b, E6d and E6e go through `POST /proofs` or `/proofs/demo`, the Proof Verifier, `/sign-release` and the Executor. E6c records the `MILESTONE_HELD` row (reason `ConditionNotMet`) and then the raw-signed attack hash. E6f and E6g stay raw attacks. (3) Move cut-line step (3) before E6b is recorded, or, if (3) misses the freeze, mark the raw E6 rows in L49 and the evidence table as "contract enforcement, not agent-executed". (4) Decide E6d now: `waive` only (deterministic, `waived = true`); drop the "or a corrected sensor proof" branch.
- Acceptance check: In `evidence-84532.json`, E6b and E6e each have `ledgerRef` rows of kinds `PROOF_RECEIVED`, `RELEASE_SIGNED`, `MILESTONE_RELEASED` with one request id, and the release tx `from` equals the Executor role address; E6c has a `MILESTONE_HELD` row with `ConditionNotMet` before its reverted hash. Fails before (plan says service stopped, script signs and sends); passes after.
- Confidence: High (direct text conflict L1080 vs L1086; the cut-line order is explicit).
- What would disprove it: An explicit statement from the competition rules that contract-only hashes sent by a script count fully as agent execution for Topic F, and removal of "The service holds" from E6c. The text conflict would still need a fix.

---

## A2. Server-built transactions are sent by the owner key, so the API host can drain any Safe; TradeFlow extends this channel

- Proposed severity: High
- Source locator: TD claims S1 L814 ("The API host ... Funds still cannot leave any Safe except through TradeFlow orders that owners funded"), L801 ("No single compromised component short of the owner's own key can move funds out of the treasury"), L529 (a compromised server process is in scope). TradeFlow reuse: S1 L301 ("returns the reserve floor update for the owner to sign, as the obligation flow does today"), L306 and L330 (`GET /resolution` returns "Safe transaction calldata for the owner key to sign and send"), L299 (issuers, conditions and deadlines filled from `GET /api/tradeflow/config`), L295 and L849 (only MultiSendCallOnly and TradeEscrow are pinned). Built code: S3 INTERFACES.md L155 and S4 MULTI-TENANT.md L112 (`floorUpdate: {to, data, value}`); web/src/pages/Treasury.tsx L56-61 (uses the API `floorTx` when present, then `sendTx(tx)`), L67-72 (decode failure falls back to the computed reserve, so the confirm text still says `setReserveFloor`), L79; web/src/lib/identity.tsx L180-191 (`localTx` sends `{to, data}` with the owner burner key), L310-319; web/src/lib/onboard/signers.ts L19-23 (no target check).
- Scope link: TARGET T2 (key separation and blast radius L789-815) and T1 (off-chain flow steps 3 and 8, API additions). SUPPORTING web code provably invalidates the L814 and L801 claims.
- Broken requirement or assumption: Approved decision "owner funds orders via owner-signed Safe tx, the agent never funds"; mechanism 3 (structural containment, L73); the TD's own rule that the web pins delegatecall targets and refuses API values (L295, L849).
- Concrete failure scenario: An attacker controls the API host. `GET /api/obligations` returns `floorUpdate = {to: <tenant Safe>, data: execTransaction(MockUSDC, 0, transfer(attacker, balance), 0, 0, 0, 0, 0, 0, sig(r = owner, s = 0, v = 1))}`. The owner clicks the floor button. The dialog shows `setReserveFloor` and the computed reserve, because decoding fails silently (Treasury.tsx L72). The burner key sends the tx. `msg.sender` is the owner, so the pre-validated signature is valid (the same form as onboarding step 4, L214). All USDC in the Safe goes to the attacker. With TradeFlow, the same host can also return arbitrary `/resolution` calldata, and can set the issuers to its own keys and widen the temperature bounds in `/api/tradeflow/config`, so a bad-temperature proof no longer holds.
- Impact: The L814 and L801 containment claims are false for an in-scope adversary. TradeFlow adds a second executable channel from the API to the owner key and an unpinned source for the order terms the owner approves "once, here" (L581).
- Architecture disposition: REUSE the local encoder that already exists in Treasury.tsx L56-60 (`encodeFunctionData(setReserveFloor)` from the bundled `deployment.registry`), and REUSE web/src/lib/onboard/safe.ts for Safe tx encoding. EXTEND the bundled deployments pinning (L295) to `issuers {carrier, sensor, surveyor}` (already added by L336).
- Minimal design change: The API returns values only (floor, scheduleHash; order id and action), never `to` or `data`. The web encodes `setReserveFloor`, `createOrder`, `waive` and `refund` itself against pinned addresses. `sendTx` refuses a `to` outside the pinned set for that action. The web takes demo issuer addresses from the bundled deployments file and refuses a config that differs; condition defaults are constants in the web build. Correct L814 and L801 to the built truth until the web change ships, and add the floorUpdate path to Known limitations next to L1126.
- Acceptance check: A web test where the API mock returns `floorUpdate` with `to` = the Safe and `execTransaction` calldata: before, `sendTx` is called with it; after, nothing is sent and an error shows. A web test where `/api/tradeflow/config` returns a different sensor issuer or wider bounds: after, funding is refused (extends T45). T47 asserts the waive and refund calldata is built locally and no API `data` field is read.
- Confidence: High (path read in code end to end).
- What would disprove it: A target or selector allowlist elsewhere in the send path, or a server response schema that the web validates before `sendTx` (none found in identity.tsx, signers.ts, Treasury.tsx).

---

## A3. Owner confirmation has no verifiable form, so the Authorizer cannot re-verify it, and it is not bound to a proof

- Proposed severity: Medium
- Source locator: S1 L308 (Authorizer checks include "the pending milestone's deadline has not passed unless the owner confirmed a late release"; no check for a prior hold), L329 (`POST /confirm`, owner session, no signature), L422 and L430 (corrected proof after a hold needs owner confirmation), L434 ("workflow policy, not a security boundary"), L1052 (T37 expects a refusal for "passed deadline without owner confirmation"). Built pattern: S11 procs/authorizer.py L141-158 (owner decisions reach the Authorizer as EIP-712 signatures it recovers), service/aegis/__main__.py L43-44 (the Authorizer has its own DB and reads the shared DB only through `TenantStore`).
- Scope link: TARGET T1 (Authorizer release checks, milestone state machine, tests T37).
- Broken requirement: S5 section 5 L112 (out-of-range temperature holds the payment and asks for an extra inspection); TD L304 ("The Authorizer re-verifies from its own chain reads"); the corrected-proof rule in L430.
- Concrete failure scenario: The sensor proof for milestone 2 fails at 9.40 °C and is held. The sensor issuer then signs a "corrected" proof at 7.90 °C and anyone posts it to `POST /proofs`. If the API workflow state is wrong (bug, restored DB, compromised API with `INTERNAL_TOKEN`), the API asks `/sign-release`. The Authorizer has no record of the hold (a failed proof never reaches it) and no owner artifact to check, so it signs and the release pays 400. For a late release, the Authorizer can only trust a flag in the API payload or a row the API wrote, so T37 cannot test an independent refusal. A `/confirm` call that does not name a `proofHash` also approves any later proof for the same milestone.
- Impact: The two human gates of the TradeFlow workflow are enforced only by the API process, while the TD presents them as Authorizer checks (L308, T37). The S5 hold-and-inspect rule rests on one process.
- Architecture disposition: EXTEND the Authorizer pattern for Approvals (owner EIP-712 signature recovered against `registry.owner`).
- Minimal design change: Make confirmation an owner signature over `ReleaseConfirmation(uint256 orderId,uint8 index,bytes32 proofHash,uint64 expiry)` in the TradeEscrow domain (or a personal_sign message like the session message). `/sign-release` requires it when the chain shows the pending deadline has passed, and when the API reports a prior hold for (orderId, index). State in L308 which checks are independent (deadline: chain read) and which depend on the API (hold history), and record held proof hashes in the ledger row that the Authorizer may read.
- Acceptance check: T37 extended: a `/sign-release` request after the deadline with `ownerConfirmed: true` but no owner signature is refused; with a valid owner signature over a different `proofHash` it is refused; with a matching signature it signs. Fails before (no signature exists in the design), passes after.
- Confidence: Medium-high.
- What would disprove it: A defined data path in the TD by which the Authorizer verifies the owner's confirmation without trusting the API (none in L308, L329, or the built Authorizer).

---

## A4. Transient conditions become terminal holds that need a new proof and the owner

- Proposed severity: Medium
- Source locator: S1 L419-425 (HELD exits only by waive, new proof plus owner confirmation, or refund), L429 (HELD reasons include `Frozen` and `OutOfOrder`), L430, L494-501 (algorithm 7 checks order state, freeze and `issuedAt <= now`), L308 ("the issue time is within range", range not defined), L420 (`RELEASE_REVERTED -> PROOF_RECEIVED`), L1084-1086 (E6g freeze then E6e), L1058 (T43 runs the full E6 sequence through the service).
- Scope link: TARGET T1 (milestone state machine, algorithm 7, T36, T43).
- Broken requirement: S5 section 17 demo flow (valid proofs release without manual work; only bad temperature or a tampered proof holds); S5 section 15 KPI "faster payment processing". Necessary assumption: a hold means a defect in the proof.
- Concrete failure scenario: (a) The bank freezes the reference Safe for E6g. A valid surveyor proof arrives through the service, the verifier returns `Frozen`, and the milestone is HELD. After `bankUnfreeze`, no transition re-verifies the same proof; the surveyor must sign again and the owner must confirm. T43 ("full E6 sequence through the service") stalls at E6e. (b) The sensor proof for milestone 2 arrives while the milestone 1 release is `RELEASE_SUBMITTED`; the verifier returns `OutOfOrder` and holds it. (c) A demo issuer signs `issuedAt` from the server wall clock; the head block timestamp is 1 to 2 s older, so `issuedAt <= now` fails and a valid proof is held as `BadProofTime`. A `RELEASE_REVERTED` with `Frozen` loops back to `PROOF_RECEIVED` and then to the same hold. `OrderNotActive` (algorithm step 1) has no HELD reason code.
- Impact: Normal sequencing and a lifted freeze force owner work and new proofs, which is the manual step the product removes. The service-driven E6 (A1) and T43 cannot complete as written.
- Architecture disposition: EXTEND the workflow state machine (S12 workflow.py) with a waiting state, as the treasury workflow already returns to `STATE_LOADED` on changed conditions (L405-406).
- Minimal design change: Split reasons. Proof defects (`ProofMismatch`, `BadIssuerSignature`, `ConditionNotMet`, `DocumentMismatch`, `BadProofTime` with `issuedAt < createdAt`) go to HELD. State conditions (`Frozen`, `OutOfOrder` while the previous milestone is pending, `issuedAt` ahead of the head block by at most a stated skew, `PolicyVersionMismatch`) go to `WAITING`, which re-verifies the same proof on `PolicyChanged` or `MilestoneReleased` events. Demo issuers set `issuedAt = max(order.createdAt, head block timestamp)`. Add `OrderNotActive` as a terminal reason.
- Acceptance check: Service test: a valid proof posted while bank-frozen is released after `bankUnfreeze` with a new authorization and no owner confirmation; a milestone 2 proof posted before milestone 1 is mined is released after it; a proof with `issuedAt` 2 s ahead of the head block is not held. All three fail before (HELD, owner needed) and pass after.
- Confidence: Medium-high for (a) and (b); medium for (c) (depends on clock skew, see GAP-2).
- What would disprove it: A statement that HELD with `Frozen` or `OutOfOrder` re-enters `PROOF_RECEIVED` automatically, or that the API does not run the verifier while a previous release is pending.

---

## A5. Demo issuer keys reach every process, and the API alone can produce both release signatures

- Proposed severity: Medium
- Source locator: S1 L334 ("live in the API process only"), L799 ("A release still needs the Authorizer"), L795 (Authorizer blast radius: "a release also needs a valid issuer proof"), L812 (`INTERNAL_TOKEN` holders: API, Authorizer, Exit Agent), L889 (deploy step: "add the three demo issuer keys to `aegis.env`, rebuild"). Built: S11 service/aegis/supervisor.py L19-27 and L34-37 (`SECRETS` is a fixed list; every variable not in it, and `INTERNAL_TOKEN`, goes to all five children), S13 deploy/tencent/aegis.env.example L44.
- Scope link: TARGET T2 (key separation and blast radius L789-815, deployment L857-906); T1 demo issuers.
- Broken requirement: Approved decision "release needs issuer-signed MilestoneProof AND Authorizer-signed ReleaseAuthorization" (split authority, mechanism 5, L75); TD L159 ("gives each process only its own secrets"), test M12.
- Concrete failure scenario: The team adds `ISSUER_CARRIER_KEY`, `ISSUER_SENSOR_KEY` and `ISSUER_SURVEYOR_KEY` to `aegis.env` as L889 says. `child_env` passes them to the Authorizer, Executor, Exit Agent and Keeper too. A compromise of the Authorizer process now yields both signatures for every tenant's demo-issued milestones. Separately, even with correct scoping, the API process holds the three issuer keys and `INTERNAL_TOKEN`; it signs proofs that meet the conditions and asks `/sign-release`, which re-verifies the same facts and signs. M12 still passes, because it checks only the names in `SECRETS`.
- Impact: In the demo, one process compromise releases every demo-issued milestone of every tenant early (to the fixed supplier, fixed amounts). L795 and L799 overstate the split.
- Architecture disposition: EXTEND supervisor `SECRETS`/`OWNED` and config `KEY_ENV` (S13 config.py L181-189) with a new `issuer` role.
- Minimal design change: Add the three issuer variables to `SECRETS` and to `OWNED["api"]`; add `INTERNAL_TOKEN` to `SECRETS`, owned by api, authorizer and exit_agent, to match L812. Rewrite L799 and the API host row: "In the demo, a compromise of the API process can obtain releases for demo-issued milestones; the split is real only with external issuers."
- Acceptance check: M12 extended: with `ISSUER_SENSOR_KEY` and `INTERNAL_TOKEN` in the base env, `child_env("authorizer")` has no issuer key, and `child_env("executor")` and `child_env("keeper")` have no `INTERNAL_TOKEN`. Fails before, passes after.
- Confidence: High for the leak (code read); medium for the doc impact.
- What would disprove it: A separate env file or compose service per process for the issuer keys (deploy/tencent shows one `aegis.env` for one container).

---

## A6. The public order view exposes off-chain trade data of every tenant

- Proposed severity: Medium
- Source locator: S1 L326 (`GET /api/tradeflow/orders/{id}`: "a public read-only view for the supplier page | Terms, milestone status, proofs and ledger references. On-chain order data is public anyway"), L684 (`nextOrderId` is sequential), L327 (proofs with optional documents), L503 (Verification Agent explanation), L1054 (T39 tests tenant B with a session, not an unauthenticated caller). Isolation contract: S1 L239 and L830; S4 MULTI-TENANT.md L64.
- Scope link: TARGET T1 API additions and T2 sessions and isolation.
- Broken requirement: S4 L64 ("Every endpoint ... read the Safe from the session only ... the ledger ... return only the session's tenants"); TD L830 (cross-client data extraction mitigation).
- Concrete failure scenario: An unauthenticated caller requests `/api/tradeflow/orders/1` to `/N`. The response includes held proofs (temperature readings, document hashes, issuer, time), hold reasons, the Verification Agent's text, uploaded document metadata and ledger references for every tenant. A held proof never goes on-chain (the release is never sent), so "on-chain order data is public anyway" does not cover it.
- Impact: Cross-tenant disclosure of off-chain data through the one endpoint that has no session binding; T39 does not detect it.
- Architecture disposition: EXTEND session scoping (S10 sessions.py) or REUSE the session message pattern for a supplier role.
- Minimal design change: The public view returns only on-chain fields (buyer, supplier, amounts, milestone statuses, deadlines, release and refund tx hashes). Proofs, documents, hold reasons, explanations and ledger references need an owner or bank session of the buyer, or a supplier session signed by the order's supplier key (`AEGIS session\nrole: supplier`).
- Acceptance check: T39 extended: an unauthenticated GET of another tenant's order returns no `proofs`, `ledgerRefs`, `explanation` or document fields; a supplier session for a different supplier gets the same reduced view. Fails before, passes after.
- Confidence: Medium-high (the row text names proofs and ledger references for the public view).
- What would disprove it: A TD statement that the public view is limited to on-chain fields.

---

## GAPs (depend on an unknown external fact)

- GAP-1 (affects A1 severity): Whether the judges accept script-sent release hashes, with no agent or service in the loop, as Topic F "agent execution". The rules text in hand weights tx hashes, but the reading for script-driven evidence is not known.
- GAP-2 (affects A4 part c): The skew between the CVM wall clock and Base Sepolia head block timestamps during the demo. If it is always under the block interval and the demo issuers already use the chain time, part (c) does not occur.
