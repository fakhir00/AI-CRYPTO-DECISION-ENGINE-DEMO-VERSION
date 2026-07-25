// ═══════════════════════════════════════════════════════
// Scoring Category: Derivatives (Funding Rate + OI)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

export function scoreDerivatives(index, symbol, cfg = {}) {
  const fundingExtreme  = cfg.funding_extreme  ?? 0.001;
  const fundingElevated = cfg.funding_elevated ?? 0.0005;
  const oiThreshold     = cfg.oi_change_threshold ?? 5.0;

  let score = 0;
  const factors = [];

  // ─── Funding Rate ──────────────────────────────────
  const fr = lookup(index, symbol, 'funding_rate');
  if (fr?.rate != null) {
    const rate = Math.abs(fr.rate);
    if (fr.rate > fundingExtreme) {
      // Extreme positive funding → longs overleveraged → contrarian bearish
      score -= 1.0;
      factors.push(`Funding extremely positive (${(fr.rate * 100).toFixed(4)}%) — longs crowded`);
    } else if (fr.rate < -fundingExtreme) {
      // Extreme negative → shorts overleveraged → contrarian bullish
      score += 1.0;
      factors.push(`Funding extremely negative (${(fr.rate * 100).toFixed(4)}%) — shorts crowded`);
    } else if (fr.rate > fundingElevated) {
      score -= 0.4;
      factors.push(`Funding elevated positive (${(fr.rate * 100).toFixed(4)}%)`);
    } else if (fr.rate < -fundingElevated) {
      score += 0.4;
      factors.push(`Funding elevated negative (${(fr.rate * 100).toFixed(4)}%)`);
    } else {
      factors.push(`Funding neutral (${(fr.rate * 100).toFixed(4)}%)`);
    }
  }

  // ─── Open Interest ─────────────────────────────────
  const oi = lookup(index, symbol, 'open_interest');
  if (oi?.oi != null) {
    // OI by itself is directionally neutral — high OI with rising price = bullish,
    // high OI with falling price = bearish. We note it as a factor.
    factors.push(`Open Interest: ${Number(oi.oi).toLocaleString()} contracts`);
    // Rising OI is captured across time by the scoring engine via historical comparison
    // For now, just register it as context.
  }

  // ─── Mark vs Index price spread ────────────────────
  if (fr?.markPrice != null && fr?.indexPrice != null) {
    const spread = ((fr.markPrice - fr.indexPrice) / fr.indexPrice) * 100;
    if (Math.abs(spread) > 0.1) {
      const direction = spread > 0 ? 'premium' : 'discount';
      score += spread > 0 ? -0.3 : 0.3;
      factors.push(`Mark ${direction} vs index (${spread.toFixed(3)}%)`);
    }
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
