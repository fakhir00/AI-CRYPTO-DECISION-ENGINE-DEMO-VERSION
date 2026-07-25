// ═══════════════════════════════════════════════════════
// ATR-Scaled Trade Levels Calculator
// ═══════════════════════════════════════════════════════
// Computes entry ladder, stop-loss, and take-profit targets
// from price + kline data. Pure math — no API calls.

/**
 * Compute Average True Range from candle data.
 * @param {Array} candles - [{high, low, close}, ...]
 * @param {number} period
 * @returns {number} ATR value
 */
export function computeATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - pc.close), Math.abs(c.low - pc.close)));
  }
  if (trs.length < period) return 0;
  // Wilder's smoothing
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
  }
  return atr;
}

/**
 * Build trade levels for a signal.
 * @param {object} params
 * @param {number} params.price - Current price
 * @param {string} params.direction - 'long' or 'short'
 * @param {number} params.atr - ATR value
 * @param {object} params.cfg - levels config from scoring.yaml
 * @returns {object|null} { entries, stopLoss, takeProfit, riskPct, rrToTp2 }
 */
export function buildLevels({ price, direction, atr, cfg = {} }) {
  if (!price || !atr || atr <= 0) return null;

  const spreadPct    = cfg.entry_spread_pct    ?? 0.35;
  const stopMultiple = cfg.stop_atr_multiplier ?? 1.5;
  const tp1R         = cfg.tp1_r ?? 1.0;
  const tp2R         = cfg.tp2_r ?? 2.0;
  const tp3R         = cfg.tp3_r ?? 3.0;
  const tp4R         = cfg.tp4_r ?? 5.0;
  const maxStopPct   = cfg.max_stop_pct ?? 3.0;
  const minRrTp2     = cfg.min_rr_tp2 ?? 1.5;

  const isLong = direction === 'long';
  const sign = isLong ? 1 : -1;
  const spreadAbs = price * (spreadPct / 100);

  // Entry ladder: 3 prices centered near current price
  const entry1 = price;
  const entry2 = price - sign * spreadAbs;
  const entry3 = price - sign * spreadAbs * 2;
  const avgEntry = (entry1 + entry2 + entry3) / 3;

  // Stop-loss: ATR-scaled from worst entry
  const stopDistance = atr * stopMultiple;
  const stopLoss = isLong
    ? Math.min(entry3, avgEntry) - stopDistance
    : Math.max(entry3, avgEntry) + stopDistance;

  // Risk % from avg entry
  const riskPct = Math.abs(avgEntry - stopLoss) / avgEntry * 100;
  if (riskPct > maxStopPct) return null; // Stop too wide

  // Take-profits: R-multiples (risk = |avgEntry - stopLoss|)
  const risk = Math.abs(avgEntry - stopLoss);
  const tp1 = avgEntry + sign * risk * tp1R;
  const tp2 = avgEntry + sign * risk * tp2R;
  const tp3 = avgEntry + sign * risk * tp3R;
  const tp4 = avgEntry + sign * risk * tp4R;

  // R:R to TP2
  const rrToTp2 = risk > 0 ? (Math.abs(tp2 - avgEntry) / risk) : 0;
  if (rrToTp2 < minRrTp2) return null; // Insufficient R:R

  return {
    entries: [round(entry1), round(entry2), round(entry3)],
    avgEntry: round(avgEntry),
    stopLoss: round(stopLoss),
    takeProfit: [round(tp1), round(tp2), round(tp3), round(tp4)],
    riskPct: parseFloat(riskPct.toFixed(2)),
    rrToTp2: parseFloat(rrToTp2.toFixed(2)),
    atr: round(atr),
    atrPct: parseFloat((atr / price * 100).toFixed(3)),
  };
}

function round(v) {
  if (v >= 1000) return parseFloat(v.toFixed(2));
  if (v >= 1)    return parseFloat(v.toFixed(4));
  return parseFloat(v.toFixed(6));
}
