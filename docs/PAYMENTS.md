# RelayMarket payments

## Fee policy

RelayMarket platform fee: **1% (100 basis points)**. There is no minimum RelayMarket platform fee. All calculations use integer minor units. When 1% produces a fraction of the currency's minor unit, RelayMarket rounds the platform fee **down**, so rounding can never make the effective RelayMarket fee exceed 1%.

Example: provider amount AUD 1,000.00 = `100000` cents. RelayMarket fee = `1000` cents. Payer subtotal before processor charges = `101000` cents.

Processor/card/bank and payout fees are separate from the RelayMarket fee and must not be hidden inside the 1%.

## Runtime states

`created -> funded -> held/released/refunded`

Terminal failure branches: `failed`, `cancelled`. Release requires the related task to be completed. A full refund is permitted from `funded`, `held`, or `released`; when funds have already been transferred to a provider, RelayMarket reverses that transfer before refunding the platform charge. Partial refunds are intentionally not supported in the first production release. When a payment exists, the task cannot start until payment is funded or held.


## RelayMarket Payment Protection

Payment Protection is the platform's evidence-and-dispute workflow for paid tasks. It is deliberately **not** described as a bank guarantee or self-custodied escrow. RelayMarket should not hold customer money in its own ad-hoc wallet. The configured payment provider remains the payment rail.

For an eligible funded task, a requester dispute performs a database-atomic transition that:

1. moves the task to `disputed`;
2. moves a `funded` payment to `held`;
3. opens a private protection case; and
4. snapshots task participants, artifact digest, delivery time, message count and payment status.

Task participants can add evidence to the private case. Ordinary release/refund operations are blocked while an unresolved protection case exists. An authorised reviewed resolution records one of two outcomes:

- `resolved_release`: complete/release according to the payment provider path; or
- `resolved_refund`: cancel/refund, including transfer reversal first if a provider transfer was already made.

Resolution and evidence actions are audit logged. Public trust surfaces expose aggregate status only; private allegations/evidence are not published as facts. The precise Australian terms, review period, evidence standard, consumer-law wording and financial-services characterisation must be legally reviewed before live-money launch.

## Production provider

The Cloudflare runtime defaults to `PAYMENT_PROVIDER=disabled`. Development tests may use `mock`. Production must not.

The intended Stripe Connect architecture is **separate charges and transfers**: collect funds on the RelayMarket platform, then create a transfer to the provider's connected account only when RelayMarket releases the completed task. This keeps release timing independent from initial payment capture. Stripe documents connected-account creation, Account Links for onboarding, PaymentIntents for collection, and Transfers for moving funds to connected accounts.

Required production secrets: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. Webhooks must be verified using the raw request body and `Stripe-Signature` before changing payment state.

No code, logs, events, metrics, or UI may claim that a real payment occurred merely because a mock payment reached `funded` or `released`.

## Webhook safety

Stripe webhook signatures are verified against the raw request body. Verified event IDs are persisted with a unique `(provider, event_id)` key so retries do not double-apply financial state transitions. For successful PaymentIntent events, RelayMarket also checks the received amount and currency against the stored payment before marking it funded. A failed handler releases its event claim so Stripe can retry safely.

## Financial metrics

`gmvMinor` is gross processed provider value and therefore includes transactions that were later refunded. `netGmvMinor` subtracts refunded provider value. RelayMarket platform revenue is recognized only while a payment remains `released`; a refunded payment does not count as platform revenue. Processor and payout costs are separate from the 1% RelayMarket fee. RelayMarket does not currently ingest Stripe balance-transaction fee data, so those costs are not included in `platformRevenueMinor`; that field is the gross RelayMarket platform fee after refunds, not accounting profit.

## Processor-cost launch gate

The 1% RelayMarket fee is not the same thing as Stripe/card/bank processing cost. Production Stripe activation is blocked until `PAYMENT_PROCESSOR_COST_POLICY` is deliberately set to one of: `platform_absorbs`, `provider_external_costs`, or `payer_surcharge_compliant`. The last option must only be used where a separate payer surcharge is lawful and does not exceed the permitted cost of acceptance. RelayMarket does not silently change the 1% platform fee to cover processor economics.
