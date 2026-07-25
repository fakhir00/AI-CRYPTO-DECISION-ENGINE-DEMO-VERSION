#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// CLI: Run Production Backtest with Walk-Forward Split
// ═══════════════════════════════════════════════════════
// Usage: node scripts/run-backtest.mjs
//
// Runs BTC, ETH, SOL over 6 months with:
// - Production scoring.yaml config (all 7 categories, min_score 0.80)
// - Binance taker fees (0.04%) + slippage (0.05%) on every trade
// - In-sample: Jan 25 – Apr 30, 2026
// - Out-of-sample: May 1 – Jul 25, 2026

import { fetchAllData, backtestSymbol, PRODUCTION_CONFIG, COST_PER_SIDE } from '../lib/backtest/runner.js';
import { computeMetrics } from '../lib/backtest/metrics.js';
import { getUniverse } from '../lib/ingestion/universe.js';

const START = new Date('2026-01-25T00:00:00Z').getTime();
const END = Date.now();
const SPLIT = new Date('2026-05-01T00:00:00Z').getTime();

const SYMBOLS = await getUniverse();

console.log(`\n🧪 PRODUCTION BACKTEST — Walk-Forward Split`);
console.log(`   Config: min_score=${PRODUCTION_CONFIG.signal.min_score}, ATR×${PRODUCTION_CONFIG.levels.stop_atr_multiplier}`);
console.log(`   Exits:  Splits ${JSON.stringify(PRODUCTION_CONFIG.exits.scale_out_splits)}`);
console.log(`   Fees: ${(COST_PER_SIDE * 100).toFixed(2)}% per side (${((COST_PER_SIDE * 2) * 100).toFixed(2)}% round-trip)`);
console.log(`   Universe: ${SYMBOLS.length} dynamic symbols`);
console.log(`   In-sample:      Jan 25 – Apr 30, 2026`);
console.log(`   Out-of-sample:  May 1  – Jul 25, 2026\n`);

// Fetch Fear & Greed once (global, not per-symbol)
console.log('[backtest] Fetching global Fear & Greed history...');
let fngRes;
try {
  const res = await fetch('https://api.alternative.me/fng/?limit=200&format=json');
  const json = await res.json();
  fngRes = (json.data || []).map(d => ({ ts: parseInt(d.timestamp, 10) * 1000, value: +d.value, label: d.value_classification }));
  fngRes.sort((a, b) => a.ts - b.ts);
  console.log(`[backtest]   Fear & Greed: ${fngRes.length} daily records\n`);
} catch { fngRes = []; console.log('[backtest]   Fear & Greed: fetch failed, proceeding without\n'); }

const fullResults = {};

for (const symbol of SYMBOLS) {
  const { candles, funding } = await fetchAllData(symbol, START, END);

  if (candles.length < 400) {
    console.log(`⚠️  ${symbol}: insufficient data (${candles.length} candles), skipping\n`);
    continue;
  }

  // Run full period
  const fullResult = await backtestSymbol({
    symbol, candles, funding, fng: fngRes,
    cfg: PRODUCTION_CONFIG,
    onProgress: ({ progress }) => process.stdout.write(`\r  ${symbol}: ${progress}%`),
  });
  console.log('');

  // Split signals by candle timestamp
  const trainSignals = fullResult.signals.filter(s => s.candleTime < SPLIT);
  const testSignals = fullResult.signals.filter(s => s.candleTime >= SPLIT);

  const trainMetrics = computeMetrics(trainSignals);
  const testMetrics = computeMetrics(testSignals);
  const fullMetrics = fullResult.metrics;
  
  fullResults[symbol] = { 
    trainMetrics, testMetrics, fullMetrics, 
    count: fullResult.signals.length,
    testSignals 
  };

  // Report
  console.log(`\n  ══════════════════ ${symbol} ══════════════════`);
  printMetrics('IN-SAMPLE  (Jan–Apr)', trainMetrics, trainSignals.length);
  printMetrics('OUT-OF-SAMPLE (May–Jul)', testMetrics, testSignals.length);
  printMetrics('COMBINED   (Full 6mo)', fullMetrics, fullResult.signals.length);
  console.log('');
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumX2 = x.reduce((a, b) => a + b * b, 0);
  const sumY2 = y.reduce((a, b) => a + b * b, 0);
  const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
  const num = (n * sumXY) - (sumX * sumY);
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (den === 0) return 0;
  return num / den;
}

console.log('  ════════ OOS DAILY RETURN CORRELATION ════════');
const allDays = new Set();
const dailyReturns = {};
for (const sym of SYMBOLS) {
  if (!fullResults[sym]) continue;
  dailyReturns[sym] = {};
  for (const s of fullResults[sym].testSignals) {
    const day = new Date(s.candleTime).toISOString().split('T')[0];
    dailyReturns[sym][day] = (dailyReturns[sym][day] || 0) + (s.outcome.rMultiple || 0);
    allDays.add(day);
  }
}
const days = Array.from(allDays).sort();
const symKeys = Object.keys(dailyReturns);

for (let i = 0; i < symKeys.length; i++) {
  for (let j = i + 1; j < symKeys.length; j++) {
    const s1 = symKeys[i];
    const s2 = symKeys[j];
    const x = [], y = [];
    for (const d of days) {
      if (dailyReturns[s1][d] !== undefined || dailyReturns[s2][d] !== undefined) {
        x.push(dailyReturns[s1][d] || 0);
        y.push(dailyReturns[s2][d] || 0);
      }
    }
    const corr = pearsonCorrelation(x, y);
    console.log(`  ${s1} <-> ${s2}: ${corr > 0.5 ? '🔴 ' : corr < 0 ? '🟢 ' : '⚪️ '}${corr.toFixed(3)}`);
  }
}
console.log('');

console.log('⛔ CHECKPOINT: Review in-sample vs out-of-sample metrics above.');
console.log('   If OOS performance degrades significantly, consider tuning scoring.yaml.');
console.log('   Do NOT wire signal delivery until approved.\n');

function printMetrics(label, m, count) {
  console.log(`  ┌─ ${label}`);
  console.log(`  │  Signals: ${count}  |  WinRate: ${m.winRate}% [95% CI: ${m.winRateCI[0]}% - ${m.winRateCI[1]}%] (W:${m.wins} L:${m.losses} BE:${m.breakevens})`);
  console.log(`  │  Avg R: ${m.avgRMultiple}  |  Max DD: ${m.maxDrawdown}R  |  PF: ${m.profitFactor}`);
  if (m.tpDistribution && Object.keys(m.tpDistribution).length > 0) {
    console.log(`  │  TP dist: ${JSON.stringify(m.tpDistribution)}`);
  }
  const maxScoreStr = m.maxConfluenceScore != null ? m.maxConfluenceScore.toFixed(3) : 'N/A';
  console.log(`  └─ Total R: ${m.totalRMultiple}  |  Best: ${m.bestTrade}R  |  Worst: ${m.worstTrade}R  |  Max Score: ${maxScoreStr}`);
}
