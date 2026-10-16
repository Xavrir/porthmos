# Design tribunal: Technical Document v0.3 (TradeFlow / TradeEscrow and multi-tenant)

## Verdict

NOT READY. Rule applied: at least one confirmed High finding exists (C1, C2, C4).

## Architecture fit and reuse

- TradeEscrow contract: NEW. `contracts/src/AegisModule.sol` (deposit L124, redeem L140) only allows DEPOSIT/REDEEM with the receiver fixed to the Safe; paying a third-party supplier would change the deployed module. Reads `PolicyRegistry` (REUSE).
- Order funding via owner-signed Safe tx through MultiSendCallOnly: REUSE. Canonical v1.4.1 MultiSendCallOnly has code on 84532 (read 17 Oct 2026); on 31337 deploy it from `contracts/lib/safe-smart-account`.
- ReleaseAuthorization signing: EXTEND `service/aegis/procs/authorizer.py`.
- Release submission: EXTEND `service/aegis/procs/executor.py`.
- Proof Verifier and milestone workflow: EXTEND `service/aegis/core` pipeline and `workflow.py`.
- Cash / committed / free view: EXTEND the reserve engine and `GET /api/treasury`.
- Tenant isolation for orders: EXTEND `service/aegis/sessions.py`, `tenants.py`.
- Demo issuer keys: NEW role in `service/aegis/config.py` KEY_ENV and `supervisor.py` OWNED/SECRETS.
- E6 evidence: EXTEND `service/scripts/evidence_84532.py` phase 2.
- Owner transactions in the web: REUSE the local encoders (`web/src/pages/Treasury.tsx` L57-58, `web/src/lib/onboard/safe.ts`).

## Confirmed findings

### [High] C1. The owner key sends API-supplied calldata, so an API-host compromise can drain any Safe
- Evidence: `[S1] L801, L814` claim funds cannot leave a Safe without the owner; `[S1] L301, L306, L330` make TradeFlow reuse server-returned calldata; `[S3] L155`, `[S4] L112` define `floorUpdate {to, data, value}`; `[S14] Treasury.tsx L36, L56, L61` sends `res.floorUpdate` unchanged; `identity.tsx L310-319, L190` and `signers.ts L19-25` send any target with no check.
- Broken behavior: structural containment (mechanism 3) and the blast-radius table are false under the in-scope adversary "compromised server process" (`[S1] L529`).
- Failure scenario: the API returns `floorUpdate.to = <tenant Safe>`, `data = execTransaction(..., operation=DELEGATECALL, sig r=owner,s=0,v=1)`; the owner clicks "sign floor update"; the dialog falls back to a plausible floor value; the burner key sends; the Safe is drained.
- Impact: full loss of any tenant treasury after one click; TradeFlow `resolution` adds a second path.
- Architecture fit: REUSE the existing local encoders; no parallel path.
- Recommended change: the API returns parameters only; the web encodes `setReserveFloor`, `createOrder`, `waive`, `refund` against addresses pinned from the bundled deployments file; `sendTx` refuses unpinned targets and Safe `execTransaction` it did not build; issuers and condition defaults for orders come from the bundled build. Correct L801/L814.
- Acceptance check: web test where the mocked API returns a Safe-targeted floorUpdate results in no send (fails before, passes after); valid response encodes exactly to the pinned registry; T47 shows resolution calldata is local.
- Confidence: high

### [High] C2. The E6 plan cannot show agent-executed settlement
- Evidence: `[S1] L1110` cut line records E6 by script (step 2) before the Proof Verifier and `/sign-release` (step 3); `[S1] L1079-1080` claim an Authorizer-signed release and "the service holds"; `[S5] L357` requires the AI to verify and pay; `[S15]` E1 carries `requestId`, `workflow`, `ledgerRef` and an Executor sender.
- Broken behavior: E6 hashes would be script-signed with the raw Authorizer key, with no verifier, hold or ledger trail.
- Failure scenario: under time pressure the team records E6 at step 2; E6b/E6e come from the script key; E6c's hold is a script decision.
- Impact: the hashes behind the 40% criterion show contract enforcement only, not the agent.
- Architecture fit: EXTEND `evidence_84532.py` phase 2 (local five processes against 84532).
- Recommended change: reorder the cut line so the Proof Verifier, `/sign-release` and minimal API come before E6; record E6b and E6e through the Executor after `PROOF_VERIFIED` and `RELEASE_SIGNED`; record E6c's `MILESTONE_HELD` row before the forced submit; fix E6d to a waive only. If E6 must be recorded earlier, label those rows "contract path, script-signed".
- Acceptance check: schema check of `evidence-84532.json`: E6b/E6e have `requestId`, workflow states, `ledgerRef`, and `from` = Executor; E6c has a `MILESTONE_HELD` row with `ConditionNotMet`.
- Confidence: medium-high

### [High] C4. Anyone can force a milestone into HELD with an unsigned proof
- Evidence: `[S1] L327` `POST /proofs` caller "Anyone"; `[S1] L305, L429-430` any failed check holds, including `BadIssuerSignature`, and later proofs need owner confirmation; `[S1] L684` sequential ids; `[S1] L332` the rate limit is per order, shared with real issuers; document size unbounded.
- Broken behavior: an unauthenticated caller changes milestone state and blocks automated verify-and-pay.
- Failure scenario: POST random signatures to every active order id; every milestone becomes HELD; 30 junk posts per hour also consume the per-order budget of the real issuer.
- Impact: zero-cost, cross-tenant, repeatable denial of the core TradeFlow promise; ledger and disk growth.
- Architecture fit: EXTEND the Proof Verifier and `/proofs` endpoint.
- Recommended change: run the pure checks first (order active, `index == nextIndex`, ids and kind match, signature recovers to the milestone issuer); failures return 4xx, write no ledger row and never change state; only issuer-signed proofs can produce HELD; cap document size; keep a separate rate budget for unsigned rejects.
- Acceptance check: an unsigned proof then a valid proof: before, HELD and no Authorizer call; after, 4xx without a ledger row and the valid proof reaches `RELEASE_SIGNED`; oversized document returns 413.
- Confidence: high

### [Medium] C3. Demo issuer keys and INTERNAL_TOKEN reach processes that must not hold them
- Evidence: `[S11] supervisor.py L19-20, L34-35` (denylist; all other variables go to every child); `[S1] L334` "API process only"; `[S1] L889` add issuer keys to `aegis.env`; `[S1] L812` lists three INTERNAL_TOKEN holders, the code gives it to five; M12 (`test_multitenant.py L626-634`) does not catch it.
- Broken behavior: one process can produce both release signatures; L795, L799 and mechanism 5 overstate the split.
- Failure scenario: following L889, the Authorizer child receives the issuer keys and can release every demo-issued milestone.
- Impact: early release of demo milestones to the fixed supplier after one process compromise.
- Architecture fit: EXTEND supervisor OWNED/SECRETS and KEY_ENV.
- Recommended change: issuer keys owned by the API only (or a separate issuer process); INTERNAL_TOKEN owned by API, Authorizer and Exit Agent only; state in L799 that in the demo the API process alone can obtain releases for demo-issued milestones.
- Acceptance check: extended M12: only the API child has ISSUER_*; Executor and Keeper have no INTERNAL_TOKEN.
- Confidence: high

### [Medium] C5. Transient conditions become terminal holds
- Evidence: `[S1] L429` HELD reasons include `Frozen` and `OutOfOrder`; `[S1] L421-423, L430` HELD exits need a waive, refund or a new proof plus owner confirmation; no `OrderNotActive` reason.
- Broken behavior: a bank unfreeze or the previous milestone being mined does not resume the milestone.
- Failure scenario: a valid proof arrives during a bank freeze, or a milestone 2 proof arrives while the milestone 1 release is pending.
- Impact: manual owner work for normal sequencing; slower payment.
- Architecture fit: EXTEND the workflow state machine with a WAITING state.
- Recommended change: add WAITING for Frozen, OutOfOrder-while-pending and AuthorizerNotCurrent; re-verify on `PolicyChanged` or `MilestoneReleased`; add `OrderNotActive` as a terminal reason.
- Acceptance check: proof during a bank freeze releases after unfreeze without owner confirmation; early milestone 2 proof releases after milestone 1 is mined.
- Confidence: medium

### [Medium] C6. `issuedAt` and "now" have no defined time base
- Evidence: `[S1] L499` "`issuedAt <= now`" with now undefined; `[S1] L308` range undefined; `[S1] L732` on-chain uses `block.timestamp`; `rpc.py L168-172` uses wall time on 31337 and chain time on 84532; measured Base Sepolia lag 0 to 2 s.
- Broken behavior: a fresh demo proof stamped with wall time fails `BadProofTime` and becomes a terminal HELD.
- Failure scenario: demo issuer signs with `time.time()`; verifier checks against the latest block 1 s earlier.
- Impact: random failures in the live demo and the E6 run; masked on Anvil.
- Architecture fit: EXTEND the demo issuer signer and Proof Verifier using `chain.block_timestamp()`.
- Recommended change: issuers set `issuedAt = max(order.createdAt, latest block timestamp)`; all off-chain comparisons use the latest block timestamp.
- Acceptance check: fake chain 2 s behind wall time: before, HELD BadProofTime; after, verified.
- Confidence: medium-high

### [Medium] C7. No terminal failure state or retry bound for a failed release
- Evidence: `[S1] L419-420` unbounded `RELEASE_REVERTED -> PROOF_RECEIVED`; no edge for a preflight failure; `[S1] L787` re-sign rule without a bound; `executor.py L52-54` marks preflight failures `failed` without a workflow callback.
- Broken behavior: a deterministic failure (for example after the owner rotates the Authorizer) leaves the milestone stuck or looping.
- Failure scenario: Authorizer rotated; every final `eth_call` fails `BadSignature`; the service re-signs or stalls.
- Impact: ledger and Authorizer noise, executor gas, no human hand-off.
- Architecture fit: EXTEND executor submission kinds and the milestone workflow.
- Recommended change: add `RELEASE_FAILED`; at most two automatic re-signs for `PolicyVersionMismatch`, `Expired`, `NonceUsed` without event; any other selector or a third failure goes to HELD `ReleaseFailed:<selector>`.
- Acceptance check: preflight always failing BadSignature ends HELD after one attempt with one ledger row per transition; one policyVersion bump gives one re-sign then RELEASED.
- Confidence: medium-high

### [Medium] C8. Owner confirmation of a late release is not verifiable by the Authorizer
- Evidence: `[S1] L308` lists "unless the owner confirmed a late release" as an Authorizer check; `[S1] L329` `/confirm` carries no signature; the built Authorizer accepts owner intent only as recovered EIP-712 signatures (`authorizer.py L141-158`).
- Broken behavior: an independent-looking check depends only on an API claim.
- Failure scenario: a compromised API sends `ownerConfirmed: true` after the deadline and the Authorizer signs.
- Impact: limited (payee and amount fixed), but T37 cannot test what L308 claims.
- Architecture fit: EXTEND the Authorizer owner-signature pattern.
- Recommended change: either require an owner EIP-712 `ReleaseConfirmation(orderId, index, proofHash, expiry)` for late releases, or reword L308 and T37 to say it is workflow policy reported by the API.
- Acceptance check: T37: confirmation without a signature is refused; a signature over another proofHash is refused.
- Confidence: medium

### [Medium] C9. The public order view exposes off-chain data of every tenant
- Evidence: `[S1] L326` public view returns "proofs and ledger references"; `[S1] L1054` T39 says tenant B cannot read A's orders; `[S1] L239, L830` session binding; sequential ids.
- Broken behavior: held proofs, hold reasons, explanations and ledger references (never on-chain) are readable by anyone.
- Failure scenario: unauthenticated `GET /api/tradeflow/orders/1..N`.
- Impact: cross-tenant disclosure; contradictory spec.
- Architecture fit: EXTEND session scoping; split the projection.
- Recommended change: a public view with on-chain fields only; full view only for the buyer's owner or bank session (or a supplier session signed by the order's supplier key).
- Acceptance check: extended T39: unauthenticated and tenant B requests receive only on-chain fields.
- Confidence: high

### [Medium] C10. Freeze-day rollout can break the built service and has no rollback
- Evidence: `service/Makefile L24-25` and `Deploy.s.sol L183-184` rewrite `deployments/31337.json`, dropping TradeFlow keys; `docker-compose.yml L7-10` overwrites the `aegis-treasury:latest` tag; `deploy/tencent/README.md` has no rollback; `[S1] L1110` relies on rollback.
- Broken behavior: local redeploys lose TradeEscrow; a bad build on 18 Oct has no tagged previous image.
- Failure scenario: rerun `make deploy` on 31337, or a broken 18 Oct image.
- Impact: local tests fail; the public demo can go down on the last build day.
- Architecture fit: EXTEND the Makefile and deploy/tencent.
- Recommended change: `make deploy` runs both scripts; tag the running image `aegis-treasury:pre-tradeflow` before rebuilding and document the rollback command; merge new deployment keys with a script that asserts old keys are unchanged.
- Acceptance check: after `make deploy` on 31337 `tradeEscrow` exists; `docker image ls` shows the pre-TradeFlow tag; README names the rollback.
- Confidence: medium

### [Medium] V1. The release path never checks that the signer is the buyer's current Authorizer
- Evidence: `[S1] L308` and algorithm 7 `L495-501` omit the check; `[S1] L749` `checkRelease` skips signature checks; `[S1] L734` on-chain requires `registry.authorizer(buyer)`; owner can rotate or revoke without a freeze (`[S6] L102, L110`); revocation is the documented recovery (`[S1] L795, L807`).
- Broken behavior: after a documented recovery action the service keeps signing releases that can never execute.
- Failure scenario: owner revokes the Authorizer; a valid proof arrives; the Authorizer signs; only the final `eth_call` fails.
- Impact: stuck or looping milestone (feeds C7).
- Architecture fit: EXTEND the Authorizer checks and algorithm 7.
- Recommended change: require `registry.authorizer(buyer) == own address` before signing (also for DARs); reason `AuthorizerNotCurrent`, WAITING state.
- Acceptance check: revoke then valid proof: no signature requested, reason `AuthorizerNotCurrent`.
- Confidence: high

## Areas checked

Requirement traceability, contract consistency (EIP-712 types, functions, errors, events, check order, state machine), compatibility with the deployed AegisModule and PolicyRegistry, architecture fit, security boundaries (signature domains, replay, freezes, key placement, API trust), money movement and invariants, tenant isolation, concurrency and failure paths, rollout and rollback, test and evidence strategy. Sources: S1 (TD v0.3 L19-1162), S3, S4, S5, S6, S7, S8, S10, S11, S13, S14, S15. Baseline: HEAD f02d49e (TradeEscrow not implemented). Excluded as contamination: `docs/DESIGN-TRIBUNAL-technical-document-v0.1.md` and the "Changes from v0.1" tables in S1 and S2.

## Gaps and assumptions

- Supplier guarantee (G-N1): the buyer can stall release (rotate or revoke the Authorizer, owner freeze) and refund after the deadline even when valid proofs exist. The TD documents this as an accepted limitation (L846, L1130), and fixing it would add a release path without the Authorizer, which conflicts with approved decision 3. Needs an owner ruling on whether IDEA v1.2 L73 ("dana ... akan dilepas sesuai milestone yang disepakati") is binding for the competition build.
- G-C2: whether judges accept script-sent release hashes as Topic F agent execution. Resolve from the competition rules or organiser guidance.
- G-C6: CVM clock offset against Base Sepolia block time. Resolve by sampling for a few minutes.
- G-C7: whether a queued 120 s authorization can expire behind the serial Executor. Resolve with expected concurrency and measured receipt latency on 84532.
- G-C10: whether `DeployTradeEscrow.s.sol` can add keys to `deployments/84532.json` without re-serialising existing values. Resolve with a dry run and a diff.
- Owner gas for TradeFlow transactions on a 0.00005 ETH burner budget at demo-day fees. Resolve by measuring `createOrder` gas on Anvil.
- Base Sepolia RPC `eth_call` timestamp semantics (latest vs pending block). Affects only the frequency of C6.
