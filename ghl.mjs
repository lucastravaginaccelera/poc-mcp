/** Client minimo da API v2 do GoHighLevel (LeadConnector). */

const BASE = process.env.GHL_API_BASE ?? 'https://services.leadconnectorhq.com';
const VERSION = process.env.GHL_API_VERSION ?? '2021-07-28';
const TOKEN = process.env.GHL_PIT;
const LOCATION_ID = process.env.GHL_LOCATION_ID;

if (!TOKEN || !LOCATION_ID) {
  throw new Error('Faltando GHL_PIT ou GHL_LOCATION_ID no ambiente (.env)');
}

export { LOCATION_ID };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Version: VERSION,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const detail = data?.message ?? data?.error ?? text.slice(0, 300);
    const err = new Error(`GHL ${method} ${path} -> ${res.status}: ${JSON.stringify(detail)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const ghl = {
  /** Cria ou atualiza o contato deduplicando por email/telefone dentro da location. */
  upsertContact: (payload) =>
    call('POST', '/contacts/upsert', { locationId: LOCATION_ID, ...payload }),

  createOpportunity: (payload) =>
    call('POST', '/opportunities/', { locationId: LOCATION_ID, ...payload }),

  addNote: (contactId, body) =>
    call('POST', `/contacts/${contactId}/notes`, { body }),

  listCustomFields: () =>
    call('GET', `/locations/${LOCATION_ID}/customFields?model=contact`),

  createCustomField: (payload) =>
    call('POST', `/locations/${LOCATION_ID}/customFields`, { ...payload, model: 'contact' }),

  getPipelines: () =>
    call('GET', `/opportunities/pipelines?locationId=${LOCATION_ID}`),
};
