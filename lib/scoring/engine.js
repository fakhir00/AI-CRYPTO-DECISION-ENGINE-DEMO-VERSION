// ═══════════════════════════════════════════════════════
// Composite Scoring Engine
// ═══════════════════════════════════════════════════════
// Runs all 7 category scorers against the ingestion DataPoint
// index, computes the weighted confluence score, and evaluates
// whether to fire a signal.

import { indexBySymbolMetric } from '../ingestion/schema.js';
import { scoreTrend } from './categories/trend.js';
import { scoreMomentum } from './categories/momentum.js';
import { scoreDerivatives } from './categories/derivatives.js';
import { scoreVolatility } from './categories/volatility.js';
import { scoreSentiment } from './categories/sentiment.js';
import { scoreOnchain } from './categories/onchain.js';
import { scoreNews } from './categories/news.js';
import { evaluateSignal } from './signal-generator.js';

// Default weights — can be overridden by scoring.yaml config
const DEFAULT_WEIGHTS = {
  trend:       0.20,
  momentum:    0.20,
  derivatives: 0.15,
  volatility:  0.10,
  sentiment:   0.15,
  onchain:     0.10,
  news:        0.10,
};

/**
 * Score a single symbol against all categories.
 * @param {Map} index - DataPoint index from indexBySymbolMetric()
 * @param {string} symbol
 * @param {object} cfg - Full config from scoring.yaml
 * @returns {object} { symbol, scores, confluenceScore, direction }
 */
export function scoreSymbol(index, symbol, cfg = {}) {
  const weights = cfg.weights || DEFAULT_WEIGHTS;

  const scores = {
    trend:       scoreTrend(index, symbol, cfg.trend),
    momentum:    scoreMomentum(index, symbol, cfg.momentum),
    derivatives: scoreDerivatives(index, symbol, cfg.derivatives),
    volatility:  scoreVolatility(index, symbol, cfg.volatility),
    sentiment:   scoreSentiment(index, symbol, cfg.sentiment),
    onchain:     scoreOnchain(index, symbol, cfg.onchain),
    news:        scoreNews(index, symbol, cfg.news),
  };

  // Weighted sum with missing data renormalization
  let rawScore = 0;
  let activeWeight = 0;
  
  for (const [cat, { score, factors }] of Object.entries(scores)) {
    const weight = weights[cat] ?? 0;
    // If a category returns score 0 and has NO factors, it signifies missing data
    if (score === 0 && (!factors || factors.length === 0)) {
      continue; // Skip this category from weight calculation
    }
    rawScore += score * weight;
    activeWeight += weight;
  }

  // Renormalize score so it's scaled relative to available data
  let confluenceScore = 0;
  if (activeWeight > 0) {
    confluenceScore = rawScore / activeWeight;
  }

  const direction = confluenceScore > 0 ? 'long' : confluenceScore < 0 ? 'short' : 'neutral';

  return {
    symbol: symbol.toUpperCase(),
    scores,
    confluenceScore: parseFloat(confluenceScore.toFixed(4)),
    direction,
  };
}

/**
 * Score multiple symbols and return any fired signals.
 * @param {DataPoint[]} dataPoints - Raw DataPoints from ingestion
 * @param {string[]} symbols - Symbols to evaluate
 * @param {object} cfg - Full config from scoring.yaml
 * @returns {{ results: object[], signals: object[] }}
 */
export function runScoringEngine(dataPoints, symbols, cfg = {}) {
  const index = indexBySymbolMetric(dataPoints);
  const results = [];
  const signals = [];

  for (const symbol of symbols) {
    const result = scoreSymbol(index, symbol, cfg);
    results.push(result);

    // Evaluate whether to fire a signal
    const signal = evaluateSignal({
      symbol,
      scores: result.scores,
      confluenceScore: result.confluenceScore,
      index,
      cfg: { ...cfg.signal, levels: cfg.levels },
    });

    if (signal) {
      signals.push(signal);
    }
  }

  return { results, signals };
}

/**
 * Convenience: ingest + score in one call.
 * @param {object} cfg - Full config
 * @returns {Promise<{ results, signals, report }>}
 */
export async function ingestAndScore(cfg = {}) {
  const { ingestAll } = await import('../ingestion/worker.js');
  const { points, report } = await ingestAll();
  const symbols = cfg.symbols || ['BTC', 'ETH', 'SOL'];
  const { results, signals } = runScoringEngine(points, symbols, cfg);
  return { results, signals, ingestionReport: { points, ...report } };
}

export { DEFAULT_WEIGHTS };
