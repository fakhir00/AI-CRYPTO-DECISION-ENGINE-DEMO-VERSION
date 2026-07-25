// ═══════════════════════════════════════════════════════
// Scoring Category: Sentiment (Fear&Greed + LunarCrush)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

export function scoreSentiment(index, symbol, cfg = {}) {
  const fngFear  = cfg.fng_extreme_fear  ?? 20;
  const fngGreed = cfg.fng_extreme_greed ?? 80;
  const gsBull   = cfg.galaxy_bullish    ?? 70;
  const gsBear   = cfg.galaxy_bearish    ?? 30;

  let score = 0;
  const factors = [];

  // ─── Fear & Greed Index (global, contrarian) ───────
  const fng = lookup(index, '*', 'fear_greed');
  if (fng?.value != null) {
    if (fng.value <= fngFear) {
      score += 1.0; // Extreme fear = contrarian bullish
      factors.push(`Fear & Greed: ${fng.value} (${fng.label}) — extreme fear, contrarian bullish`);
    } else if (fng.value >= fngGreed) {
      score -= 1.0; // Extreme greed = contrarian bearish
      factors.push(`Fear & Greed: ${fng.value} (${fng.label}) — extreme greed, contrarian bearish`);
    } else if (fng.value < 40) {
      score += 0.3;
      factors.push(`Fear & Greed: ${fng.value} (${fng.label}) — mild fear`);
    } else if (fng.value > 60) {
      score -= 0.3;
      factors.push(`Fear & Greed: ${fng.value} (${fng.label}) — mild greed`);
    } else {
      factors.push(`Fear & Greed: ${fng.value} (${fng.label}) — neutral`);
    }
  }

  // ─── LunarCrush Social (per-coin, trend-following) ─
  const social = lookup(index, symbol, 'social');
  if (social) {
    const gs = social.galaxyScore ?? social.galaxy_score;
    if (gs != null) {
      if (gs >= gsBull) {
        score += 0.7;
        factors.push(`Galaxy Score: ${gs} — strong social momentum`);
      } else if (gs <= gsBear) {
        score -= 0.5;
        factors.push(`Galaxy Score: ${gs} — weak social momentum`);
      } else {
        factors.push(`Galaxy Score: ${gs} — neutral`);
      }
    }
    if (social.sentiment != null) {
      const s = Number(social.sentiment);
      if (s > 3.5) { score += 0.3; factors.push(`Social sentiment bullish (${s.toFixed(1)})`); }
      else if (s < 2.5) { score -= 0.3; factors.push(`Social sentiment bearish (${s.toFixed(1)})`); }
    }
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
