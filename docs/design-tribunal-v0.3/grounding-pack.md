# Grounding pack: design tribunal on TECHNICAL-DOCUMENT v0.3

Baseline: git HEAD f02d49e of /home/xavrir/fintechathon-2026 (TradeEscrow NOT implemented; the v0.3 TD is the uncommitted working copy and is the artifact under review).

## Scope fence
- TARGET:
  - T1 TradeFlow / TradeEscrow design: TD sections "TradeFlow architecture [Design v0.3]" (S1 L274-337), "On-chain enforcement (TradeEscrow) [Design v0.3]" (S1 L651-788), "TradeFlow threats [Design v0.3]" (S1 L837-854), TradeFlow parts of 03 Agent Design (S1 L357-521), test plan T1..T47 and E6 evidence plan (S1 L907-1111).
  - T2 Multi-tenant architecture as documented: S1 "Multi-tenant architecture [Built]" (L191-273), key separation/blast radius (L789-815), deployment (L857-906).
- SUPPORTING (findings only if they provably block/invalidate a TARGET behavior): AegisModule, PolicyRegistry, service (onboarding, sessions, tenants, authorizer, executor, exit agent, attacks), web onboarding and seats.
- EXCLUDED: landing page and dashboard visual design, pitch/market content, LLM provider/terms, deck/video, anything not in TD v0.3.

## Requirements and decisions (authority order)
1. Competition rules (Topic F; judged on real on-chain tx hashes 40%, security/compliance 30%, innovation/interaction 30%). Deadline 20 Oct 2026; TD sets code freeze 18 Oct.
2. Approved product requirements: docs/IDEA-merged.md v1.2 (S5) section 5 (TradeFlow use case and limits: escrowed supplier funds must never be invested; proof source integrity; kill switch = freeze further actions), section 17 (demo: one shipment, three milestones, one held on bad temperature/tampered proof).
3. Approved technical decisions (owner, 17 Oct): new TradeEscrow contract, no change to AegisModule/PolicyRegistry; owner funds orders via owner-signed Safe tx, the agent never funds; release needs issuer-signed MilestoneProof with on-chain condition checks (ConditionNotMet) AND Authorizer-signed ReleaseAuthorization (exact amount, proofHash, policyVersion, nonce, ~120 s expiry); payee fixed to supplier; bank freeze blocks releases and waivers, never refunds to the Safe; owner waive or refund after deadline; demo issuers are server keys labelled as stand-ins; ZK and IoT are roadmap.
4. Established repository contracts: S6..S14 below and docs/INTERFACES.md (S3), docs/MULTI-TENANT.md (S4).

## Source map (read these at the given locators; do not do broad repo discovery)
- S1 docs/TECHNICAL-DOCUMENT.md (v0.3, the artifact) - headings at lines: 19 Overview, 53 Product structure, 191 Multi-tenant [Built], 274 TradeFlow architecture [Design], 532 Role matrix, 562 Tiers, 587 Signed structures, 622 AegisModule enforcement, 651 TradeEscrow enforcement [Design], 789 Key separation, 837 TradeFlow threats, 907 Test cases, 1064 Evidence plan, 1088 Delivery plan and cut line, 1112 Known limitations, 1142 Changes from v0.2.
- S2 docs/TECHNICAL-DOCUMENT-v0.2.md (previous version; use only to see what changed; do NOT use its "Changes from v0.1" table as evidence).
- S3 docs/INTERFACES.md (v1 shared spec: contract APIs, EIP-712 field order, endpoints).
- S4 docs/MULTI-TENANT.md (v2 + v2.1 API details; implemented).
- S5 docs/IDEA-merged.md (v1.2 product requirements; sections 5, 8, 14, 16, 17).
- S6 contracts/src/PolicyRegistry.sol (register L58, setAuthorizer L102, revokeAuthorizer L110, ownerFreeze L115, bankFreeze L123, quarantine L131, _bump/policyVersion L158-161, freeze flags, bank tighten-only).
- S7 contracts/src/AegisModule.sol (EIP-712 typehashes L63-66, errors L85-105, deposit L124, redeem L140; check order; nonce set; everDeposited).
- S8 contracts/script/Deploy.s.sol (Safe infra: canonical addresses L21-23, non-canonical deploy on 31337 L119-132, setup sequence L64-89).
- S9 contracts/test (47 tests incl. invariant/ContainmentInvariant.t.sol, ReserveFloorInvariant.t.sol).
- S10 service/aegis/onboarding.py (config L63, fund L83, verify L180, activate L207, mint L243), tenants.py, sessions.py (session_message L21, create L51, bank_safes L88).
- S11 service/aegis/procs/authorizer.py (what the Authorizer signs and refuses; inert DAR for attacks), procs/executor.py (claim/send/record), procs/exit_agent.py, procs/keeper.py, supervisor.py (per-process keys).
- S12 service/aegis/attacks.py (per-tenant tampered/replay attack), runtime.py, workflow.py, core/ (planner, reserve, pipeline, validator).
- S13 service/aegis/config.py (roles and KEY_ENV, addresses, limits), deploy/tencent/ (compose, env example, README).
- S14 web/src/lib/onboard/ (runner.ts, safe.ts, messages.ts), web/src/lib/keys.ts (burner key storage), web/src/lib/session.ts.
- S15 deployments/84532.json, deployments/evidence-84532.json (8 recorded scenarios, real tx hashes).

## Excluded / contamination
- docs/DESIGN-TRIBUNAL-technical-document-v0.1.md (earlier tribunal conclusions) - EXCLUDED.
- "Changes from v0.1" tables in S1 and S2 (encode earlier reviewer conclusions) - EXCLUDED as evidence.
- docs/design-tribunal-v0.3/* other than this pack - EXCLUDED.
- No TradeEscrow implementation exists at baseline; no implementation contamination.

## Architecture-fit map (orchestrator, pre-review)
- TradeEscrow contract: NEW - S7 AegisModule only permits DEPOSIT/REDEEM with receiver hard-coded to the Safe (S7 L124-160); paying a third-party supplier would require changing the deployed module (owner decision forbids; existing 8 proofs and tenants depend on it). Reads PolicyRegistry (REUSE S6) for owner/bank/authorizer/freezes/policyVersion.
- Order funding via owner-signed Safe tx: REUSE Safe execTransaction path already used in onboarding (S14 safe.ts enableModule pre-validated sig; S8 setup). MultiSendCallOnly: UNRESOLVED until deployment on 84532 and 31337 is confirmed.
- ReleaseAuthorization signing: EXTEND Authorizer process (S11) which already signs DARs with nonce/expiry and refuses invalid plans.
- Release submission: EXTEND executor (S11) submission queue.
- Proof verification agent: EXTEND service core pipeline/validator (S12) and ledger.
- Committed/free treasury view: EXTEND reserve engine and treasury endpoint (S12, S3 GET /api/treasury).
- Tenant isolation for orders: EXTEND sessions/tenants scoping (S10, S4).
- Demo issuer keys: NEW role in config/supervisor (S13, S11 supervisor per-process keys).
- Evidence E6: EXTEND scripts/evidence_84532.py pattern and web evidence sync (S15).

## Candidate format (each critic)
title; proposed severity (Critical/High/Medium only); source locator (S-id + line/heading); scope link (TARGET item or proven link from SUPPORTING); broken requirement or necessary assumption; concrete failure scenario (inputs/state/sequence); impact; architecture disposition (REUSE/EXTEND/NEW/UNRESOLVED + seam); minimal design change; acceptance check (fails before, passes after); confidence; what evidence would disprove it.
