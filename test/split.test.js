'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSplit } = require('../split');
const { ruleParse } = require('../parser');

test('even split sums exactly', () => {
  const s = buildSplit({ total: 100, payer: 'A', people: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  assert.strictEqual(s.shares.reduce((t, x) => t + x.amountMinor, 0), 10000);
  assert.deepStrictEqual(s.shares.map(x => x.amount), ['33.34', '33.33', '33.33']);
  assert.strictEqual(s.shares[0].owes, false);
});
test('weights and fixed amounts', () => {
  const s = buildSplit({ total: 90, people: [{ name: 'A', amount: 30 }, { name: 'B', weight: 2 }, { name: 'C', weight: 1 }] });
  assert.deepStrictEqual(s.shares.map(x => x.amount), ['30.00', '40.00', '20.00']);
});
test('rejects bad input', () => {
  assert.throws(() => buildSplit({ total: 10, people: [{ name: 'A', amount: 20 }] }));
  assert.throws(() => buildSplit({ total: 0, people: [{ name: 'A' }] }));
});
test('rule parser reads a plain sentence', () => {
  const p = ruleParse('I paid $84 for pizza with Rahul, Meera and Dev', 'Aditya');
  assert.strictEqual(p.total, 84);
  assert.strictEqual(p.payer, 'Aditya');
  assert.deepStrictEqual(p.people.map(x => x.name), ['Aditya', 'Rahul', 'Meera', 'Dev']);
});
