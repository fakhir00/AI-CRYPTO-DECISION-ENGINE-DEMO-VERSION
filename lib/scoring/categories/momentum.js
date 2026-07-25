// ═══════════════════════════════════════════════════════
// Scoring Category: Momentum (RSI + Stochastic)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

export function scoreMomentum(index, symbol, cfg = {}) {
  const rsiOB = cfg.rsi_overbought ?? 70;
  const rsiOS = cfg.rsi_oversold   ?? 30;
  const stochOB = cfg.stoch_overbought ?? 80;
  const stochOS = cfg.stoch_oversold   ?? 20;

  let score = 0;
  const factors = [];

  // ─── RSI ───────────────────────────────────────────
  const rsi = lookup(index, symbol, 'rsi_14');
  if (rsi != null) {
    if (rsi < rsiOS) {
      score += 1.0; // oversold = bullish reversal
      factors.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > rsiOB) {
      score -= 1.0; // overbought = bearish reversal
      factors.push(`RSI overbought (${rsi.toFixed(1)})`);
    } else if (rsi > 50) {
      score += 0.3;
      factors.push(`RSI bullish bias (${rsi.toFixed(1)})`);
    } else {
      score -= 0.3;
      factors.push(`RSI bearish bias (${rsi.toFixed(1)})`);
    }
  }

  // ─── Stochastic ────────────────────────────────────
  const stoch = lookup(index, symbol, 'stochastic');
  if (stoch) {
    const { k, d } = stoch;
    if (k < stochOS && d < stochOS) {
      score += 0.8;
      factors.push(`Stoch oversold (K:${k.toFixed(1)} D:${d.toFixed(1)})`);
    } else if (k > stochOB && d > stochOB) {
      score -= 0.8;
      factors.push(`Stoch overbought (K:${k.toFixed(1)} D:${d.toFixed(1)})`);
    }
    // K crossing D
    if (k > d && k < 50) {
      score += 0.2;
      factors.push('Stoch K crossed above D (bullish)');
    } else if (k < d && k > 50) {
      score -= 0.2;
      factors.push('Stoch K crossed below D (bearish)');
    }
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
