import fs from 'fs';
import { fetchAllData, fetchAllFNG, backtestSymbol } from '../lib/backtest/runner.js';
import { SCORING_CONFIG as PRODUCTION_CONFIG } from '../lib/config.js';

// Configuration
const BETA_CLUSTER = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB'];
const IDIO_CLUSTER = ['TRX', 'KAITO', 'BNB'];
const ALL_SYMBOLS = [...new Set([...BETA_CLUSTER, ...IDIO_CLUSTER])];

const START = new Date('2026-01-25T00:00:00Z').getTime();
const END = new Date('2026-07-26T00:00:00Z').getTime(); // Pin END time to strictly freeze the baseline
const SPLIT = new Date('2026-05-01T00:00:00Z').getTime();

const CATEGORIES = ['trend', 'momentum', 'derivatives', 'volatility', 'sentiment', 'onchain', 'news'];

async function runAnalysis() {
  console.log(`[decay-analysis] Fetching data and backtesting ${ALL_SYMBOLS.length} symbols...`);
  
  const fngRes = await fetchAllFNG();
  const signals = [];
  
  for (const sym of ALL_SYMBOLS) {
    const { candles, funding } = await fetchAllData(sym, START, END);
    const fng = fngRes;
    const fullResult = await backtestSymbol({
      symbol: sym, candles, funding, fng,
      cfg: PRODUCTION_CONFIG
    });
    
    // Add symbol to each signal
    for (const sig of fullResult.signals) {
      if (sig.outcome?.result !== 'no_levels') {
        signals.push(sig);
      }
    }
  }

  const buckets = {
    BETA_IS_WINS: [],
    BETA_IS_LOSSES: [],
    BETA_OOS_WINS: [],
    BETA_OOS_LOSSES: [],
    IDIO_IS_WINS: [],
    IDIO_IS_LOSSES: [],
    IDIO_OOS_WINS: [],
    IDIO_OOS_LOSSES: [],
  };

  // Group trades
  for (const sig of signals) {
    const r = sig.outcome?.rMultiple || 0;
    // Expired trades are ignored (R near 0). Valid wins/losses only.
    if (r === 0) continue; 
    
    const isWin = r > 0;
    const isOOS = sig.candleTime >= SPLIT;
    
    if (BETA_CLUSTER.includes(sig.symbol)) {
      const bucketName = `BETA_${isOOS ? 'OOS' : 'IS'}_${isWin ? 'WINS' : 'LOSSES'}`;
      buckets[bucketName].push(sig);
    }
    if (IDIO_CLUSTER.includes(sig.symbol)) {
      const bucketName = `IDIO_${isOOS ? 'OOS' : 'IS'}_${isWin ? 'WINS' : 'LOSSES'}`;
      buckets[bucketName].push(sig);
    }
  }

  // Calculate stats for a specific bucket and category
  function calcCategoryStats(bucket, cat) {
    let agreed = 0, disagreed = 0, excluded = 0;
    let sumAgreedScore = 0;

    for (const sig of bucket) {
      const factors = sig.contributingFactors?.[cat] || {};
      const score = factors.score || 0;
      const factorList = factors.factors || [];
      
      if (score === 0 && factorList.length === 0) {
        excluded++;
      } else {
        const threshold = PRODUCTION_CONFIG.category_agreement_threshold ?? 0.3;
        const isAgreed = (sig.direction === 'long' && score >= threshold) || 
                         (sig.direction === 'short' && score <= -threshold);
        if (isAgreed) {
          agreed++;
          sumAgreedScore += Math.abs(score);
        } else {
          disagreed++;
        }
      }
    }

    const validTrades = agreed + disagreed;
    const involvementRate = validTrades > 0 ? (agreed / validTrades) : 0;
    const avgScore = agreed > 0 ? (sumAgreedScore / agreed) : 0;

    return { agreed, disagreed, excluded, validTrades, involvementRate, avgScore };
  }

  // Two-proportion Z-test
  function calcZTest(p1, n1, p2, n2) {
    if (n1 === 0 || n2 === 0) return { z: 0, pVal: 1 };
    const pPool = ((p1 * n1) + (p2 * n2)) / (n1 + n2);
    if (pPool === 0 || pPool === 1) return { z: 0, pVal: 1 };
    
    const se = Math.sqrt(pPool * (1 - pPool) * (1/n1 + 1/n2));
    const z = (p1 - p2) / se;
    
    // 2-tailed p-value approx (simple erf)
    const pVal = 2 * (1 - normalCdf(Math.abs(z)));
    return { z, pVal };
  }

  function normalCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  console.log('\n======================================================');
  console.log('   BETA CLUSTER: DECAY ANALYSIS (IS Wins vs OOS Losses)');
  console.log('======================================================\n');
  console.log(`Bucket Sizes -> IS Wins: ${buckets.BETA_IS_WINS.length} trades | OOS Losses: ${buckets.BETA_OOS_LOSSES.length} trades\n`);
  
  console.log('| Category | IS Win Involv. | OOS Loss Involv. | Δ Shift | Z-Score (p-val) | Avg Score (OOS L) | Excl (IS/OOS) |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (const cat of CATEGORIES) {
    const isWins = calcCategoryStats(buckets.BETA_IS_WINS, cat);
    const oosLosses = calcCategoryStats(buckets.BETA_OOS_LOSSES, cat);
    
    const p1 = isWins.involvementRate;
    const n1 = isWins.validTrades;
    const p2 = oosLosses.involvementRate;
    const n2 = oosLosses.validTrades;
    
    const { z, pVal } = calcZTest(p1, n1, p2, n2);
    
    const isWinStr = `${(p1*100).toFixed(1)}% (${isWins.agreed}/${n1})`;
    const oosLossStr = `${(p2*100).toFixed(1)}% (${oosLosses.agreed}/${n2})`;
    const shift = `${((p2 - p1)*100).toFixed(1)}%`;
    const zStr = `${z.toFixed(2)} (${pVal.toFixed(3)})`;
    const avgScoreStr = oosLosses.avgScore.toFixed(3);
    const exclStr = `${isWins.excluded}/${oosLosses.excluded}`;
    
    let decayFlag = '';
    // Highlight significant decay: involvement shifted up in losses by >0, with p<0.05
    if (p2 > p1 && pVal < 0.05) decayFlag = ' ⚠️ DECAY';
    
    console.log(`| **${cat}** | ${isWinStr} | ${oosLossStr} | ${shift}${decayFlag} | ${zStr} | ${avgScoreStr} | ${exclStr} |`);
  }

  console.log('\n======================================================');
  console.log('   IDIOSYNCRATIC CLUSTER: (IS Wins vs OOS Wins)');
  console.log('======================================================\n');
  console.log(`Bucket Sizes -> IS Wins: ${buckets.IDIO_IS_WINS.length} trades | OOS Wins: ${buckets.IDIO_OOS_WINS.length} trades\n`);
  
  console.log('| Category | IS Win Involv. | OOS Win Involv. | Δ Shift | Z-Score (p-val) | Avg Score (OOS W) | Excl (IS/OOS) |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  
  for (const cat of CATEGORIES) {
    const isWins = calcCategoryStats(buckets.IDIO_IS_WINS, cat);
    const oosWins = calcCategoryStats(buckets.IDIO_OOS_WINS, cat);
    
    const p1 = isWins.involvementRate;
    const n1 = isWins.validTrades;
    const p2 = oosWins.involvementRate;
    const n2 = oosWins.validTrades;
    
    const { z, pVal } = calcZTest(p1, n1, p2, n2);
    
    const isWinStr = `${(p1*100).toFixed(1)}% (${isWins.agreed}/${n1})`;
    const oosWinStr = `${(p2*100).toFixed(1)}% (${oosWins.agreed}/${n2})`;
    const shift = `${((p2 - p1)*100).toFixed(1)}%`;
    const zStr = `${z.toFixed(2)} (${pVal.toFixed(3)})`;
    const avgScoreStr = oosWins.avgScore.toFixed(3);
    const exclStr = `${isWins.excluded}/${oosWins.excluded}`;
    
    console.log(`| **${cat}** | ${isWinStr} | ${oosWinStr} | ${shift} | ${zStr} | ${avgScoreStr} | ${exclStr} |`);
  }
}

runAnalysis().catch(console.error);
