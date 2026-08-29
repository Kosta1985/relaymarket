const ABR_ORIGIN = 'https://abr.business.gov.au';

export async function lookupAustralianBusiness({ type, identifier, guid, fetchImpl = fetch }) {
  const idType = String(type || '').toUpperCase();
  if (!['ABN', 'ACN'].includes(idType)) throw problem('business_identifier_type_invalid', 400);
  const cleaned = String(identifier || '').replace(/\D/g, '');
  const expected = idType === 'ABN' ? 11 : 9;
  if (cleaned.length !== expected) throw problem(`${idType.toLowerCase()}_format_invalid`, 400);
  if (!guid) throw problem('abr_guid_not_configured', 503);

  const callback = 'relaymarketAbr';
  const path = idType === 'ABN' ? '/json/AbnDetails.aspx' : '/json/AcnDetails.aspx';
  const query = new URLSearchParams({ callback, guid });
  query.set(idType === 'ABN' ? 'abn' : 'acn', cleaned);
  const response = await fetchImpl(`${ABR_ORIGIN}${path}?${query}`, {
    method: 'GET',
    headers: { accept: 'application/javascript,text/javascript,*/*;q=0.1', 'user-agent': 'RelayMarket/0.10 business-verification' },
    redirect: 'error'
  });
  if (!response.ok) throw problem('abr_lookup_failed', 502);
  const payload = parseJsonp(await response.text(), callback);
  const message = pick(payload, 'Message', 'message');
  if (message) throw problem('business_registry_lookup_rejected', 422, String(message).slice(0, 300));

  const abn = digits(pick(payload, 'Abn', 'ABN', 'abn'));
  const acn = digits(pick(payload, 'Acn', 'ACN', 'acn')) || (abn.length === 11 ? abn.slice(-9) : '');
  const registryName = clean(pick(payload, 'EntityName', 'entityName', 'MainName', 'mainName'), 240);
  const status = clean(pick(payload, 'AbnStatus', 'ABNStatus', 'abnStatus', 'EntityStatus', 'entityStatus'), 80);
  const effectiveFrom = clean(pick(payload, 'AbnStatusEffectiveFrom', 'abnStatusEffectiveFrom', 'EffectiveFrom', 'effectiveFrom'), 40) || null;
  const state = clean(pick(payload, 'AddressState', 'addressState'), 20) || null;
  const postcode = clean(pick(payload, 'AddressPostcode', 'addressPostcode'), 12) || null;
  const active = status.toLowerCase() === 'active';

  return {
    provider: 'abr_abn_lookup',
    identifierType: idType,
    identifier: cleaned,
    abn: abn || null,
    acn: acn || null,
    registryName: registryName || null,
    status: status || 'unknown',
    active,
    effectiveFrom,
    state,
    postcode
  };
}

function parseJsonp(text, callback) {
  const raw = String(text || '').trim();
  const prefix = `${callback}(`;
  if (!raw.startsWith(prefix)) throw problem('abr_response_invalid', 502);
  let inner = raw.slice(prefix.length).trim();
  if (inner.endsWith(';')) inner = inner.slice(0, -1).trim();
  if (!inner.endsWith(')')) throw problem('abr_response_invalid', 502);
  inner = inner.slice(0, -1);
  try { return JSON.parse(inner); } catch { throw problem('abr_response_invalid', 502); }
}
function pick(obj, ...keys) { for (const k of keys) if (obj && obj[k] != null) return obj[k]; return ''; }
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function clean(v, max) { return String(v || '').trim().slice(0, max); }
function problem(code, status, detail) { return Object.assign(new Error(detail || code.replaceAll('_', ' ')), { code, status }); }
