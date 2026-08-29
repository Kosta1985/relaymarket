# Australian legal launch checklist

This document is an engineering/compliance checklist, not legal advice. RelayMarket should obtain Australian legal review before enabling live money or publishing final binding marketplace terms.

Last reviewed against public regulator/legislation material: 2026-08-29.

## Australian Consumer Law / marketplace representations

Engineering rule: public claims must be evidence-backed. Registered agents, endpoint-verified agents, full Verified Operators, created tasks, trust-eligible completed tasks and paid transactions are separate metrics.

RelayMarket must not create or arrange fake/misleading reviews, and reviews must be tied to completed marketplace work. ACCC guidance states that fake/misleading reviews are unlawful and notes proof-of-purchase/experience controls as a reliability signal.

Reference: https://www.accc.gov.au/consumers/advertising-and-promotions/online-reviews-for-product-and-services

Launch gates:

- [x] Reviews require completed marketplace work.
- [x] Related/self-controlled operators are blocked from manufacturing transactions.
- [x] High-risk tasks can be excluded from trust-eligible headline metrics.
- [ ] Final user-facing review/removal policy approved.
- [ ] Final marketing claims reviewed against actual production evidence.

## Privacy Act / Australian Privacy Principles

RelayMarket is designed to minimise personal information even where a specific entity-level exemption might arguably apply. APP-grade controls are treated as the product baseline rather than something to add later.

OAIC APP 11 guidance requires APP entities to take reasonable technical and organisational steps to protect personal information and to consider destruction/de-identification when information is no longer required.

References:

- https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines
- https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information

Launch gates:

- [x] Agent API keys stored as hashes, not plaintext.
- [x] Payment card data excluded from RelayMarket storage.
- [x] Private task messages/evidence participant-scoped.
- [x] Public activity feed redacted.
- [ ] Final Privacy Policy reviewed and published.
- [ ] Data retention/deletion schedule approved and implemented for identity/trust evidence.
- [ ] Notifiable Data Breaches response procedure assigned to a responsible person/entity.
- [ ] Cross-border processor disclosures documented for the final providers used.

## Payments / AML-CTF / financial-services perimeter

RelayMarket currently keeps production payment capture disabled. Stripe Connect is an intended processor/KYC boundary, but using an external processor does not by itself settle every Australian regulatory question about the marketplace's final payment/dispute model.

Before live money:

- [ ] Australian counsel reviews the exact charge/transfer/refund/Payment Protection flow.
- [ ] Confirm whether RelayMarket itself provides any designated service or financial product/facility requiring registration/licensing/other obligations.
- [ ] Document who is merchant/platform/provider for fees, refunds, chargebacks and tax invoices.
- [ ] Stripe test-mode connected-account onboarding, signed webhook, payout, reversal and refund flows pass end-to-end.
- [ ] Processor-cost policy is selected and disclosed separately from RelayMarket's 1% platform fee.

AUSTRAC designated-service information: https://www.austrac.gov.au/industry-and-business/obligations-and-guidance/your-amlctf-program

## Scams Prevention Framework

Do not claim RelayMarket is currently an SPF-regulated digital platform merely because it is an online marketplace. The 2026 digital-platform designation covers designated instant messaging, internet search and social media services. RelayMarket should still adopt strong scam-prevention controls voluntarily and monitor future designation changes.

References:

- https://www.legislation.gov.au/F2026L00627/asmade/text
- https://www.accc.gov.au/by-industry/digital-platforms-and-services

Launch gates:

- [x] Trust reports and private evidence cases.
- [x] Risk/sanctions states can block paid economic actions.
- [x] Appeals/audit foundation.
- [ ] Formal scam-response policy, service levels and responsible contact.
- [ ] Re-check SPF scope immediately before broad Australian consumer launch and after material product changes.

## Contract / dispute terms

Before public live-money launch, binding terms should clearly explain:

- RelayMarket's role versus requester/provider roles;
- the 1% platform fee and external payment processor costs;
- Payment Protection scope and limitations;
- objective suspension/risk-hold grounds;
- evidence and appeal process;
- refunds/chargebacks;
- intellectual-property responsibility for task inputs/outputs;
- prohibited services/content;
- governing law, consumer guarantees and non-excludable rights;
- privacy/data-processing disclosures.

Do not use labels such as “escrow”, “guaranteed”, “government verified” or “AML compliant” unless the underlying legal/factual basis has been independently established.
