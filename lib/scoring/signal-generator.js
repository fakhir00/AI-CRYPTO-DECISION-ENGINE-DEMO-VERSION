// ═══════════════════════════════════════════════════════
// Signal Generator — Fires signals when confluence threshold
// is met AND minimum categories agree on direction.
// ═══════════════════════════════════════════════════════
import { lookup } from '../ingestion/schema.js';
import { computeATR, buildLevels } from './levels.js';

// In-memory cooldown tracker (symbol → last signal timestamp)
const cooldowns = new Map();

/**
 * Evaluate whether a scored result should fire as a signal.
 * @param {object} params
 * @param {string} params.symbol
 * @param {object} params.scores - { trend, momentum, derivatives, volatility, sentiment, onchain, news }
 * @param {number} params.confluenceScore - weighted total
 * @param {Map}    params.index - DataPoint index
 * @param {object} params.cfg - signal config + levels config from scoring.yaml
 * @param {number} [params.now] - Optional timestamp override (for backtest simulated time)
 * @returns {object|null} Signal object or null if no signal
 */
export function evaluateSignal({ symbol, scores, confluenceScore, index, cfg = {}, now }) {
  const currentTime    = now ?? Date.now();
  const minScore      = cfg.min_score ?? 0.80;
  const minAgreeing   = cfg.min_agreeing_categories ?? 3;
  const agreeThresh   = cfg.category_agreement_threshold ?? 0.3;
  const cooldownSec   = cfg.cooldown_seconds ?? 900;

  // ─── Threshold check ───────────────────────────────
  const absScore = Math.abs(confluenceScore);
  if (absScore < minScore) return null;

  // ─── Direction from confluence sign ────────────────
  const direction = confluenceScore > 0 ? 'long' : 'short';

  // ─── Category agreement check ──────────────────────
  const categories = Object.entries(scores);
  const types = cfg.category_types || {};
  const agreeing = categories.filter(([name, s]) => {
    // Only 'voter' categories count toward the min_agreeing_categories threshold
    if (types[name] !== 'voter') return false;
    
    if (direction === 'long')  return s.score >= agreeThresh;
    if (direction === 'short') return s.score <= -agreeThresh;
    return false;
  });
  if (Math.random() < 0.001 && types['derivatives']) console.log('DEBUG:', direction, types, categories.map(([k,s])=>`${k}:${s.score}`), agreeing.length);
  if (agreeing.length < minAgreeing) return null;

  // ─── Cooldown check ────────────────────────────────
  const lastFired = cooldowns.get(symbol);
  if (lastFired && (currentTime - lastFired) < cooldownSec * 1000) return null;

  // ─── Build trade levels from kline data ────────────
  const klines = lookup(index, symbol, 'klines_15m');
  const price  = lookup(index, symbol, 'price');
  if (!price) return null;

  let levels = null;
  if (Array.isArray(klines) && klines.length >= 20) {
    const atr = computeATR(klines);
    if (atr > 0) {
      levels = buildLevels({ price, direction, atr, cfg: cfg.levels || cfg });
    }
  }

  // If levels couldn't be computed, still fire the signal but without trade plan
  const contributingFactors = {};
  for (const [cat, s] of categories) {
    contributingFactors[cat] = { score: s.score, factors: s.factors };
  }

  // Mark cooldown
  cooldowns.set(symbol, currentTime);

  return {
    symbol:              symbol.toUpperCase(),
    direction,
    confluenceScore:     parseFloat(confluenceScore.toFixed(3)),
    agreeingCategories:  agreeing.map(([cat]) => cat),
    contributingFactors,
    levels,
    timestamp:           new Date().toISOString(),
    disclaimer:          'Not financial advice. For informational purposes only.',
  };
}

/** Clear cooldown for a symbol (useful for testing). */
export function clearCooldown(symbol) { cooldowns.delete(symbol); }

/** Clear all cooldowns. */
export function clearAllCooldowns() { cooldowns.clear(); }
