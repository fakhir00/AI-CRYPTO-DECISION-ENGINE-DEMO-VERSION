// ═══════════════════════════════════════════════════════
// Backtest Metrics — Win rate, avg R, max drawdown, frequency
// ═══════════════════════════════════════════════════════

/**
 * Compute performance metrics from backtest signals.
 * @param {Array} signals - Array of { outcome: { result, rMultiple, barsHeld } }
 * @returns {object} Metrics object
 */
export function computeMetrics(signals = []) {
  if (signals.length === 0) {
    return {
      totalSignals: 0, wins: 0, losses: 0, expired: 0,
      winRate: 0, avgRMultiple: 0, maxDrawdown: 0,
      profitFactor: 0, avgBarsHeld: 0, signalFrequency: 'N/A',
      tpDistribution: {}, bestTrade: null, worstTrade: null,
    };
  }

  let wins = 0, losses = 0, breakevens = 0, expired = 0;
  let totalR = 0, maxR = -Infinity, minR = Infinity;
  let totalBars = 0;
  let peak = 0, equity = 0, maxDrawdown = 0;
  let grossProfit = 0, grossLoss = 0;
  const tpDist = {};

  for (const sig of signals) {
    const o = sig.outcome || {};
    const r = o.rMultiple ?? 0;
    totalR += r;
    totalBars += o.barsHeld ?? 0;

    if (r > maxR) maxR = r;
    if (r < minR) minR = r;

    // Strict PnL outcome definition with fee tolerance band
    const EPSILON = 0.05; // 0.05R tolerance for fee drag
    if (r > EPSILON) {
      wins++;
      grossProfit += r;
    } else if (r < -EPSILON) {
      losses++;
      grossLoss += Math.abs(r);
    } else {
      breakevens++;
      if (r > 0) grossProfit += r;
      else grossLoss += Math.abs(r);
    }
    
    // Additional categorization
    if (o.result === 'expired' || o.result?.includes('_expired')) {
      expired++;
    }
    
    // Track highest TP hit for distribution
    if (o.tpLevel > 0) {
      tpDist[`tp${o.tpLevel}`] = (tpDist[`tp${o.tpLevel}`] || 0) + 1;
    }

    // Equity curve for max drawdown
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const total = signals.length;
  const winRate = total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : 0;
  
  // 95% Wilson Score Interval for Win Rate
  let winRateCI = [0, 0];
  if (total > 0) {
    const z = 1.96;
    const p = wins / total;
    const n = total;
    const denom = 1 + z * z / n;
    const term1 = p + z * z / (2 * n);
    const term2 = z * Math.sqrt((p * (1 - p) / n) + (z * z / (4 * n * n)));
    winRateCI = [
      parseFloat(((term1 - term2) / denom * 100).toFixed(1)),
      parseFloat(((term1 + term2) / denom * 100).toFixed(1))
    ];
  }

  const avgR = total > 0 ? parseFloat((totalR / total).toFixed(3)) : 0;
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;
  const avgBars = total > 0 ? Math.round(totalBars / total) : 0;

  // Signal frequency: avg signals per day
  // Assume 96 15m candles per day, step=4 → 24 evaluations/day
  const firstIdx = signals[0]?.candleIndex ?? 0;
  const lastIdx = signals[signals.length - 1]?.candleIndex ?? 0;
  const spanCandles = lastIdx - firstIdx || 1;
  const spanDays = spanCandles / 96;
  const perDay = spanDays > 0 ? (total / spanDays).toFixed(2) : 'N/A';

  return {
    totalSignals: total,
    wins,
    losses,
    breakevens,
    expired,
    winRate,
    winRateCI,
    avgRMultiple: avgR,
    maxDrawdown: parseFloat(maxDrawdown.toFixed(3)),
    profitFactor,
    avgBarsHeld: avgBars,
    signalFrequency: `${perDay} signals/day`,
    tpDistribution: tpDist,
    bestTrade: maxR !== -Infinity ? parseFloat(maxR.toFixed(3)) : null,
    worstTrade: minR !== Infinity ? parseFloat(minR.toFixed(3)) : null,
    totalRMultiple: parseFloat(totalR.toFixed(3)),
  };
}
