import { test } from 'node:test'
import assert from 'node:assert/strict'
import { median, medianInterval, compareRounds } from './benchmark-statistics.mjs'

const pairs = (stable, candidate, count = 16) => Array.from({ length: count }, (_, i) => ({
  stable: [{ totalMs: stable(i) }, { totalMs: stable(i) }],
  candidate: [{ totalMs: candidate(i) }, { totalMs: candidate(i) }],
}))

test('even medians and exact binomial rank interval', () => {
  assert.equal(median([9, 1, 7, 3]), 5)
  assert.deepEqual(medianInterval([1, 2, 3, 4, 5, 6], 0.05), [1, 6])
  assert.equal(medianInterval([1, 2, 3, 4, 5], 0.05), null)
})

test('A/A control tolerates shared machine drift without reporting a win', () => {
  const result = compareRounds(pairs(i => 20 + i * 4, i => 20 + i * 4), 'totalMs', 92)
  assert.equal(result.verdict, 'no-regression-detected')
  assert.equal(result.ratio, 1)
})

test('detects a sustained slowdown but not a sub-1ms or sub-5% difference', () => {
  assert.equal(compareRounds(pairs(() => 20, () => 25), 'totalMs', 92).verdict, 'regression')
  assert.equal(compareRounds(pairs(() => 1, () => 1.5), 'totalMs', 92).verdict, 'no-regression-detected')
  assert.equal(compareRounds(pairs(() => 100, () => 103), 'totalMs', 92).verdict, 'no-regression-detected')
})

test('few rounds, outliers and order bias cannot produce a clean bill of health', () => {
  assert.equal(compareRounds(pairs(() => 20, () => 20, 4), 'totalMs', 92).verdict, 'inconclusive')
  assert.equal(compareRounds(pairs(() => 20, i => i === 3 ? 60 : 20, 12), 'totalMs', 92).verdict, 'inconclusive')
  const biased = compareRounds(pairs(() => 20, i => i % 2 ? 30 : 20), 'totalMs', 92)
  assert.equal(biased.orderSensitive, true)
  assert.equal(biased.verdict, 'inconclusive')
})

test('order effects do not hide a sustained slowdown in both orders', () => {
  const result = compareRounds(pairs(() => 6, i => i % 2 ? 39 : 36), 'totalMs', 92)
  assert.equal(result.orderSensitive, true)
  assert.equal(result.verdict, 'regression')
  assert.ok(result.differenceInterval[0] > 1)
  assert.ok(result.ratioInterval[0] > 1.05)
})

test('invalid clocks and zero denominators cannot silently pass', () => {
  for (const invalid of [NaN, Infinity, -1]) {
    assert.throws(() => compareRounds(pairs(() => 20, () => invalid), 'totalMs', 92), /Invalid timing/)
  }
  const result = compareRounds(pairs(() => 0, () => 0), 'totalMs', 92)
  assert.equal(result.verdict, 'inconclusive')
  assert.equal(result.reason, 'below-clock-resolution')
  assert.equal(result.ratio, null)
})
