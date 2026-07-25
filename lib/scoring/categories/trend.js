// ═══════════════════════════════════════════════════════
// Scoring Category: Trend (EMA50/200 + MACD)
// ═══════════════════════════════════════════════════════
// Output: score from -2 (strong bearish) to +2 (strong bullish)

import { lookup } from '../../ingestion/schema.js';

/**
 * Score the trend category for a symbol.
 * @param {Map} index - DataPoint index from ingestion
 * @param {string} symbol
 * @returns {{ score: number, factors: string[] }}
 */
export function scoreTrend(index, symbol) {
  let score = 0;
  const factors = [];

  // ─── EMA Crossover ─────────────────────────────────
  const ema50  = lookup(index, symbol, 'ema_50');
  const ema200 = lookup(index, symbol, 'ema_200');
  const price  = lookup(index, symbol, 'price');

  if (ema50 != null && ema200 != null) {
    if (ema50 > ema200) {
      score += 0.8;
      factors.push('EMA50 > EMA200 (golden cross zone)');
    } else {
      score -= 0.8;
      factors.push('EMA50 < EMA200 (death cross zone)');
    }
  }

  if (price != null && ema50 != null) {
    if (price > ema50) {
      score += 0.4;
      factors.push('Price above EMA50');
    } else {
      score -= 0.4;
      factors.push('Price below EMA50');
    }
  }

  // ─── MACD ──────────────────────────────────────────
  const macd = lookup(index, symbol, 'macd');
  if (macd) {
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      score += 0.6;
      factors.push(`MACD bullish (hist: ${macd.histogram.toFixed(4)})`);
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      score -= 0.6;
      factors.push(`MACD bearish (hist: ${macd.histogram.toFixed(4)})`);
    }
    // Histogram momentum (expanding vs contracting)
    if (macd.histogram > 0 && macd.macd > 0) {
      score += 0.2;
      factors.push('MACD histogram expanding bullish');
    } else if (macd.histogram < 0 && macd.macd < 0) {
      score -= 0.2;
      factors.push('MACD histogram expanding bearish');
    }
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
