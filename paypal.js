'use strict';
// Minimal PayPal REST client for the Sandbox. Uses Orders v2 (one order per person's share).
// With no credentials it runs in clearly-labelled mock mode so the app can still be explored.

const BASE = 'https://api-m.sandbox.paypal.com';

function configured(env = process.env) { return !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET); }

async function token(env = process.env) {
  const auth = Buffer.from(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET).toString('base64');
  const r = await fetch(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { authorization: 'Basic ' + auth, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('PayPal auth failed: ' + r.status);
  return (await r.json()).access_token;
}

async function createOrder({ amount, currency, description, requestId, returnUrl, cancelUrl }, env = process.env) {
  if (!configured(env)) {
    const id = 'MOCK-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    return { id, status: 'CREATED', approveUrl: null, mock: true };
  }
  const t = await token(env);
  const r = await fetch(BASE + '/v2/checkout/orders', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json', 'paypal-request-id': requestId },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ description: description.slice(0, 127), amount: { currency_code: currency, value: amount } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal create order failed: ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  const link = (j.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
  return { id: j.id, status: j.status, approveUrl: link ? link.href : null, mock: false };
}

async function captureOrder(id, env = process.env) {
  if (String(id).startsWith('MOCK-')) return { id, status: 'COMPLETED', mock: true };
  if (!configured(env)) throw new Error('unknown order');
  const t = await token(env);
  const r = await fetch(BASE + '/v2/checkout/orders/' + encodeURIComponent(id) + '/capture', {
    method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: '{}',
  });
  const j = await r.json();
  if (!r.ok) throw new Error('PayPal capture failed: ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
  return { id: j.id, status: j.status, mock: false };
}

async function getOrder(id, env = process.env) {
  if (!configured(env) || String(id).startsWith('MOCK-')) return null;
  const t = await token(env);
  const r = await fetch(BASE + '/v2/checkout/orders/' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + t } });
  return r.ok ? r.json() : null;
}

module.exports = { configured, createOrder, captureOrder, getOrder };
