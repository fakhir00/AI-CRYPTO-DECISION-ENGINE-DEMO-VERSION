// ═══════════════════════════════════════════════════════
// Scoring Category: Volatility (ATR + Bollinger Bands)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

export function scoreVolatility(index, symbol, cfg = {}) {
  const squeezeThreshold   = cfg.bb_squeeze_threshold   ?? 0.02;
  const expansionThreshold = cfg.bb_expansion_threshold ?? 0.06;

  let score = 0;
  const factors = [];

  // ─── Bollinger Bands ───────────────────────────────
  const bb = lookup(index, symbol, 'bbands');
  const price = lookup(index, symbol, 'price');

  if (bb && price != null) {
    const width = bb.middle > 0 ? (bb.upper - bb.lower) / bb.middle : 0;

    if (width < squeezeThreshold) {
      // Squeeze = low vol, anticipate expansion. Directionally neutral but tradeable.
      score += 0.5;
      factors.push(`BB squeeze (width: ${(width * 100).toFixed(2)}%) — expansion imminent`);
    } else if (width > expansionThreshold) {
      // Wide bands = high vol, mean-reversion likely
      score -= 0.3;
      factors.push(`BB wide (width: ${(width * 100).toFixed(2)}%) — extended move`);
    }

    // Price position within bands
    if (price <= bb.lower) {
      score += 0.6;
      factors.push('Price at lower BB — oversold');
    } else if (price >= bb.upper) {
      score -= 0.6;
      factors.push('Price at upper BB — overbought');
    } else if (bb.middle > 0) {
      const pctFromMid = (price - bb.middle) / (bb.upper - bb.middle);
      if (pctFromMid > 0.5) {
        score -= 0.2;
        factors.push('Price in upper half of BB');
      } else if (pctFromMid < -0.5) {
        score += 0.2;
        factors.push('Price in lower half of BB');
      }
    }
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
