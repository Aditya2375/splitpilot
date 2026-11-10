'use strict';
// Turns a plain-language expense into a structured plan.
// Uses an LLM (any OpenAI-compatible endpoint, e.g. Groq or Gemini) when LLM_API_KEY is set.
// Otherwise falls back to a rule-based parser so the app always works.

const SYSTEM = `You turn a message about a shared expense into JSON only. Schema:
{"description":string,"currency":"USD"|"EUR"|"GBP"|"CAD"|"AUD"|"INR","total":number,"payer":string|null,
 "people":[{"name":string,"weight":number?,"amount":number?}],"notes":string}
Rules: "payer" is who already paid. Include the payer in "people" if they share the cost. Use "amount" only when a person's exact share is stated, "weight" for ratios (default 1). Never invent people. If the total or people are missing, set total to 0 or people to [].`;

const CURRENCY = { '$': 'USD', 'usd': 'USD', 'dollar': 'USD', 'dollars': 'USD', '€': 'EUR', 'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR', '£': 'GBP', 'gbp': 'GBP', 'cad': 'CAD', 'aud': 'AUD', '₹': 'INR', 'rs': 'INR', 'inr': 'INR' };

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function ruleParse(text, me) {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/(\$|€|£|₹|rs\.?\s?|usd|eur|gbp|cad|aud|inr)?\s?(\d+(?:[.,]\d+)?)\s?(usd|eur|euros?|gbp|cad|aud|inr|dollars?)?/i);
  let total = 0, currency = 'USD';
  if (m) {
    total = Number(m[2].replace(',', '.'));
    const c = (m[1] || m[3] || '').toLowerCase().replace(/\s|\./g, '');
    if (CURRENCY[c]) currency = CURRENCY[c];
  }
  const payerMatch = t.match(/^(i|[A-Za-z]+)\s+(?:paid|bought|ordered|covered|booked)/i);
  let payer = payerMatch ? (payerMatch[1].toLowerCase() === 'i' ? (me || 'Me') : cap(payerMatch[1])) : null;
  const withMatch = t.match(/\b(?:with|between|among)\s+(.+?)(?:[.]|$)/i) || t.match(/\bfor\s+(.+?)(?:[.]|$)/i);
  const names = [];
  if (withMatch) {
    for (const part of withMatch[1].split(/,|\band\b|&/i)) {
      const n = part.replace(/\b(me|myself|equally|evenly|split|each|the)\b/gi, '').trim();
      if (/^[A-Za-z][A-Za-z'-]{1,20}$/.test(n)) names.push(cap(n));
    }
  }
  const people = [];
  if (payer) people.push({ name: payer, weight: 1 });
  for (const n of names) if (!people.find(p => p.name.toLowerCase() === n.toLowerCase())) people.push({ name: n, weight: 1 });
  const what = t.match(/(?:for|on)\s+(?:the\s+)?([a-z ]{3,30}?)(?:\s+(?:with|between|among|split)|[.,]|$)/i);
  return { description: what ? cap(what[1].trim()) : 'Shared expense', currency, total, payer, people, notes: 'rule-based parse' };
}

async function llmParse(text, me, cfg) {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: `The user is called ${me || 'Me'}. Message: ${text}` }],
    }),
  });
  if (!res.ok) throw new Error('LLM ' + res.status);
  const data = await res.json();
  const plan = JSON.parse(data.choices[0].message.content);
  plan.notes = (plan.notes || '') + ' [llm:' + cfg.model + ']';
  return plan;
}

async function parseExpense(text, me, env = process.env) {
  if (env.LLM_API_KEY) {
    const cfg = {
      key: env.LLM_API_KEY,
      url: env.LLM_URL || 'https://api.groq.com/openai/v1/chat/completions',
      model: env.LLM_MODEL || 'llama-3.3-70b-versatile',
    };
    try { return await llmParse(text, me, cfg); } catch (e) { /* fall through to rules */ }
  }
  return ruleParse(text, me);
}

module.exports = { parseExpense, ruleParse };
