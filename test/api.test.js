'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { handler } = require('../app');
const { sanitizePlan } = require('../validate');

function start() { return new Promise(r => { const s = http.createServer(handler).listen(0, () => r(s)); }); }
async function call(s, path, body, method = 'POST') {
  const r = await fetch('http://localhost:' + s.address().port + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
}

test('sanitizePlan rejects hostile or broken LLM output', () => {
  assert.throws(() => sanitizePlan({ total: -5, payer: 'A', people: [{ name: 'A' }] }));
  assert.throws(() => sanitizePlan({ total: 10, payer: 'A', people: [] }));
  assert.throws(() => sanitizePlan({ total: 1e9, payer: 'A', people: [{ name: 'A' }, { name: 'B' }] }));
  assert.throws(() => sanitizePlan({ total: 10, payer: '', people: [{ name: 'A' }, { name: 'B' }] }));
  assert.throws(() => sanitizePlan({ total: 10, payer: 'A', people: [{ name: 'A' }, { name: 'a' }] }));
  const p = sanitizePlan({ total: '10', currency: 'XXX', payer: 'ab', description: '<script>x</script>', people: [{ name: 'A<b>' }, { name: 'ab' }, { name: 'Bob', weight: -3 }] });
  assert.strictEqual(p.currency, 'USD');
  assert.strictEqual(p.people.length, 2);
  assert.strictEqual(p.payer, 'Ab');
  assert.ok(!/[<>]/.test(p.description));
  assert.strictEqual(p.people[1].weight, 1);
});

test('API: plan, request, capture in demo mode; security headers; limits', async () => {
  delete process.env.LLM_API_KEY; delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET;
  const s = await start();
  try {
    const h = await call(s, '/api/health', null, 'GET');
    assert.strictEqual(h.json.paypal, 'mock');
    assert.match(h.headers.get('content-security-policy'), /default-src 'self'/);

    const p = await call(s, '/api/plan', { text: 'I paid $84 for pizza with Rahul, Meera and Dev', me: 'Aditya' });
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.json.split.shares.reduce((t, x) => t + x.amountMinor, 0), 8400);

    const bad = await call(s, '/api/plan', { text: 'hello there' });
    assert.strictEqual(bad.status, 422);

    // The server ignores amounts the browser might send and recomputes from the plan.
    const r = await call(s, '/api/request', { plan: p.json.plan, split: { shares: [{ name: 'Rahul', amount: '0.01', amountMinor: 1, owes: true }] } });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.requests.map(x => x.amount), ['21.00', '21.00', '21.00']);
    assert.ok(r.json.requests.every(x => x.mock && x.orderId.startsWith('MOCK-')));

    const c = await call(s, '/api/capture', { orderId: r.json.requests[0].orderId });
    assert.strictEqual(c.json.status, 'COMPLETED');
    assert.strictEqual((await call(s, '/api/capture', { orderId: '../etc' })).status, 400);
    assert.strictEqual((await call(s, '/api/capture', { orderId: 'NOTMOCK123' })).status, 500);
    assert.strictEqual((await call(s, '/api/plan', null, 'GET')).status, 405);
    assert.strictEqual((await call(s, '/api/plan', { text: 'x'.repeat(900) })).status, 400);
    const trav = await fetch('http://localhost:' + s.address().port + '/..%2f..%2fetc/passwd');
    assert.strictEqual(trav.status, 404);
  } finally { s.close(); }
});
