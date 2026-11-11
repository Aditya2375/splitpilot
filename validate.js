'use strict';
// Everything that comes back from an LLM (or the client) is untrusted. This turns it into a safe plan or throws.

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR'];
const SANDBOX_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD']; // INR is not offered for PayPal checkout in the sandbox flow used here
const MAX_PEOPLE = 20;
const MAX_TOTAL = 10000;

function cleanName(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFKC').replace(/[^\p{L}\p{M}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}
function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizePlan(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('empty plan');
  const currency = CURRENCIES.includes(raw.currency) ? raw.currency : 'USD';
  const total = Number(raw.total);
  if (!Number.isFinite(total) || total <= 0) throw new Error('could not find a total amount');
  if (total > MAX_TOTAL) throw new Error('total is above the ' + MAX_TOTAL + ' limit for this demo');
  if (!Array.isArray(raw.people) || raw.people.length === 0) throw new Error('could not find who shares the cost');
  if (raw.people.length > MAX_PEOPLE) throw new Error('too many people (max ' + MAX_PEOPLE + ')');
  const seen = new Set();
  const people = [];
  for (const p of raw.people) {
    const name = cleanName(p && p.name);
    if (!name) throw new Error('a person has no usable name');
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const out = { name };
    if (p.amount != null) {
      const a = Number(p.amount);
      if (!Number.isFinite(a) || a < 0 || a > total) throw new Error('bad fixed amount for ' + name);
      out.amount = Math.round(a * 100) / 100;
    } else {
      const w = Number(p.weight);
      out.weight = Number.isFinite(w) && w > 0 && w <= 100 ? w : 1;
    }
    people.push(out);
  }
  let payer = cleanName(raw.payer);
  if (!payer) throw new Error('say who paid');
  const match = people.find(p => p.name.toLowerCase() === payer.toLowerCase());
  if (match) payer = match.name;
  return {
    description: cleanText(raw.description, 60) || 'Shared expense',
    currency,
    total: Math.round(total * 100) / 100,
    payer,
    people,
    notes: cleanText(raw.notes, 200),
  };
}

module.exports = { sanitizePlan, cleanName, cleanText, CURRENCIES, SANDBOX_CURRENCIES, MAX_PEOPLE, MAX_TOTAL };
