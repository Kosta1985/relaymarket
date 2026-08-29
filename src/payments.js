export const PLATFORM_FEE_BPS = 100;
export const PAYMENT_STATES = ['created','funded','held','released','refunded','failed','cancelled'];
export const PAYMENT_PROVIDER_MODES = ['mock','stripe','disabled'];

export function calculatePlatformFee(amountMinor, feeBps = PLATFORM_FEE_BPS) {
  const amount = moneyMinor(amountMinor);
  const bps = Number(feeBps);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw problem('invalid_fee_bps', 400);
  return Math.floor((amount * bps) / 10000);
}

export function paymentQuote(amountMinor, currency = 'USD', feeBps = PLATFORM_FEE_BPS) {
  const providerAmountMinor = moneyMinor(amountMinor);
  const platformFeeMinor = calculatePlatformFee(providerAmountMinor, feeBps);
  return {
    providerAmountMinor,
    platformFeeMinor,
    processorFeeMinor: null,
    payerTotalMinor: providerAmountMinor + platformFeeMinor,
    currency: normalizeCurrency(currency),
    platformFeeBps: feeBps
  };
}

export function normalizePayment(input = {}) {
  const quote = paymentQuote(input.amountMinor, input.currency, input.platformFeeBps ?? PLATFORM_FEE_BPS);
  return {
    amountMinor: quote.providerAmountMinor,
    currency: quote.currency,
    platformFeeMinor: quote.platformFeeMinor,
    platformFeeBps: quote.platformFeeBps,
    payerTotalMinor: quote.payerTotalMinor
  };
}

export function paymentTransitionAllowed(from, to) {
  const map = {
    created: ['funded','failed','cancelled'],
    funded: ['held','released','refunded'],
    held: ['released','refunded'],
    released: ['refunded'],
    refunded: [],
    failed: [],
    cancelled: []
  };
  return Boolean(map[from]?.includes(to));
}

export function normalizeCurrency(value) {
  const code = String(value || 'USD').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw problem('invalid_currency', 400);
  return code;
}

export function moneyMinor(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw problem('invalid_amount_minor', 400);
  return n;
}

function problem(code, status) {
  return Object.assign(new Error(code.replaceAll('_',' ')), { code, status });
}
