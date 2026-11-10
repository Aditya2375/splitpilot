const $ = id => document.getElementById(id);
const EXAMPLES = [
  'I paid $84 for pizza with Rahul, Meera and Dev',
  'Meera booked the 3 bedroom Airbnb for $450, split between Meera, me, Dev and Rahul',
  'I covered $60 groceries. Dev owes 10, split the rest equally with Meera and Rahul'
];
const KEY = 'splitpilot.ledger.v1';
let current = null;
const money = (v, c) => new Intl.NumberFormat('en', { style: 'currency', currency: c }).format(v);
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const save = l => localStorage.setItem(KEY, JSON.stringify(l));
const post = async (u, b) => {
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || 'Request failed'), { data: j });
  return j;
};

EXAMPLES.forEach(t => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = t.length > 38 ? t.slice(0, 36) + '...' : t; b.title = t;
  b.onclick = () => { $('msg').value = t; };
  $('chips').appendChild(b);
});

fetch('/api/health').then(r => r.json()).then(h => {
  const m = $('mode');
  m.textContent = h.paypal === 'sandbox' ? 'PayPal Sandbox live' : 'Demo mode, no PayPal keys';
  m.className = 'mode ' + (h.paypal === 'sandbox' ? 'live' : 'mock');
});

$('go').onclick = async () => {
  $('err').textContent = ''; $('go').disabled = true;
  try {
    const { plan, split } = await post('/api/plan', { text: $('msg').value, me: $('me').value || 'Me' });
    current = split;
    $('pd').textContent = split.description;
    $('pt').textContent = money(split.totalMinor / 100, split.currency);
    $('shares').innerHTML = '';
    split.shares.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="who">${esc(s.name)}<small>${s.name === split.payer ? 'paid upfront, keeps their share' : 'owes ' + esc(split.payer || 'the payer')}</small></span><span class="amt">${money(s.amount, split.currency)}</span>`;
      $('shares').appendChild(li);
    });
    $('pn').textContent = plan.notes || '';
    $('plan').classList.remove('hidden');
  } catch (e) { $('err').textContent = e.message; }
  $('go').disabled = false;
};

$('send').onclick = async () => {
  if (!current) return;
  $('send').disabled = true;
  try {
    const id = Date.now().toString(36);
    const { requests } = await post('/api/request', { split: current, ledgerId: id });
    const l = load();
    l.unshift({ id, description: current.description, currency: current.currency, requests: requests.map(r => ({ ...r, paid: false })) });
    save(l); render();
    $('plan').classList.add('hidden');
  } catch (e) { $('err').textContent = e.message; }
  $('send').disabled = false;
};

function render() {
  const l = load();
  $('ledger').classList.toggle('hidden', !l.length);
  $('items').innerHTML = '';
  l.forEach(g => {
    const h = document.createElement('div');
    h.innerHTML = `<h2 style="margin:16px 0 4px;font-size:17px">${esc(g.description)}</h2>`;
    $('items').appendChild(h);
    g.requests.forEach(r => {
      const d = document.createElement('div'); d.className = 'item';
      const pay = r.paid ? '' : (r.approveUrl
        ? `<a class="btn" href="${esc(r.approveUrl)}" target="_blank" rel="noopener">Pay with PayPal</a>`
        : `<button class="btn" data-o="${esc(r.orderId)}">Simulate payment</button>`);
      d.innerHTML = `<div><strong>${esc(r.name)}</strong> <span class="amt">${money(r.amount, g.currency)}</span><div class="oid">${esc(r.orderId)}${r.mock ? ' (demo order)' : ''}</div></div>
        <div><span class="pill ${r.paid ? 'paid' : ''}">${r.paid ? 'Paid' : 'Waiting'}</span> ${pay}</div>`;
      const b = d.querySelector('button');
      if (b) b.onclick = () => markPaid(r.orderId);
      $('items').appendChild(d);
    });
  });
}

async function markPaid(orderId) {
  const res = await post('/api/capture', { orderId });
  if (res.status !== 'COMPLETED') return;
  const l = load();
  l.forEach(g => g.requests.forEach(r => { if (r.orderId === orderId) r.paid = true; }));
  save(l); render();
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Returning from PayPal: the payer approved, so capture the order PayPal appended as ?token=
(async () => {
  const q = new URLSearchParams(location.search);
  if (q.get('paid') && q.get('token')) {
    try { await markPaid(q.get('token')); } catch (e) { $('err').textContent = e.message; }
    history.replaceState({}, '', '/');
  }
  render();
})();
