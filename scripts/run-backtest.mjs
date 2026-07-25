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
  printMetrics('IN-SAMPLE  (Jan–Apr)', trainMetrics);
  printMetrics('OUT-OF-SAMPLE (May–Jul)', testMetrics);
  printMetrics('COMBINED   (Full 6mo)', fullMetrics);
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

console.log('  ════════ OOS DAILY REALIZED R CORRELATION ════════');
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

console.log('\\n  ════════ PROOF: DAILY REALIZED R AGGREGATION SAMPLE (OOS) ════════');
console.log('  BTC (last 5 days with activity):', Object.entries(dailyReturns.BTC || {}).filter(([d]) => d >= '2026-05-01').slice(-5));
console.log('  XRP (last 5 days with activity):', Object.entries(dailyReturns.XRP || {}).filter(([d]) => d >= '2026-05-01').slice(-5));
console.log('\\n  ════════ OOS DAILY REALIZED R CORRELATION ════════');

// Print Header
let header = '      ';
for (const s of symKeys) {
  header += s.padStart(6);
}
console.log(header);

// Print Matrix
for (let i = 0; i < symKeys.length; i++) {
  const s1 = symKeys[i];
  let row = s1.padEnd(6);
  for (let j = 0; j < symKeys.length; j++) {
    const s2 = symKeys[j];
    if (i === j) {
      row += '  1.00';
    } else {
      const x = [], y = [];
      for (const d of days) {
        if (dailyReturns[s1][d] !== undefined || dailyReturns[s2][d] !== undefined) {
          x.push(dailyReturns[s1][d] || 0);
          y.push(dailyReturns[s2][d] || 0);
        }
      }
      const corr = pearsonCorrelation(x, y);
      row += corr.toFixed(2).padStart(6);
    }
  }
  console.log(row);
}
console.log('');

// ========================================================
// CATEGORY DECAY ANALYSIS
// ========================================================
console.log('  ════════ CATEGORY DECAY ANALYSIS ════════');
const BETA_CLUSTER = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'];
const IDIO_CLUSTER = ['TRX', 'KAITO', 'BNB'];

const CATEGORIES = Object.keys(PRODUCTION_CONFIG.weights || {});

function analyzeDecay(clusterSymbols, label) {
  let isWins = 0, isLosses = 0, oosWins = 0, oosLosses = 0;
  
  // Track stats per category. We want:
  // For IS Wins vs OOS Losses (to find false positive decay)
  const stats = {};
  for (const cat of CATEGORIES) {
    stats[cat] = {
      isWinsCount: 0, isWinsAgreed: 0, isWinsExcluded: 0, isWinsDisagreed: 0, isWinsScoreSum: 0,
      oosLossesCount: 0, oosLossesAgreed: 0, oosLossesExcluded: 0, oosLossesDisagreed: 0, oosLossesScoreSum: 0,
    };
  }

  for (const sym of clusterSymbols) {
    if (!fullResults[sym]) continue;
    
    for (const sig of fullResults[sym].signals) {
      if (sig.outcome?.result === 'no_levels') continue;
      
      const r = sig.outcome?.rMultiple || 0;
      if (r === 0) continue; // ignore breakeven/expired
      
      const isWin = r > 0;
      const isOOS = sig.candleTime >= SPLIT;
      
      // Update bucket counts
      if (!isOOS && isWin) isWins++;
      if (!isOOS && !isWin) isLosses++;
      if (isOOS && isWin) oosWins++;
      if (isOOS && !isWin) oosLosses++;

      const targetBucket = (!isOOS && isWin) ? 'isWins' : (isOOS && !isWin) ? 'oosLosses' : null;
      if (!targetBucket) continue;

      for (const cat of CATEGORIES) {
        const factorObj = sig.contributingFactors?.[cat] || {};
        const score = factorObj.score || 0;
        const factors = factorObj.factors || [];
        
        const catStats = stats[cat];
        
        if (score === 0 && factors.length === 0) {
          catStats[`${targetBucket}Excluded`]++;
        } else {
          catStats[`${targetBucket}Count`]++;
          
          const threshold = PRODUCTION_CONFIG.signal?.category_agreement_threshold ?? 0.3;
          const agreed = (sig.direction === 'long' && score >= threshold) || (sig.direction === 'short' && score <= -threshold);
          
          if (agreed) {
            catStats[`${targetBucket}Agreed`]++;
            catStats[`${targetBucket}ScoreSum`] += Math.abs(score);
          } else {
            catStats[`${targetBucket}Disagreed`]++;
          }
        }
      }
    }
  }

  console.log(`\n  --- ${label} ---`);
  console.log(`  IS Wins: ${isWins}  |  OOS Losses: ${oosLosses}`);
  console.log('  | Category | IS Win Involv. | OOS Loss Involv. | Δ Shift | Avg Score (OOS L) | Excl (IS/OOS) |');
  console.log('  | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (const cat of CATEGORIES) {
    const s = stats[cat];
    const p1 = s.isWinsCount > 0 ? (s.isWinsAgreed / s.isWinsCount) : 0;
    const p2 = s.oosLossesCount > 0 ? (s.oosLossesAgreed / s.oosLossesCount) : 0;
    const shift = p2 - p1;
    
    const avgScore = s.oosLossesAgreed > 0 ? (s.oosLossesScoreSum / s.oosLossesAgreed) : 0;
    
    console.log(`  | **${cat}** | ${(p1*100).toFixed(1)}% (${s.isWinsAgreed}/${s.isWinsCount}) | ${(p2*100).toFixed(1)}% (${s.oosLossesAgreed}/${s.oosLossesCount}) | ${(shift*100).toFixed(1)}% | ${avgScore.toFixed(3)} | ${s.isWinsExcluded}/${s.oosLossesExcluded} |`);
  }
}

analyzeDecay(BETA_CLUSTER, 'BETA CLUSTER (BTC, ETH, SOL, XRP, BNB)');
analyzeDecay(IDIO_CLUSTER, 'IDIOSYNCRATIC CLUSTER (TRX, KAITO, BNB)');

console.log('\n⛔ CHECKPOINT: Review in-sample vs out-of-sample metrics above.');
console.log('   If OOS performance degrades significantly, consider tuning scoring.yaml.');
console.log('   Do NOT wire signal delivery until approved.\n');

function printMetrics(label, m) {
  console.log(`  ┌─ ${label}`);
  console.log(`  │  Signals: ${m.totalSignals}  |  WinRate: ${m.winRate}% [95% CI: ${m.winRateCI[0]}% - ${m.winRateCI[1]}%] (W:${m.wins} L:${m.losses} BE:${m.breakevens} Open:${m.expired} Rej:${m.rejected})`);
  console.log(`  │  Avg R: ${m.avgRMultiple}  |  Max DD: ${m.maxDrawdown}R  |  PF: ${m.profitFactor}`);
  if (m.tpDistribution && Object.keys(m.tpDistribution).length > 0) {
    console.log(`  │  TP dist: ${JSON.stringify(m.tpDistribution)}`);
  }
  const maxScoreStr = m.maxConfluenceScore != null ? m.maxConfluenceScore.toFixed(3) : 'N/A';
  console.log(`  └─ Total R: ${m.totalRMultiple}  |  Best: ${m.bestTrade}R  |  Worst: ${m.worstTrade}R  |  Max Score: ${maxScoreStr}`);
}
