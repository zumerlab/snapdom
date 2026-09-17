// Each observation is a whole paired round, not one correlated capture in a loop.
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// Distribution-free confidence interval for the population median (binomial ranks).
// No normality assumption, bootstrap randomness, outlier removal or pseudo-replication.
export function medianInterval(values, alpha) {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  let probability = 2 ** -n
  let tail = 0
  let rank = 0
  for (let k = 0; k < Math.floor(n / 2); k++) {
    tail += probability
    if (2 * tail > alpha) break
    rank = k + 1
    probability *= (n - k) / (k + 1)
  }
  return rank ? [sorted[rank - 1], sorted[n - rank]] : null
}

export function compareRounds(pairs, metric, comparisons) {
  if (pairs.some(pair => ['stable', 'candidate'].some(arm => !pair[arm]?.length || pair[arm].some(sample => !Number.isFinite(sample[metric]) || sample[metric] < 0)))) {
    throw new Error(`Invalid timing samples for ${metric}`)
  }
  const stable = pairs.map(pair => median(pair.stable.map(sample => sample[metric])))
  const candidate = pairs.map(pair => median(pair.candidate.map(sample => sample[metric])))
  if (stable.some(value => value === 0)) return {
    metric, stableMs: median(stable), candidateMs: median(candidate), ratio: null,
    ratioInterval: null, differenceInterval: null, verdict: 'inconclusive', reason: 'below-clock-resolution',
  }
  const ratios = candidate.map((value, i) => value / stable[i])
  const differences = candidate.map((value, i) => value - stable[i])
  const alpha = 0.05 / comparisons
  const ratioInterval = medianInterval(ratios, alpha)
  const differenceInterval = medianInterval(differences, alpha)
  const orderRatios = [0, 1].map(parity => median(ratios.filter((_, i) => i % 2 === parity)))
  const orderSensitive = Math.abs(orderRatios[0] - orderRatios[1]) > 0.05 &&
    Math.abs(orderRatios[0] - orderRatios[1]) * median(stable) > 1
  let verdict = 'inconclusive'
  if (pairs.length >= 12 && ratioInterval && differenceInterval) {
    if (ratioInterval[0] > 1.05 && differenceInterval[0] > 1) verdict = 'regression'
    // Order effects block a clean bill of health, not a slowdown already supported
    // by both lower bounds. Keep the order diagnostic even when the gate fails.
    else if (!orderSensitive && (ratioInterval[1] <= 1.05 || differenceInterval[1] <= 1)) verdict = 'no-regression-detected'
  }
  return {
    metric, stableMs: median(stable), candidateMs: median(candidate),
    ratio: median(ratios), differenceMs: median(differences),
    ratioInterval, differenceInterval, confidence: 1 - alpha,
    orderRatios, orderSensitive, verdict,
  }
}
