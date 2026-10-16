# Porthmos UX Reference

Research date: 2026-10-16. Sources are public pages only. "Not visible publicly" means the page or docs did not show it. Pages that returned 403/404 to our fetcher are noted; their claims come from search snippets and are marked.

## 1. Per-product findings

**Escrow.com**
URLs: https://www.escrow.com/
- Hero has a quick-start form (Buying / Selling / Brokering, amount, currency) so the first action is starting a deal, not reading.
- Each use-case tile shows the same 5-step flow: agree terms, buyer pays, seller delivers, buyer approves, Escrow.com pays seller.
- Trust stack: "$8.3B+ processed" and "3.9M+ customers", then licensing section ("licensed, bonded and regularly audited").
- Avoid: fees are hidden behind a "Fee Calculator" link; no amount on the home page.

**Tazapay**
URLs: https://tazapay.com/escrow (403 to our fetcher; content via search), https://www.pymnts.com/?p=1152420
- Escrow explained as 5 steps: send request, seller accepts, buyer pays, funds held, seller submits proof document, release.
- Milestone payments are offered for staged contracts (per search summary).
- Avoid: FX pricing is quote-based and reviewers call it opaque (https://wise.com/sg/blog/tazapay-review).

**Flexport**
URLs: https://www.flexport.com/videos/shipment-details/, https://www.flexport.com/products/visibility/
- Vertical center timeline, booking to delivery; estimated dates turn into actual dates as events occur.
- Header carries plain-language status ("in transit to arrival port") and a predicted delivery date with day countdown.
- Legs expand to show vessel, transit time, container status. Customs gets its own milestones.
- Right-side inbox pins open tasks with due dates (for example an exception needing consignee action).
- Dashboard groups exceptions by category and ranks them low/medium/high urgency.
- Avoid: dashboard has many sections (Shipments, POs, Containers, Customs, Demurrage...) and delivery of alerts is not explained.

**TradeTrust (IMDA)**
URLs: https://www.tradetrust.io/ (verifier at ref.tradetrust.io)
- "Verify a Document" sits in the top nav and as a drag-and-drop card; checks are named: origin, tampering, authenticity, title transfer.
- "Benefits by role" section (banker, importer/exporter, carrier, platform).
- Gallery of sample documents with QR verification.
- Avoid: no explanation of what the verifier result looks like or how checks work; claims are self-reported (42,000 companies, 27 countries).

**Surecomp RIVO**
URLs: https://www.finextra.com/pressarticle/92657/surecomp-unveils-trade-finance-platform-rivo, https://surecomp.com/news/surecomp-unveils-rivo-the-most-comprehensive-collaborative-trade-finance-platform-to-drive-global-trade (product page 404; in-app UX not visible publicly)
- Corporates see credit lines and utilisation across banks in one place; banks manage finance requests for many corporates.
- Free plan plus tiers, so pricing is a ladder.
- Avoid: positioned as middleware; no screenshots found, so there is nothing visual to learn from.

**WaveBL**
URLs: https://wavebl.com/
- Carrier logo strip right under the hero ("Trusted by leading ocean carriers"), then standards badges (DCSA, UNCITRAL, ISO 27001).
- "Verify an eBL" in the nav.
- Parties outside the network can act through secure email, which lowers supplier onboarding friction.
- Avoid: no step-by-step eBL flow on the page; "65% market share" is given without a measurement basis.

**Stripe (Dashboard, Connect)**
URLs: https://docs.stripe.com/dashboard/basics, https://docs.stripe.com/connect/dashboard, https://stripe.com/connect
- Home page surfaces notifications (unresolved disputes, identity checks) above charts, with widgets the user can edit.
- Connected accounts list uses status badges: Restricted, Restricted soon, In review, Enabled, Rejected. Hover explains, tabs group by status, and an "Actions required" list tops the detail page.
- Fees are shown inside demo receipts (base fee, platform cut, payee share) rather than a fee section.
- Connect landing shows two views: connected-user (balance, payouts) and platform admin (accounts needing review).
- Avoid: product sprawl (Radar, Sigma, Atlas...) makes the nav heavy.

**Ramp**
URLs: https://ramp.com/accounts-payable
- Approval orchestration section: route each bill to the right approver up to CFO; a role card lists permissions ("See bills / Review bills / Make payments").
- Fees live in the FAQ and footnotes with real numbers (for example $0.59 standard ACH), with a link to full pricing.
- Stat claims carry footnotes naming their source.
- Avoid: page shows few real UI screenshots; mostly short videos.

**Mercury**
URLs: https://mercury.com/, https://support.mercury.com/hc/en-us/articles/28768929696788-Enabling-dual-admin-approvals, https://support.mercury.com/hc/en-us/articles/31277592110356-Navigating-Approvals
- Approval rules: amount thresholds, stackable levels, named approvers; self-approval is skipped; separation of duties in the newer article.
- Pending approvals appear in an Action Bar on the dashboard and by email to admins.
- Headline pricing "$0/month" with footnotes; disclaimer states Mercury is not a bank, partner banks named.
- "Launch demo" link next to the signup CTA.
- Avoid: hero uses abstract illustrations instead of the real product.

**Safe{Wallet}**
URLs: https://safe.global/wallet, https://help.safe.global/en/articles/40817-cancel-transactions, https://help.safe.global/articles/3608612277-reject-and-delete-transactions
- Four-step flow shown on the landing page: Propose, Verify, Sign, Execute.
- Threshold rules enforced onchain; signers confirm in a queue; Execute is a separate step once the threshold is met.
- Reject is an onchain cancellation that needs signers; Delete is an offchain removal by the proposer only.
- Nav links to audits, bug bounty, status page.
- Avoid: the help article for the queue itself was not reachable, and queue exact UI is not visible in public pages; "Pro" feature gating blurs what the base product does.

**Circle (CPN)**
URLs: https://circle.com/cpn
- Hero names the settlement asset ("Settled in stablecoins") and says who can join (eligibility reviewed per jurisdiction).
- Stats stamped with a date ("as of August 5, 2026"): 175+ institutions, 55+ licenses.
- Participant logo bar and case studies.
- Avoid: no fees or pricing; flow is described as Send / Receive / Manage, not as a concrete sequence.

**Request Finance**
URLs: https://www.request.finance/ (403 to our fetcher); search summary only
- Fiat-denominated invoices paid in crypto; real-time payment status from onchain data; batch payments.
- Avoid: approval workflow and audit trail claims appear only in third-party directories, so they are not verified.

**Bridge**
URLs: https://www.bridge.xyz/
- Four product cards (Orchestration, Issuance, Cards, Wallets), then use-case solutions.
- Regulated entities named by jurisdiction in the footer.
- Avoid: no pricing, no product screenshots, no code sample on the page.

**Settle**
URLs: https://www.settle.com/
- Hero visual is a real vendor bill ($28,480) with Pay and Finance buttons.
- PO, goods receipt, invoice three-way matching before money leaves; SOC 2 Type II with Trust Center link.
- FAQ states plans ($0 and $199/month) and "no transaction fees".
- Avoid: financing placement in the flow is unclear on the page.

**Tradeshift**
URLs: https://tradeshift.com/
- Trust built from named certifications (Peppol Access Point since 2014, France registration) and scale (about 10M invoices/month).
- Country deadline cards make urgency concrete.
- Avoid: the hero sells compliance deadlines, so the buyer value is hard to find; no pricing.

**Kyriba**
URLs: https://www.kyriba.com/
- Named chart types in the treasury view: Cash Balances by Bank, Cash Positioning, Cash Forecast with AI, FX Exposure.
- Pillars: Connect, Protect, Forecast, Optimize.
- Avoid: hero stats read "0%" for risk elimination, which looks like an error and kills credibility.

**Etherscan (tx details, audit reference)**
URLs: https://kb.etherscan.com/viewing-transactions-on-etherscan
- Top row: status (Success green / Failed red), block, timestamp; then from, to, value, fee. Logs tab shows emitted events.
- Avoid: raw hex and gas fields mean nothing to a finance user.

## 2. Ten best patterns for Porthmos

**Landing page**
1. Deal-first hero: a mini-form (amount, currency, supplier) or demo link beside the headline (Escrow.com, Mercury "Launch demo").
2. One diagram, one flow, repeated: the 5-step escrow strip is the proof of understanding. Porthmos version: Lock, Handed to carrier 20%, Arrived 40%, Quality accepted 40%, with "who must act" per step (Escrow.com; Tazapay).
3. Fees with real numbers on the home page or FAQ, with footnotes, not behind a calculator (Ramp, Settle; avoid Escrow.com).
4. Dated, sourced proof: stats with an "as of" date and verified-on-chain contract links, plus audit/status links in nav (Circle, Safe).

**Importer app**
5. Vertical milestone timeline: estimated date becomes actual date; plain-language status; predicted completion countdown; task inbox with due dates (Flexport). Show 20/40/40 as three legs that expand to proof.
6. Cash vs committed vs free funds: three clearly labelled balances before any chart, with Kyriba-style named charts (Cash Positioning, Forecast) below. Source for balance split idea: Stripe Home notifications first, charts second (https://docs.stripe.com/dashboard/basics). The "committed" split itself is Porthmos-specific.
7. Release/hold as a queue: Propose, Verify, Sign, Execute steps with a separate Execute and clear Reject vs Delete semantics (Safe). Pending items in an Action Bar (Mercury).

**Supplier portal**
8. Low-friction supplier: status badges with "Actions required" list at top (Stripe Connect) plus a view of money coming and when; allow acting without joining the whole network (WaveBL email flow).

**Bank oversight**
9. Risk-officer list of client agents with status tabs (Enabled, Needs review, In review, Frozen) and urgency-ranked exceptions (Stripe Connect, Flexport). Approvals with thresholds, stacked levels, separation of duties (Mercury).

**Audit/proof**
10. Human summary first, chain detail second: Success/Failed status, timestamp, amount, then "View on explorer" and event logs (Etherscan). Add a Verify-a-document drop zone with named checks: origin, tampering, authenticity, title (TradeTrust).

## 3. Recommended landing page information architecture

1. Nav: Product, How it works, Fees, Security and audits, Verify a document, Demo.
2. Hero: "Pay suppliers only when the goods are proven." One CTA, one demo link, one small deal form.
3. Flow strip: Lock, 20%, 40%, 40% with who acts and what proof releases each step.
4. Proof of release: show a sample signed document or eBL, and the verify-a-document card.
5. Treasury agent: three balances (cash, committed, free) and the "invests only free cash" rule.
6. Bank oversight: freeze, revoke, approve escalations, with a screenshot of the risk-officer list.
7. Role cards: importer, supplier, bank risk officer, one line each.
8. Audit trail: sample transaction receipt with link to Base Sepolia explorer; label clearly as testnet.
9. Fees: real numbers and an example order.
10. Trust: contract addresses, audit status (say "not audited" if so), status page.
11. FAQ: custody, disputes, what if proof is rejected, testnet limits.
12. Closing CTA and legal disclaimers.

## Caveats
- Tazapay, Request Finance, Circle `/cross-border-payments-network`, Surecomp product page, Escrow.com `/how-it-works` and `/fees`, and Safe's queue article could not be fetched; only search snippets exist for those.
- Flexport findings come from a promo video transcript and a product page, not the live app.
- Only public pages were read. No logged-in UX was seen for any product.
