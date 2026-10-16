# Verifier round 2: verdicts on C1..C10, N1 and new candidates (TD v0.3)

Artifact: docs/TECHNICAL-DOCUMENT.md v0.3 (S1, working copy). Baseline code: HEAD f02d49e.

Sources opened at locators: S1 L19-1162; S3 INTERFACES.md L150-160; S4 MULTI-TENANT.md L58-70, L108-116; S5 IDEA-merged.md L68-122, L167-201, L336-369; S6 PolicyRegistry.sol L25-70, L96-163; S11 supervisor.py L1-80, procs/executor.py L1-104, procs/authorizer.py L60-175, __main__.py L46, L70-85, api/app.py L425-440; S13 config.py L175-215, chain/rpc.py L133-172, deploy/tencent/docker-compose.yml L1-30, deploy/tencent/README.md (grep for rollback); service/Makefile L1-35; contracts/script/Deploy.s.sol L170-186; S14 web/src/pages/Treasury.tsx L1-110, web/src/lib/identity.tsx L170-200, L300-325, web/src/lib/onboard/signers.ts L1-40; S15 deployments/evidence-84532.json (scenario keys, E1, postconditions), service/scripts/evidence_84532.py L1-20, L330-350; service/tests/test_multitenant.py L626-634.

Live reads (read-only RPC, 17 Oct 2026): `eth_getCode` at the canonical MultiSendCallOnly v1.4.1 address `0x9641d764...02e2` on Base Sepolia returns code (selector `0x8d80ff0a` present); `contracts/lib/safe-smart-account/contracts/libraries/MultiSendCallOnly.sol` exists for the 31337 deploy. Five samples of the Base Sepolia latest block timestamp against this laptop's clock: lag 0, 1, 0, 2, 1 s.

Contamination note: while locating headings I displayed S1 L1164-1175 (the excluded "Changes from v0.1" table). I did not use it as evidence for any verdict.

## Verdict summary

| ID | Verdict | Final severity | Confidence |
|---|---|---|---|
| C1 | CONFIRMED | High | High |
| C2 | CONFIRMED | High | Medium-high |
| C3 | CONFIRMED | Medium | High |
| C4 | CONFIRMED | High | High |
| C5 | CONFIRMED (parts rejected) | Medium | Medium |
| C6 | CONFIRMED (skew size is a GAP) | Medium | Medium-high |
| C7 | CONFIRMED (queue expiry is a GAP) | Medium | Medium-high |
| C8 | CONFIRMED (corrected-proof part rejected) | Medium | Medium |
| C9 | CONFIRMED | Medium | High |
| C10 | CONFIRMED for (1) and (3); (2) REJECTED; JSON merge is a GAP | Medium | Medium |
| N1 | REJECTED (owner-decision GAP recorded) | n/a | High |
| V1 | CONFIRMED (new) | Medium | High |

---

## C1. Owner key sends API-supplied calldata; blast-radius claims L801/L814 are false

1. Source proof. S1 L814: "Funds still cannot leave any Safe except through TradeFlow orders that owners funded". S1 L801: "No single compromised component short of the owner's own key can move funds out of the treasury". S1 L301 reuses the floor path "as the obligation flow does today"; S1 L306 "The service only returns the calldata"; S1 L330 `resolution` returns "Safe transaction calldata for the owner key to sign and send". S3 L155 and S4 L112: `floorUpdate: {to, data, value}`. Code: Treasury.tsx L36 stores `res.floorUpdate`; L56 prefers `floorTx ?? api.floorUpdate()` over the local encoder at L57-58; L61 `sendTx(tx)`; L67-75 a decode failure falls back to the computed reserve, so the dialog at L79 still says `setReserveFloor`. identity.tsx L310-319 `sendTx` -> L316 `localTx` -> L190 `sender.send({to, data})`; signers.ts L19-25 sends with no target or selector check. S1 L295 and L849 pin only MultiSendCallOnly and TradeEscrow, and only for funding.
2. Material and in TARGET: yes. It falsifies the T2 blast-radius claims (L801, L814), and TradeFlow (T1, L306, L330) adds a second channel of the same shape.
3. Trigger: a compromised API process (in scope per S1 L529, analysed by S1 L814) returns `floorUpdate = {to: <tenant Safe>, data: execTransaction(<attacker>, 0, <payload>, operation = 1, ..., sig r = owner, s = 0, v = 1)}`. The API also controls `reserve.inSync`, so it can make the "Sign the new floor" button appear (Treasury.tsx L99-100). The owner clicks; the burner key sends; the pre-validated signature is valid because `msg.sender` is the owner (S1 L214).
4. Dependency: needs API compromise and one owner click. Both are inside the TD's own threat model. Not a GAP.
5. Disproof: none. S1 L1126 (Known limitations) covers only onboarding addresses for new tenants. No allowlist exists in the send path. An injected wallet shows the raw transaction, which helps only wallet users, not the default burner.
6. Seam: REUSE. The local encoder already exists (Treasury.tsx L57-58 against `deployment.registry`), and web/src/lib/onboard/safe.ts already encodes Safe transactions. No parallel architecture.
7. Decisions preserved: yes. The owner still signs every funding, waive and refund; the agent never funds.
8. Acceptance: a Vitest case where the mocked API returns `floorUpdate` with `to` = the Safe and `execTransaction` data. Before: `sendTx` is called with it (fails). After: nothing is sent and a refusal shows. T47 extended: a `resolution` response with a `data` field is ignored or refused and the calldata equals a local encoding to the pinned TradeEscrow. Fails before, passes after.

Sub-claim (A2): issuers and condition bounds taken from `GET /api/tradeflow/config` (S1 L299) are not pinned. True, but while the demo issuer keys sit on the same API host, substitution adds no new capability to a host attacker. Keep as a hardening item inside C1, not a separate finding.

Verdict: CONFIRMED. Severity High (the impact class is full Safe drain, but it needs full API-host compromise plus an owner click, and the remaining guard is a misleading owner dialog). Confidence high.

## C2. E6 as ordered cannot show the agent path that the TD and S5 require

1. Source proof. S1 L1110 cut line: "(2) deployment on 84532 and E6 recorded by the evidence script, which needs no UI; (3) Proof Verifier, Authorizer `/sign-release` and the API". S1 L1105 puts both on 18 Oct with exit criterion "E6 hashes in `evidence-84532.json`". S1 L1079 E6b "Authorizer-signed release"; S1 L1080 E6c "The service holds". S1 L49 maps Topic F conditional settlement to E6a-E6g. S5 L357 (authority 2): "AI membaca status pengiriman, memverifikasi bukti, menentukan jumlah yang boleh dilepas, lalu membayar di testnet ... AI Agent benar-benar mengelola dan mengeksekusi transaksi blockchain." S1 L1090: task completion (40%) is judged on transaction hashes. Existing pattern: evidence-84532.json E1 has `requestId`, `workflow`, `ledgerRef` and a transaction `from` with `role: executor`; evidence_84532.py L3-6 phase 2 runs the five processes.
2. Material and in TARGET: yes (T1 E6 plan and cut line). At step (2), no Proof Verifier or `/sign-release` exists, so E6b can only be signed by the script with the raw Authorizer key, and no component can "hold" in E6c.
3. Trigger: the team follows L1110 on 18 Oct and records E6 at step (2).
4. Dependency: GAP-1 (how judges read script-sent hashes) changes only the size of the impact. The S5 L357 requirement is enough on its own.
5. Disproof check: the "service stopped" text (S1 L1086) does not by itself contradict "the service holds". S1 L883 and evidence_84532.py L3-6 show that "stopped" means the hosted service while phase 2 runs local processes. So A1's "direct text conflict L1080 vs L1086" is weaker than claimed. The decisive proof is the cut-line order. Nothing in the TD says E6 is re-recorded after step (3).
6. Seam: EXTEND evidence_84532.py phase 2. Not new.
7. Decisions preserved: yes.
8. Acceptance: a schema check of `evidence-84532.json`: E6b and E6e carry `requestId`, a workflow list with `PROOF_VERIFIED`, `RELEASE_SIGNED`, `RELEASED`, `ledgerRef` rows, and a release `from` equal to the Executor role; E6c carries a `MILESTONE_HELD` row with `ConditionNotMet` before the forced-submit hash. Fails on the current plan, passes after the reorder (or after the rows are relabelled "contract path, script-signed").

Also valid: S1 L1081 E6d leaves two branches ("waive ... or a corrected sensor proof"); the evidence content should be fixed to one.

Verdict: CONFIRMED. Severity High. Confidence medium-high.

## C3. Demo issuer keys and INTERNAL_TOKEN reach processes that must not hold them; split-authority claims overstated

1. Source proof. supervisor.py L19-20 `SECRETS` is a fixed denylist; L34-35 `child_env` passes every other variable to every child. S1 L334 "live in the API process only"; S1 L889 deploy step: "add the three demo issuer keys to `aegis.env`, rebuild", with no supervisor change named. M12 (test_multitenant.py L626-634) checks only names ending in `_KEY` from a fixed base set, and checks `INTERNAL_TOKEN` only for `exit_agent`. S1 L812 says `INTERNAL_TOKEN` holders are API, Authorizer and Exit Agent; the code also gives it to Executor and Keeper (it is not in `SECRETS`). S1 L795: "a release also needs a valid issuer proof"; S1 L799: "A release still needs the Authorizer"; S1 L75 and L188 split authority.
2. Material and in TARGET: yes (T2 key separation L789-815; T1 demo issuers).
3. Trigger: (a) ISSUER_*_KEY added to `aegis.env` per L889 reaches the Authorizer, Executor, Exit Agent and Keeper. The Authorizer process alone then holds both signatures for every demo-issued milestone of every tenant. (b) Even with correct scoping, the API process holds the issuer keys and `INTERNAL_TOKEN`: it signs a conforming proof, asks `/sign-release`, and the Authorizer's re-verification passes because the proof is genuinely valid.
4. Dependency: (a) needs the implementer not to edit `SECRETS`; the TD gives no instruction and no test catches it, so the omission is proven. (b) has no dependency.
5. Disproof check: S1 L814 already concedes the API host holds every key, and S1 L1131 says demo issuers prove only the authorization path. So the host-level result is conceded. The process-level claims in L795, L799 and mechanism 5 are not. Payee and amount stay fixed, so funds go only to the owner-chosen supplier. This bounds the severity at Medium (Critic B proposed High).
6. Seam: EXTEND supervisor `SECRETS`/`OWNED` and config `KEY_ENV`. Not new.
7. Decisions preserved: yes (demo issuers stay server keys labelled as stand-ins).
8. Acceptance: M12 extended with `ISSUER_CARRIER_KEY`, `ISSUER_SENSOR_KEY`, `ISSUER_SURVEYOR_KEY` in the base. Before: `secret(child_env("authorizer"))` contains them (fails). After: only the API child has them, and `child_env("executor")` and `child_env("keeper")` lack `INTERNAL_TOKEN`. Text change: L799 states that in the demo a compromise of the API process alone can obtain releases for demo-issued milestones.

Verdict: CONFIRMED. Severity Medium. Confidence high.

## C4. Anyone can force HELD with an unsigned proof and stop automated release for every order

1. Source proof. S1 L305 "If a check fails, the milestone is HELD"; S1 L327 `POST /proofs` caller "Anyone"; S1 L429 HELD reasons include `ProofMismatch` and `BadIssuerSignature`; S1 L430 after a hold, no release on a later proof until the owner confirms; S1 L421-423 HELD exits; S1 L684 and L722 sequential order ids; S1 L332 "proof submissions 30 per order per hour" (keyed per order, not per caller); S1 L327 `document?` with no size bound; S1 L155 one ledger for all tenants; S1 L266 512 MB container.
2. Material and in TARGET: yes. It defeats the automated verify-and-pay behaviour (S5 L357) for any order of any tenant, from an unauthenticated caller.
3. Trigger: an anonymous POST of `{index: nextIndex, proof: <any>, signature: <random 65 bytes>}` to each active order id. The Proof Verifier fails check 4 and records HELD. The real proof then needs the owner. Additionally, 30 junk posts per hour exhaust the per-order limit, so the real issuer's or supplier's submission is refused for that hour.
4. Dependency: none.
5. Disproof check: S1 L327 "the issuer signature is the authority" states the intent, but L429 and L305 contradict it. No TD rule requires a valid issuer signature before a hold.
6. Seam: EXTEND the Proof Verifier and the `/proofs` endpoint. Not new.
7. Decisions preserved: yes. A validly signed out-of-range sensor proof still holds with `ConditionNotMet`.
8. Acceptance: as B2. An unsigned or wrongly signed proof, then a valid issuer proof: before, the milestone is HELD and no Authorizer call happens (fails); after, the first call gets 4xx with no ledger row and the valid proof reaches `RELEASE_SIGNED`. A document above the stated cap gets 413. Add: junk submissions do not consume the rate budget of signed submissions.

Verdict: CONFIRMED. Severity High (zero-cost, cross-tenant, repeatable; owner confirmation is a per-milestone manual workaround that the attacker can re-trigger). Confidence high.

## C5. Transient conditions become terminal holds

1. Source proof. S1 L429 lists `Frozen` and `OutOfOrder` as HELD reasons; S1 L421-423 HELD exits only by waive, new proof plus owner confirmation, or refund; S1 L430; S1 L495-496 (algorithm 7 steps 1 and 2). No `OrderNotActive` reason exists in L429 although step 1 can fail.
2. Material and in TARGET: yes, as an operability gap. A bank unfreeze (the bank's control, S1 L37) does not resume the milestone; the owner must confirm and a proof must be posted again.
3. Trigger: (a) a valid proof posted while the buyer is bank-frozen; (b) a milestone 2 proof posted while the milestone 1 release is `RELEASE_SUBMITTED` (on-chain `nextIndex` is still 0).
4. Dependency: none for (a) and (b).
5. Disproof and rejected parts: A4 says "T43 stalls at E6e". Not proven: `POST /confirm` (S1 L329) and the L422 edge give a path, so T43 needs one extra owner step, not a stall. `PolicyVersionMismatch` is not a Proof Verifier check (algorithm 7, L495-501, has no version check), so it is not a HELD cause; it belongs to C7. Part (c) (`issuedAt` time base) is handled in C6. The TD could intend owner re-confirmation after a freeze; it does not say so, so the finding stands at medium confidence.
6. Seam: EXTEND the workflow state machine with a waiting state (the treasury workflow already returns to `STATE_LOADED` on changed conditions, S1 L405-406).
7. Decisions preserved: yes. A freeze still blocks the release on-chain; a waiting state only defers.
8. Acceptance: a proof posted while bank-frozen is released after `bankUnfreeze` with a fresh authorization and no owner confirmation; a milestone 2 proof posted before milestone 1 is mined is released after it. Both are HELD before and pass after.

Verdict: CONFIRMED (parts rejected as above). Severity Medium. Confidence medium.

## C6. `issuedAt` and "now" have no defined time base

1. Source proof. S1 L499 `order.createdAt <= proof.issuedAt <= now` with "now" undefined; S1 L308 "the issue time is within range", range undefined; S1 L328 demo issuer signs on request; S1 L732 on-chain check uses `block.timestamp`; S1 L749 `checkRelease` is a view at the latest block. Built: authorizer.py L92 takes "now" from `chain.block_timestamp()`; rpc.py L168-172 returns the latest block timestamp on 84532 but `max(chain, wall)` on 31337.
2. Material and in TARGET: yes (T1 Proof Verifier, demo issuers, live demo, E6).
3. Trigger: the demo issuer sets `issuedAt = int(time.time())`; the Verifier or Authorizer compares against the latest block. Measured lag of Base Sepolia's latest block behind a wall clock: 0 to 2 s, with 3 of 5 samples behind. Then `BadProofTime`, which is a terminal HELD (S1 L429-430).
4. Dependency: how often it fires depends on the CVM clock offset (GAP, see G-C6). The missing specification is proven without it.
5. Disproof: none in the TD. Note a masking effect: on 31337 `block_timestamp()` uses wall time, so T43 on Anvil can pass while 84532 fails.
6. Seam: EXTEND the demo issuer signer and the Proof Verifier using the existing `chain.head_timestamp()`/`block_timestamp()`. Not new.
7. Decisions preserved: yes.
8. Acceptance: a fake-chain test with the chain timestamp 2 s behind wall time: before, the demo "valid" proof is HELD `BadProofTime` (fails); after, the issuer uses `max(order.createdAt, latest block timestamp)` and the proof verifies.

Verdict: CONFIRMED. Severity Medium. Confidence medium-high.

## C7. No terminal failure state or retry bound for a failed release

1. Source proof. S1 L419-420: `RELEASE_REVERTED -> PROOF_RECEIVED` with no bound, and no edge at all for a preflight failure between `RELEASE_SIGNED` and `RELEASE_SUBMITTED`; S1 L304 Executor preflight; S1 L787 "the service signs a new one after re-verification" (a retry rule with no bound). Built: executor.py L52-54 marks a failed preflight `failed` with no workflow callback; L14 `RECEIPT_TIMEOUT = 60`; L97-103 one serial queue.
2. Material and in TARGET: yes (T1 milestone state machine).
3. Trigger, deterministic: the owner revokes or rotates the Authorizer (an action the TD names as recovery, S1 L795, L807). The Verifier, the Authorizer and `checkRelease` all pass (see V1), and the final signed `eth_call` fails `BadSignature` every time. The milestone either sticks in `RELEASE_SIGNED` or loops re-sign and resubmit, depending on how the implementer maps it.
4. Dependency: the "120 s authorization expires behind the serial queue" part depends on load and receipt latency (GAP G-C7). The rest does not.
5. Disproof: none; L787 supports the finding.
6. Seam: EXTEND executor submission kinds and the milestone workflow. Not new.
7. Decisions preserved: yes.
8. Acceptance: as B5. `checkRelease`/preflight returns `BadSignature` on every attempt: before, more than 3 Authorizer calls in N ticks or no terminal state (fails); after, HELD with `ReleaseFailed:BadSignature` after one attempt and one ledger row per transition. A single `policyVersion` bump gives one re-sign then `RELEASED`.

Verdict: CONFIRMED. Severity Medium. Confidence medium-high.

## C8. Owner confirmation of a late release has no verifiable form

1. Source proof. S1 L308 lists "the pending milestone's deadline has not passed unless the owner confirmed a late release" as an Authorizer check; S1 L329 `/confirm` is an owner-session API call with no signature; S1 L267 and __main__.py L46: the Authorizer has its own database; the built Authorizer accepts owner intent only as EIP-712 signatures it recovers (authorizer.py L141-158). T37 (S1 L1052) expects a refusal "without owner confirmation".
2. Material and in TARGET: yes, as a contract inconsistency. The TD presents an independent check whose only input is an API claim.
3. Trigger: a compromised API process (with `INTERNAL_TOKEN`) sends `ownerConfirmed: true` after the deadline; the Authorizer signs.
4. Dependency: none.
5. Disproof and rejected part: the corrected-proof gate (S1 L430) is not claimed as an Authorizer check, and S1 L434 says these rules are "workflow policy, not a security boundary". That part of A3 is rejected. Impact of the remaining part is limited: on-chain `release` ignores the deadline (S1 L743), payee and amount are fixed, and the API process can already obtain demo-issued releases (C3).
6. Seam: EXTEND the Authorizer pattern (owner EIP-712 signature), or the minimal change: reword L308 and T37 to say the late-release confirmation is API-reported workflow policy.
7. Decisions preserved: yes either way.
8. Acceptance: T37 extended. With a signed artifact: a request with `ownerConfirmed: true` and no owner signature is refused, and a signature over another `proofHash` is refused. Fails before (no such input exists), passes after.

Verdict: CONFIRMED. Severity Medium. Confidence medium.

## C9. Public order view exposes off-chain data of every tenant

1. Source proof. S1 L326: callers "Owner or bank session of the buyer; a public read-only view for the supplier page", purpose "Terms, milestone status, proofs and ledger references. On-chain order data is public anyway". S1 L1054 T39: "Tenant B cannot list, read ... tenant A's orders". S1 L239: "Every endpoint ... read the Safe from the session only". S1 L830. S1 L684 sequential ids. S1 L305: a held proof is never sent on-chain.
2. Material and in TARGET: yes (T1 API, T2 isolation rule). The spec is internally inconsistent; an implementer must guess.
3. Trigger: unauthenticated `GET /api/tradeflow/orders/1..N`.
4. Dependency: none.
5. Disproof check: released proofs are in release calldata and are public. Held proofs, hold reasons, ledger references and explanation text are not.
6. Seam: EXTEND session scoping; split the projection. Not new.
7. Decisions preserved: yes.
8. Acceptance: T39 extended with an unauthenticated request and a tenant B session: before, `proofs`/`ledgerRefs`/explanation fields are returned (fails); after, only on-chain fields.

Verdict: CONFIRMED. Severity Medium. Confidence high.

## C10. Rollout on freeze day

1. Source proof. (1) service/Makefile L24-25: `make deploy` runs only `Deploy.s.sol`; Deploy.s.sol L183-184 `vm.writeFile` replaces the whole file; S1 L887 local sequence has no TradeFlow step. (2) S13 config.py L193-204 `load_key` raises off 31337. (3) docker-compose.yml L7-10 builds and tags `aegis-treasury:latest`; deploy/tencent/README.md has no rollback text; S1 L1110 "After the freeze, the hosted service changes only by rollback".
2. Material and in TARGET: T2 deployment (L857-906). (1) and (3) are proven operability omissions with workarounds (run both scripts; rebuild from f02d49e).
3. Trigger: (1) any `make deploy` rerun on 31337 drops `tradeEscrow`, `multiSendCallOnly`, `issuers`; (3) a bad 18 Oct build of the [Built] service with no tagged previous image.
4. Dependency: the 84532 JSON merge depends on how `DeployTradeEscrow.s.sol` writes the file (GAP G-C10).
5. Disproof of (2): the built pattern loads optional keys lazily at the point of use (onboarding.py L60 `has_key`, L141 `load_key`; attacks.py L36), and the TD does not say the issuer keys load at start. A start crash is not implied. (2) REJECTED.
6. Seam: EXTEND Makefile and deploy/tencent. Not new.
7. Decisions preserved: yes.
8. Acceptance: (1) after `make deploy` on 31337, `tradeEscrow` exists in `deployments/31337.json`; (3) `docker image ls` shows a pre-TradeFlow tag and the README names the rollback command. Both fail before, pass after.

Verdict: CONFIRMED for (1) and (3); (2) REJECTED; merge is a GAP. Severity Medium. Confidence medium.

## N1. Buyer controls the release path and can refund proven milestones

Facts verified as true: S6 L102 `setAuthorizer` is `onlyOwner`; S6 L110 `revokeAuthorizer` owner or bank; S6 L115 `ownerFreeze` `onlyOwner`; S1 L729 and L745 a freeze blocks release and waive; S1 L747 refund checks only caller, status and deadline.

Why REJECTED as a finding:
- The TD states this exact behaviour as an accepted residual risk and a known limitation: S1 L846 ("The supplier is protected by the lock until the deadline and by the fixed payee, not by a guaranteed payout", residual "Open question") and S1 L1130 (planned improvement: "Record proven milestones on-chain so a refund cannot cover them"). It is not an undocumented defect.
- The cited requirement does not prove a guarantee. S5 L88 maps "Pemasok tidak yakin akan dibayar" to "Smart Escrow: dana milestone dikunci" (funds locked), which the design delivers. S1 L65 states a necessary condition ("pays ... only when"), not a sufficient one.
- The proposed change adds a release path without the Authorizer signature. That contradicts approved decision 3 ("release needs issuer-signed MilestoneProof ... AND Authorizer-signed ReleaseAuthorization"; "owner waive or refund after deadline").
- "Incorrect money movement" fails: a refund after the deadline is an approved term, and it returns funds only to the buyer Safe.

Residual GAP (owner decision, not tribunal evidence): S5 L73 lists the supplier need as "dana ... akan dilepas sesuai milestone yang disepakati". If the owner rules that this is a binding requirement for the competition build, it outranks decision 3 (authority 2 over 3) and the L1130 improvement becomes in scope. Evidence that resolves it: an explicit owner statement on S5 L73.

## V1 (new). The release pipeline never checks that the Authorizer is the buyer's current registry authorizer

- Proposed severity: Medium
- Source locator: S1 L308 (Authorizer release checks: no check that its own address equals `registry.authorizer(buyer)`); S1 L495-501 (algorithm 7: no such check); S1 L749 (`checkRelease` skips checks 5 and 8, the two signature checks); S1 L734 (on-chain check 8 requires `registry.authorizer(buyer)`); S6 L102 and L110 (owner can set or revoke the Authorizer without a freeze); S1 L795, L807 (revocation is the documented recovery action). Built: authorizer.py L79-170 (DAR path also has no such check; `module_check` excludes signatures).
- Scope link: TARGET T1 (Authorizer checks, Proof Verifier, milestone state machine) and T2 (shared Authorizer key, revocation as recovery).
- Broken requirement or assumption: "Fail closed" (S1 L91) and "If a check fails, the milestone is HELD" (S1 L305) assume every deterministic failure is detected before signing.
- Concrete failure scenario: a tenant owner calls `revokeAuthorizer` (owner path sets the authorizer to zero with no freeze) or `setAuthorizer(newKey)` after suspecting a compromise. A valid proof arrives. Algorithm 7 passes, the Authorizer signs (none of its listed checks fail), `checkRelease` passes (it skips signatures), and only the Executor's final signed `eth_call` fails `BadSignature`. The milestone has no defined state for this (C7) and the shared service keeps signing releases that can never execute.
- Impact: a stuck or looping milestone after a documented recovery action, with Authorizer and ledger noise. No funds move.
- Architecture disposition: EXTEND the Authorizer `/sign-release` checks and algorithm 7 (one registry read).
- Minimal design change: add "`registry.authorizer(buyer)` equals the Authorizer's own address" to L308 and to algorithm 7 step 2, with HELD (or WAITING) reason `AuthorizerNotCurrent`. Apply the same check before signing DARs.
- Acceptance check: a service test where the owner revokes the Authorizer and then a valid proof arrives. Before: the Authorizer signs and the preflight fails `BadSignature` (fails). After: no signature is requested, and the milestone carries `AuthorizerNotCurrent` with one ledger row.
- Confidence: high (text and code read).
- What would disprove it: a TD check, anywhere before signing, that compares the signer with `registry.authorizer(buyer)`. None found.

Gate: (1) proven by the omission at L308, L495-501, L749. (2) material inside TARGET. (3) trigger: owner revocation or rotation. (4) no dependency. (5) no source disproves it. (6) EXTEND, no parallel path. (7) preserves decisions. (8) test fails before, passes after. Verdict: CONFIRMED. Severity Medium. Confidence high.

## GAPs carried forward

- G-C2 (= Critic A GAP-1): how judges read script-sent release hashes as Topic F agent execution. Affects only the size of C2. Resolved by the competition rules text or organiser guidance.
- G-C6 (= Critic A GAP-2): the CVM clock offset from Base Sepolia block time during the demo. Affects how often C6 fires. Resolved by sampling `date +%s` on the CVM against `eth_getBlockByNumber latest` for a few minutes.
- G-C7: whether a queued 120 s authorization can expire behind the serial Executor. Resolved by the expected number of concurrent submissions and the receipt latency on 84532.
- G-C10 (= Critic B G2): whether `DeployTradeEscrow.s.sol` can add keys to `deployments/84532.json` without re-serialising existing values. Resolved by a dry run that diffs the file.
- G-N1: owner ruling on S5 L73 (see N1).
- Critic B G1 (owner gas) and G3 (provider `eth_call` timestamp semantics) remain open and do not change any verdict above.

Architecture-fit item resolved: MultiSendCallOnly is no longer UNRESOLVED. On 84532 the canonical v1.4.1 address has code (read 17 Oct 2026); on 31337 the source is in `contracts/lib/safe-smart-account`. Disposition: REUSE on 84532, deploy from lib on 31337, as S1 L295 states.

## Target completeness pass

### T1 TradeFlow / TradeEscrow

| Item | Status | Evidence |
|---|---|---|
| Contract and interface | CONFIRMED FINDING (C6, V1); otherwise SATISFIED | State, functions, check order, errors, events and EIP-712 type strings are specified (S1 L651-788, L607-620). Missing: time base for `issuedAt`/"now" (C6); current-authorizer check (V1). |
| Authorization and tenant boundary | CONFIRMED FINDING (C1, C3, C4, C8, C9) | API calldata sent by the owner key (C1); issuer keys and `INTERNAL_TOKEN` placement (C3); anonymous state change to HELD (C4); unverifiable late-release confirmation (C8); public view vs T39 (C9). |
| Size bounds | CONFIRMED FINDING (C4) | Order and proof rate limits exist (S1 L332), but the uploaded `document` has no size cap and the per-order limit is shared by attackers and real issuers. |
| Owning seam | SATISFIED | TradeEscrow NEW (justified: AegisModule fixes the receiver to the Safe); Authorizer, Executor, Proof Verifier, reserve view and evidence script are EXTEND. The Executor release submission shape is not specified, but the EXTEND seam is named; not material. |
| Required data projection | CONFIRMED FINDING (C9); otherwise SATISFIED | Cash, Committed, Free are defined (S1 L310-318, L484-492); bank desk projection defined (L332). The public order projection is undefined. |
| Executable acceptance evidence | CONFIRMED FINDING (C2, C5, C7) | T1-T47 cover the contract well. Missing: agent trail for E6 (C2); service tests for transient holds (C5) and release failure bounds (C7); tests named in C1, C3, C4, C9 and V1. |

### T2 Multi-tenant architecture as documented

| Item | Status | Evidence |
|---|---|---|
| Contract and interface | SATISFIED | S1 L191-273 match S4 L58-70, L108-116 and the code read. The `floorUpdate {to, data, value}` contract is the root of C1. |
| Authorization and tenant boundary | CONFIRMED FINDING (C1, C3) | L801 and L814 are false under a compromised API (C1). L812 says `INTERNAL_TOKEN` is held by three processes; the supervisor gives it to all five (C3). |
| Size bounds | SATISFIED | Abuse limits table (S1 L244-257) with defaults; tenant cap 300. |
| Owning seam | SATISFIED | Sessions, tenant store, supervisor and Authorizer `UnknownSafe` are the built seams (S1 L236-240). |
| Required data projection | SATISFIED | Session-scoped stream, ledger, requests and bank client list (S1 L239). |
| Executable acceptance evidence | CONFIRMED FINDING (C3, C10) | M12 checks only `_KEY` names and `INTERNAL_TOKEN` only for the Exit Agent (test_multitenant.py L626-634). Deployment has no rollback artifact and `make deploy` drops TradeFlow keys on 31337 (C10). |
