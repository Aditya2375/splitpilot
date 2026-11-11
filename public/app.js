const $ = id => document.getElementById(id);
const EXAMPLES = [
  'I paid $84 for pizza with Rahul, Meera and Dev',
  'Meera booked the 3 bedroom Airbnb for $450, split between Meera, me, Dev and Rahul',
  'I covered $60 groceries. Dev owes 10, split the rest equally with Meera and Rahul'
];
const KEY = 'splitpilot.ledger.v2';
let current = null; // { plan, split }
let demo = true;
const money = (v, c) => new Intl.NumberFormat('en', { style: 'currency', currency: c }).format(v);
const load = () => { try { const l = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(l) ? l : []; } catch { return []; } };
const save = l => localStorage.setItem(KEY, JSON.stringify(l));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const post = async (u, b) => {
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')');
  return j;
};
const safeUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)paypal\.com$/.test(x.hostname) ? x.href : ''; } catch { return ''; } };

EXAMPLES.forEach(t => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = t.length > 38 ? t.slice(0, 36) + '...' : t; b.title = t;
  b.onclick = () => { $('msg').value = t; $('msg').focus(); };
  $('chips').appendChild(b);
});
$('msg').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('go').click(); });

fetch('/api/health').then(r => r.json()).then(h => {
  demo = h.paypal !== 'sandbox';
  const m = $('mode');
  m.textContent = demo ? 'Demo mode, no PayPal keys' : 'PayPal Sandbox live';
  m.className = 'mode ' + (demo ? 'mock' : 'live');
  $('demo').classList.toggle('hidden', !demo);
});

$('go').onclick = async () => {
  $('err').textContent = ''; $('go').disabled = true;
  try {
    const { plan, split, parser } = await post('/api/plan', { text: $('msg').value, me: $('me').value || 'Me' });
    current = { plan, split };
    $('pd').textContent = split.description;
    $('pt').textContent = money(split.totalMinor / 100, split.currency);
    $('shares').innerHTML = '';
    split.shares.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="who">${esc(s.name)}<small>${s.name === split.payer ? 'paid upfront, keeps their share' : 'owes ' + esc(split.payer)}</small></span><span class="amt">${money(s.amount, split.currency)}</span>`;
      $('shares').appendChild(li);
    });
    $('pn').textContent = (parser === 'ai' ? 'Read by the AI parser. ' : 'Read by the basic rule parser (AI unavailable). ') + 'Check the numbers before sending.';
    $('plan').classList.remove('hidden');
  } catch (e) { $('plan').classList.add('hidden'); current = null; $('err').textContent = e.message; }
  $('go').disabled = false;
};

$('send').onclick = async () => {
  if (!current) return;
  $('send').disabled = true; $('err').textContent = '';
  try {
    const id = Date.now().toString(36);
    const { requests, split } = await post('/api/request', { plan: current.plan, ledgerId: id });
    const l = load();
    l.unshift({ id, description: split.description, currency: split.currency, payer: split.payer, requests: requests.map(r => ({ ...r, paid: false })) });
    save(l.slice(0, 30)); render();
    $('plan').classList.add('hidden'); current = null;
  } catch (e) { $('err').textContent = e.message; }
  $('send').disabled = false;
};

$('clear').onclick = () => { if (confirm('Remove all requests from this browser?')) { save([]); render(); } };

function render() {
  const l = load();
  $('ledger').classList.toggle('hidden', !l.length);
  $('items').innerHTML = '';
  let waiting = 0, paid = 0;
  l.forEach(g => {
    const h = document.createElement('div');
    h.innerHTML = `<h3 class="gh">${esc(g.description)}<small>paid by ${esc(g.payer || '')}</small></h3>`;
    const del = document.createElement('button'); del.className = 'del'; del.textContent = 'remove';
    del.onclick = () => { save(load().filter(x => x.id !== g.id)); render(); };
    h.firstChild.appendChild(del);
    $('items').appendChild(h);
    g.requests.forEach(r => {
      r.paid ? paid++ : waiting++;
      const d = document.createElement('div'); d.className = 'item';
      const url = r.approveUrl ? safeUrl(r.approveUrl) : '';
      const pay = r.paid ? '' : (url
        ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Pay with PayPal</a>`
        : `<button class="btn" data-o="${esc(r.orderId)}">Simulate payment</button>`);
      d.innerHTML = `<div><strong>${esc(r.name)}</strong> <span class="amt">${money(r.amount, g.currency)}</span><div class="oid">${esc(r.orderId)}${r.mock ? ' (demo order)' : ''}</div></div>
        <div><span class="pill ${r.paid ? 'paid' : ''}">${r.paid ? 'Paid' : 'Waiting'}</span> ${pay}</div>`;
      const b = d.querySelector('button');
      if (b) b.onclick = () => markPaid(r.orderId).catch(e => { $('err').textContent = e.message; });
      $('items').appendChild(d);
    });
  });
  $('sum').textContent = `${paid} paid, ${waiting} waiting`;
}

async function markPaid(orderId) {
  const res = await post('/api/capture', { orderId });
  if (res.status !== 'COMPLETED') throw new Error('Payment is not complete yet.');
  const l = load();
  l.forEach(g => g.requests.forEach(r => { if (r.orderId === orderId) r.paid = true; }));
  save(l); render();
}

// Returning from PayPal: it appends ?token=<order id>; capture that order, then clean the URL.
(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('paid') && /^[A-Za-z0-9-]{6,40}$/.test(q.get('token') || '')) {
    try { await markPaid(q.get('token')); } catch (e) { $('err').textContent = e.message; }
  }
  if (location.search) history.replaceState({}, '', '/');
  render();
})();
