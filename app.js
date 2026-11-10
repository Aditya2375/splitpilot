'use strict';
const fs = require('fs');
const path = require('path');
const { parseExpense } = require('./parser');
const { buildSplit } = require('./split');
const paypal = require('./paypal');

const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 20000) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

function origin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + req.headers.host;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, paypal: paypal.configured() ? 'sandbox' : 'mock', llm: process.env.LLM_API_KEY ? 'on' : 'rules' });
    }
    if (url.pathname === '/api/plan' && req.method === 'POST') {
      const { text, me } = await readBody(req);
      if (!text || typeof text !== 'string' || text.length > 800) return send(res, 400, { error: 'Write the expense in under 800 characters.' });
      const plan = await parseExpense(text, me);
      let split;
      try { split = buildSplit(plan); } catch (e) { return send(res, 422, { error: 'Could not work out a split: ' + e.message + '. Try naming the total and who shares it.', plan }); }
      return send(res, 200, { plan, split });
    }
    if (url.pathname === '/api/request' && req.method === 'POST') {
      const { split, ledgerId } = await readBody(req);
      if (!split || !Array.isArray(split.shares) || split.shares.length > 20) return send(res, 400, { error: 'missing split' });
      if (!['USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(split.currency)) return send(res, 400, { error: 'PayPal Sandbox checkout supports USD, EUR, GBP, CAD and AUD here.' });
      for (const s of split.shares) {
        if (!Number.isInteger(s.amountMinor) || s.amountMinor < 0 || s.amountMinor > 1000000 || s.amount !== (s.amountMinor / 100).toFixed(2)) return send(res, 400, { error: 'bad share amount' });
        if (typeof s.name !== 'string' || s.name.length > 40) return send(res, 400, { error: 'bad name' });
      }
      const out = [];
      for (const s of split.shares) {
        if (!s.owes || s.amountMinor <= 0) continue;
        const o = await paypal.createOrder({
          amount: s.amount,
          currency: split.currency,
          description: `${split.description} - ${s.name}'s share`,
          requestId: `${ledgerId || 'x'}-${s.name}`.slice(0, 60),
          returnUrl: origin(req) + '/?paid=1&name=' + encodeURIComponent(s.name),
          cancelUrl: origin(req) + '/?cancelled=1',
        });
        out.push({ name: s.name, amount: s.amount, orderId: o.id, status: o.status, approveUrl: o.approveUrl, mock: o.mock });
      }
      return send(res, 200, { requests: out });
    }
    if (url.pathname === '/api/capture' && req.method === 'POST') {
      const { orderId } = await readBody(req);
      if (!orderId) return send(res, 400, { error: 'missing orderId' });
      return send(res, 200, await paypal.captureOrder(orderId));
    }
    // static files
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}

module.exports = { handler };
