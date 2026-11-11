'use strict';
// Pure split math. All amounts are integer paise/cents to avoid float drift.

function toMinor(x) { return Math.round(Number(x) * 100); }
function fromMinor(m) { return (m / 100).toFixed(2); }

// Split total (minor units) by weights. Leftover cents go to the first people, so the sum is exact.
function splitByWeights(totalMinor, people) {
  const wsum = people.reduce((s, p) => s + p.weight, 0);
  if (!(wsum > 0)) throw new Error('weights must sum above zero');
  const shares = people.map(p => Math.floor((totalMinor * p.weight) / wsum));
  let left = totalMinor - shares.reduce((s, v) => s + v, 0);
  for (let i = 0; left > 0; i = (i + 1) % shares.length, left--) shares[i]++;
  return people.map((p, i) => ({ name: p.name, weight: p.weight, amountMinor: shares[i] }));
}

// plan = { description, currency, total, payer, people:[{name, weight?, amount?}] , notes }
// A person with a fixed `amount` is taken out first, the rest is split by weight.
function buildSplit(plan) {
  if (!plan || !Array.isArray(plan.people) || plan.people.length === 0) throw new Error('no people in plan');
  const total = toMinor(plan.total);
  if (!(total > 0)) throw new Error('total must be above zero');
  const fixed = plan.people.filter(p => p.amount != null);
  const flex = plan.people.filter(p => p.amount == null).map(p => ({ name: p.name, weight: p.weight > 0 ? p.weight : 1 }));
  const fixedSum = fixed.reduce((s, p) => s + toMinor(p.amount), 0);
  if (fixedSum > total) throw new Error('fixed amounts exceed the total');
  let out = fixed.map(p => ({ name: p.name, weight: 0, amountMinor: toMinor(p.amount) }));
  if (flex.length) out = out.concat(splitByWeights(total - fixedSum, flex));
  else if (fixedSum !== total) throw new Error('fixed amounts must add up to the total');
  const order = plan.people.map(p => p.name);
  out.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const payer = plan.payer || null;
  if (payer && !out.some(o => o.name === payer)) { /* payer paid but does not share: everyone listed owes them */ }
  return {
    description: plan.description || 'Shared expense',
    currency: plan.currency || 'USD',
    totalMinor: total,
    payer,
    shares: out.map(s => ({
      name: s.name,
      amountMinor: s.amountMinor,
      amount: fromMinor(s.amountMinor),
      owes: s.name !== payer,
    })),
  };
}

module.exports = { toMinor, fromMinor, splitByWeights, buildSplit };
