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

// CLEAN UNIVERSE: Point-in-time verified 9-asset set.
// Only assets that had ≥$50M trailing-30d avg daily volume on Jan 25, 2026.
// 7 core (always liquid) + 2 borderline that passed: ZEC ($139M), SUI ($70M).
// Excluded (never crossed or OOS-only): DEXE, VANA, WLD, KAITO, ACE, NEAR, AVAX, UNI.
const SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ZEC', 'DOGE', 'TRX', 'SUI'
];

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
    signals: fullResult.signals,
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
// CATEGORY DECAY ANALYSIS (v2 — with z-test, score comparison, volatility investigation)
// ========================================================
console.log('  ════════ CATEGORY DECAY ANALYSIS (v2) ════════');
const BETA_CLUSTER = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'];
// KAITO removed — never crossed $50M volume threshold. TRX+BNB remain.
const IDIO_CLUSTER = ['TRX', 'BNB'];

const CATEGORIES = Object.keys(PRODUCTION_CONFIG.weights || {});

// Two-proportion z-test: H0: p1 == p2
function zTestTwoProportions(x1, n1, x2, n2) {
  if (n1 === 0 || n2 === 0) return { z: 0, p: 1.0 };
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, p: 1.0 };
  const z = (p1 - p2) / se;
  // Approximate two-tailed p-value from z using normal CDF
  const absZ = Math.abs(z);
  const p = 2 * (1 - normalCDF(absZ));
  return { z: parseFloat(z.toFixed(3)), p: parseFloat(p.toFixed(4)) };
}

// Standard normal CDF approximation (Abramowitz & Stegun)
function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function analyzeDecay(clusterSymbols, label) {
  let isWins = 0, isLosses = 0, oosWins = 0, oosLosses = 0;
  
  const stats = {};
  for (const cat of CATEGORIES) {
    stats[cat] = {
      isWinsCount: 0, isWinsAgreed: 0, isWinsExcluded: 0, isWinsDisagreed: 0, isWinsScoreSum: 0,
      oosLossesCount: 0, oosLossesAgreed: 0, oosLossesExcluded: 0, oosLossesDisagreed: 0, oosLossesScoreSum: 0,
    };
  }

  // Also track volatility exclusion by IS/OOS period (not just win/loss)
  const volExclByPeriod = { is: 0, isTotal: 0, oos: 0, oosTotal: 0 };

  for (const sym of clusterSymbols) {
    if (!fullResults[sym]) continue;
    
    for (const sig of fullResults[sym].signals) {
      if (sig.outcome?.result === 'no_levels') continue;
      
      const r = sig.outcome?.rMultiple || 0;
      if (r === 0) continue;
      
      const isWin = r > 0;
      const isOOS = sig.candleTime >= SPLIT;
      
      if (!isOOS && isWin) isWins++;
      if (!isOOS && !isWin) isLosses++;
      if (isOOS && isWin) oosWins++;
      if (isOOS && !isWin) oosLosses++;

      // Track volatility exclusion across ALL trades by period
      const volObj = sig.contributingFactors?.volatility || {};
      const volScore = volObj.score || 0;
      const volFactors = volObj.factors || [];
      if (!isOOS) {
        volExclByPeriod.isTotal++;
        if (volScore === 0 && volFactors.length === 0) volExclByPeriod.is++;
      } else {
        volExclByPeriod.oosTotal++;
        if (volScore === 0 && volFactors.length === 0) volExclByPeriod.oos++;
      }

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
  console.log(`  IS Wins: ${isWins}  IS Losses: ${isLosses}  |  OOS Wins: ${oosWins}  OOS Losses: ${oosLosses}`);
  console.log('');
  console.log('  | Category | Type | IS Win Involv. | OOS Loss Involv. | Δ Shift | Z-stat | p-value | Avg Score (IS W) | Avg Score (OOS L) | Score Δ | Excl (IS/OOS) |');
  console.log('  | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (const cat of CATEGORIES) {
    const s = stats[cat];
    const p1 = s.isWinsCount > 0 ? (s.isWinsAgreed / s.isWinsCount) : 0;
    const p2 = s.oosLossesCount > 0 ? (s.oosLossesAgreed / s.oosLossesCount) : 0;
    const shift = p2 - p1;
    
    const avgScoreIS = s.isWinsAgreed > 0 ? (s.isWinsScoreSum / s.isWinsAgreed) : 0;
    const avgScoreOOS = s.oosLossesAgreed > 0 ? (s.oosLossesScoreSum / s.oosLossesAgreed) : 0;
    const scoreDelta = avgScoreOOS - avgScoreIS;
    
    // Z-test on involvement rates
    const zt = zTestTwoProportions(s.isWinsAgreed, s.isWinsCount, s.oosLossesAgreed, s.oosLossesCount);
    
    // Architecture label: GATE if 100% involvement in both buckets, VOTER otherwise
    const isGate = (s.isWinsExcluded === 0 && s.oosLossesExcluded === 0 && p1 === 1.0 && p2 === 1.0);
    const isNoData = (s.isWinsCount === 0 && s.oosLossesCount === 0);
    const catType = isNoData ? 'NO DATA' : isGate ? 'GATE' : 'VOTER';
    
    const sig = zt.p < 0.05 ? ' ⚠️' : '';
    
    console.log(`  | **${cat}** | ${catType} | ${(p1*100).toFixed(1)}% (${s.isWinsAgreed}/${s.isWinsCount}) | ${(p2*100).toFixed(1)}% (${s.oosLossesAgreed}/${s.oosLossesCount}) | ${(shift*100).toFixed(1)}% | ${zt.z} | ${zt.p}${sig} | ${avgScoreIS.toFixed(3)} | ${avgScoreOOS.toFixed(3)} | ${scoreDelta > 0 ? '+' : ''}${scoreDelta.toFixed(3)} | ${s.isWinsExcluded}/${s.oosLossesExcluded} |`);
  }

  // Volatility exclusion investigation
  const isExclPct = volExclByPeriod.isTotal > 0 ? (volExclByPeriod.is / volExclByPeriod.isTotal * 100) : 0;
  const oosExclPct = volExclByPeriod.oosTotal > 0 ? (volExclByPeriod.oos / volExclByPeriod.oosTotal * 100) : 0;
  console.log(`\n  📊 VOLATILITY EXCLUSION INVESTIGATION:`);
  console.log(`     IS period (all trades):  ${volExclByPeriod.is}/${volExclByPeriod.isTotal} excluded (${isExclPct.toFixed(1)}%)`);
  console.log(`     OOS period (all trades): ${volExclByPeriod.oos}/${volExclByPeriod.oosTotal} excluded (${oosExclPct.toFixed(1)}%)`);
  console.log(`     When volatility is excluded, its ${(PRODUCTION_CONFIG.weights?.volatility ?? 0.10)*100}% weight is renormalized across remaining categories.`);
  if (oosExclPct > isExclPct + 5) {
    console.log(`     ⚠️  OOS exclusion rate is ${(oosExclPct - isExclPct).toFixed(1)} ppt higher than IS — these OOS trades were scored on a different effective weight distribution.`);
  }
}

analyzeDecay(BETA_CLUSTER, 'BETA CLUSTER (BTC, ETH, SOL, XRP, BNB)');
analyzeDecay(IDIO_CLUSTER, 'IDIOSYNCRATIC CLUSTER (TRX, BNB) — KAITO removed (never crossed $50M vol)');

console.log('\n⛔ CHECKPOINT: Review in-sample vs out-of-sample metrics above.');
console.log('   Clean 9-asset universe: 7 core + ZEC + SUI (point-in-time verified).');
console.log('   Do NOT wire signal delivery until approved.\n');

function printMetrics(label, m) {
  console.log(`  ┌─ ${label}`);
  const ciStr = Array.isArray(m.winRateCI) ? `[95% CI: ${m.winRateCI[0]}% - ${m.winRateCI[1]}%]` : '[95% CI: N/A]';
  console.log(`  │  Signals: ${m.totalSignals}  |  WinRate: ${m.winRate}% ${ciStr} (W:${m.wins} L:${m.losses} BE:${m.breakevens} Open:${m.expired} Rej:${m.rejected})`);
  console.log(`  │  Avg R: ${m.avgRMultiple}  |  Max DD: ${m.maxDrawdown}R  |  PF: ${m.profitFactor}`);
  if (m.tpDistribution && Object.keys(m.tpDistribution).length > 0) {
    console.log(`  │  TP dist: ${JSON.stringify(m.tpDistribution)}`);
  }
  const maxScoreStr = m.maxConfluenceScore != null ? m.maxConfluenceScore.toFixed(3) : 'N/A';
  console.log(`  └─ Total R: ${m.totalRMultiple}  |  Best: ${m.bestTrade}R  |  Worst: ${m.worstTrade}R  |  Max Score: ${maxScoreStr}`);
}
