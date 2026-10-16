# Normalized candidate ledger (round 2 input)

Full candidate text: critic-a.md (A1..A6, GAP-1..2) and critic-b.md (B1..B8, G1..G3) in this folder. Merges keep every unique item of each source candidate.

| ID | Sources | Title | Proposed severity |
|---|---|---|---|
| C1 | A2 + B1 | The owner key sends API-supplied calldata (floor update today; TradeFlow resolution and order terms/issuers later), so an API-host compromise can take over any Safe; blast-radius claims L801/L814 false | High |
| C2 | A1 + B4 | E6 evidence plan: recorded by script with service stopped and before the Proof Verifier exists (cut line), contradicts "the service holds" (L1080 vs L1086); hashes show contract only, no agent trail | High |
| C3 | A5 + B3 | Demo issuer keys and INTERNAL_TOKEN leak to every child via the supervisor denylist; API (or Authorizer) alone can produce both release signatures; split-authority claims L188/L795/L799 overstated | High |
| C4 | B2 | Unauthenticated proof submissions with bad signatures become HELD, blocking automated release for any order (sequential ids); ledger/disk flooding; document size unbounded | High |
| C5 | A4 (a)(b) | Transient conditions (Frozen during bank freeze, OutOfOrder while previous release pending, PolicyVersionMismatch) become terminal HELD needing a new proof and owner; OrderNotActive has no reason code | Medium |
| C6 | A4 (c) + B6 | issuedAt time base unspecified; wall-clock vs block.timestamp makes fresh demo proofs fail BadProofTime | Medium |
| C7 | B5 | No terminal failure state / retry bound for release preflight or revert; possible loop re-signing and resubmitting; queued 120 s authorization can expire behind the serial executor | Medium |
| C8 | A3 | Owner confirmation (late release, corrected proof after hold) has no signed artifact the Authorizer can verify and is not bound to a proofHash | Medium |
| C9 | A6 + B7 | Public order view returns off-chain proofs, explanations and ledger refs for all tenants (sequential ids); contradicts T39 and the isolation rule | Medium |
| C10 | B8 | Rollout on freeze day: Deploy.s.sol rewrites deployments file (31337 loses tradeEscrow), missing ISSUER key crashes API start (load_key raises off 31337), mutable image tag gives no rollback | Medium |
| N1 | Orchestrator (new) | Supplier protection is not enforced: the buyer controls the release path (owner can setAuthorizer to a non-signing key, or ownerFreeze which blocks release and waive but not refund) and can refund all unreleased funds after the deadline even when valid issuer proofs for every milestone exist. See below. | High |

## N1 detail (orchestrator)
- Evidence: S1 L734 release check 8 requires a signature by registry.authorizer(buyer); S6 PolicyRegistry L102 setAuthorizer is onlyOwner(safe) (the buyer's owner); S6 L115 ownerFreeze onlyOwner; S1 L729 release blocked by owner freeze; S1 L745 waive blocked by freeze; S1 L747 refund needs only msg.sender == buyer and block.timestamp > deadline of milestone nextIndex, never checks freezes and never checks whether a valid proof was presented before the deadline.
- Requirement: S5 IDEA-merged v1.2 section 3/4 (problem-solution: "Pemasok tidak yakin akan dibayar -> Smart Escrow: dana pembayaran sudah dicadangkan sesuai perjanjian"; supplier persona wants certainty that funds are reserved and will be released per agreed milestones); S1 L65 positioning "pays the supplier only when a trusted issuer's proof shows a milestone is met".
- Failure scenario: Order funded 1,000. Carrier proof for milestone 1 is valid and submitted on day 2. Buyer owner calls ownerFreeze (or setAuthorizer(attackerKey) / revokeAuthorizer). No release or waive can execute. After deadline_0 (day 7) the buyer Safe calls refund and recovers 1,000 although the supplier shipped and the trusted carrier attested it.
- Impact: The escrow protects only the buyer; the supplier-side guarantee in the product requirement does not exist; incorrect money movement relative to the agreed terms (funds returned to the buyer for a milestone proven met).
- Disposition: EXTEND TradeEscrow design (no AegisModule change).
- Minimal change (one option): record the proof on-chain before the deadline (e.g. submitProof stores proofHash and issuedAt when the issuer signature and conditions verify); a milestone with a recorded valid proof can be released after a grace period without the buyer's Authorizer (proof-only path, supplier-callable), and refund() excludes milestones with a recorded valid proof; owner freeze must not block this proof-only path (bank freeze may, as a regulator stop, with a stated rule).
- Acceptance: contract test: valid proof recorded before deadline, buyer ownerFreezes and/or rotates authorizer, after deadline refund returns only unproven milestones and the supplier can claim the proven one after the grace period.
