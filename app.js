'use strict';
const fs = require('fs');
const path = require('path');
const { parseExpense } = require('./parser');
const { buildSplit } = require('./split');
const { sanitizePlan, SANDBOX_CURRENCIES } = require('./validate');
const paypal = require('./paypal');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

// Tiny in-memory rate limiter (per IP, per route group). Fine for a single small instance.
const hits = new Map();
function limited(req, group, max, windowMs = 60000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const key = group + '|' + ip;
  const now = Date.now();
  const h = (hits.get(key) || []).filter(t => now - t < windowMs);
  h.push(now);
  hits.set(key, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return h.length > max;
}

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 20000) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); } });
  });
}

function origin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = String(req.headers.host || '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) throw Object.assign(new Error('bad host'), { status: 400 });
  return (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') + '://' + host;
}

async function handler(req, res) {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, paypal: paypal.configured() ? 'sandbox' : 'mock', llm: process.env.LLM_API_KEY ? 'on' : 'rules' });
    }
    if (url.pathname.startsWith('/api/') && req.method !== 'POST') return send(res, 405, { error: 'POST only' });

    if (url.pathname === '/api/plan') {
      if (limited(req, 'plan', 15)) return send(res, 429, { error: 'Slow down a little and try again in a minute.' });
      const { text, me } = await readBody(req);
      if (!text || typeof text !== 'string' || text.length > 800) return send(res, 400, { error: 'Write the expense in under 800 characters.' });
      const who = typeof me === 'string' ? me.replace(/[^\p{L}\p{M}' -]/gu, '').slice(0, 20) : '';
      const raw = await parseExpense(text, who || 'Me');
      let plan, split;
      try { plan = sanitizePlan(raw); split = buildSplit(plan); }
      catch (e) { return send(res, 422, { error: 'Could not work out a split: ' + e.message + '. Try naming the total, who paid and who shares it.' }); }
      return send(res, 200, { plan, split, parser: /\[llm:/.test(raw.notes || '') ? 'ai' : 'rules' });
    }

    if (url.pathname === '/api/request') {
      if (limited(req, 'request', 10)) return send(res, 429, { error: 'Too many requests, wait a minute.' });
      const body = await readBody(req);
      let plan, split;
      // The server recomputes the split from the plan; it never trusts amounts sent by the browser.
      try { plan = sanitizePlan(body.plan); split = buildSplit(plan); } catch (e) { return send(res, 400, { error: e.message }); }
      const live = paypal.configured();
      if (live && !SANDBOX_CURRENCIES.includes(split.currency)) return send(res, 400, { error: 'PayPal checkout here supports USD, EUR, GBP, CAD and AUD.' });
      const ledgerId = String(body.ledgerId || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || Date.now().toString(36);
      const base = origin(req);
      const out = [];
      for (const s of split.shares) {
        if (!s.owes || s.amountMinor <= 0) continue;
        const o = await paypal.createOrder({
          amount: s.amount,
          currency: split.currency,
          description: `${split.description} - ${s.name}'s share`,
          requestId: `${ledgerId}-${s.name.replace(/[^a-z0-9]/gi, '')}`.slice(0, 60),
          returnUrl: base + '/?paid=1',
          cancelUrl: base + '/?cancelled=1',
        });
        out.push({ name: s.name, amount: s.amount, orderId: o.id, status: o.status, approveUrl: o.approveUrl, mock: o.mock });
      }
      if (!out.length) return send(res, 422, { error: 'Nobody owes anything in this split.' });
      return send(res, 200, { requests: out, split });
    }

    if (url.pathname === '/api/capture') {
      if (limited(req, 'capture', 20)) return send(res, 429, { error: 'Too many requests, wait a minute.' });
      const { orderId } = await readBody(req);
      if (typeof orderId !== 'string' || !/^[A-Za-z0-9-]{6,40}$/.test(orderId)) return send(res, 400, { error: 'bad orderId' });
      return send(res, 200, await paypal.captureOrder(orderId));
    }

    // static files
    const p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch (e) {
    const status = e.status || 500;
    send(res, status, { error: status === 500 ? 'Something went wrong on our side.' : e.message });
    if (status === 500) console.error(e);
  }
}

module.exports = { handler, sanitizePlan };
