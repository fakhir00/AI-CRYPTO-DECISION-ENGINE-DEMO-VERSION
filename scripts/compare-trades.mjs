import { fetchAllData, backtestSymbol, fetchAllFNG } from '../lib/backtest/runner.js';
import { SCORING_CONFIG as PRODUCTION_CONFIG } from '../lib/config.js';

const START = new Date('2026-01-25T00:00:00Z').getTime();
const END = new Date('2026-07-26T00:00:00Z').getTime(); // Pin END time to strictly freeze the baseline
const SPLIT = new Date('2026-05-01T00:00:00Z').getTime();
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ZEC', 'DOGE', 'TRX', 'SUI'];

async function run() {
  // Fetch global FNG
  const fngRes = await fetchAllFNG();

  const removedWinsIS = [];
  const removedLossesIS = [];
  const removedWinsOOS = [];
  const removedLossesOOS = [];

  for (const symbol of SYMBOLS) {
    const { candles, funding } = await fetchAllData(symbol, START, END);

    // Run Old Config (No category_types, min_agreeing = 3)
    const oldConfig = JSON.parse(JSON.stringify(PRODUCTION_CONFIG));
    oldConfig.signal.min_agreeing_categories = 3;
    oldConfig.category_types = { trend: 'voter', momentum: 'voter', sentiment: 'voter', derivatives: 'voter', volatility: 'voter', onchain: 'voter', news: 'voter' }; // Simulate old logic
    const oldRes = await backtestSymbol({ symbol, candles, funding, fng: fngRes, cfg: oldConfig });

    // Run New Config (Voter logic, min_agreeing = 1)
    const newConfig = JSON.parse(JSON.stringify(PRODUCTION_CONFIG));
    newConfig.signal.min_agreeing_categories = 1;
    newConfig.category_types = { trend: 'gate', momentum: 'gate', sentiment: 'gate', derivatives: 'voter', volatility: 'voter', onchain: 'voter', news: 'voter' };
    const newRes = await backtestSymbol({ symbol, candles, funding, fng: fngRes, cfg: newConfig });

    const getKeys = (signals) => signals.map(s => `${s.candleTime}-${s.direction}`);
    const newTrain = newRes.signals.filter(s => s.candleTime < SPLIT);
    const newTest = newRes.signals.filter(s => s.candleTime >= SPLIT);
    const newKeysIS = new Set(getKeys(newTrain));
    const newKeysOOS = new Set(getKeys(newTest));

    const oldTrain = oldRes.signals.filter(s => s.candleTime < SPLIT);
    for (const s of oldTrain) {
      if (!newKeysIS.has(`${s.candleTime}-${s.direction}`)) {
        if (s.outcome.rMultiple > 0.05) removedWinsIS.push(s.outcome.rMultiple);
        else removedLossesIS.push(s.outcome.rMultiple);
      }
    }
    const oldTest = oldRes.signals.filter(s => s.candleTime >= SPLIT);
    console.log(`[${symbol}] IS: old=${oldTrain.length}, new=${newTrain.length} | OOS: old=${oldTest.length}, new=${newTest.length}`);
    for (const s of oldTest) {
      if (!newKeysOOS.has(`${s.candleTime}-${s.direction}`)) {
        if (s.outcome.rMultiple > 0.05) removedWinsOOS.push(s.outcome.rMultiple);
        else removedLossesOOS.push(s.outcome.rMultiple);
      }
    }

    const { computeMetrics } = await import('../lib/backtest/metrics.js');
    const oldMetricsIS = computeMetrics(oldTrain);
    const newMetricsIS = computeMetrics(newTrain);
    const oldMetricsOOS = computeMetrics(oldTest);
    const newMetricsOOS = computeMetrics(newTest);
    
    console.log(`[${symbol}] SUMMARY METRICS (IS): Old Wins=${oldMetricsIS.wins}, Old Losses=${oldMetricsIS.losses} | New Wins=${newMetricsIS.wins}, New Losses=${newMetricsIS.losses}`);
    console.log(`[${symbol}] SUMMARY METRICS (OOS): Old Wins=${oldMetricsOOS.wins}, Old Losses=${oldMetricsOOS.losses} | New Wins=${newMetricsOOS.wins}, New Losses=${newMetricsOOS.losses}`);
    
    if (symbol === 'BTC') {
      const oldWinsList = oldTrain.filter(s => s.outcome.rMultiple > 0.05);
      const newWinsList = newTrain.filter(s => s.outcome.rMultiple > 0.05);
      const newWinsKeys = new Set(getKeys(newWinsList));
      console.log('--- BTC MISSING WINS ---');
      for (const s of oldWinsList) {
        if (!newWinsKeys.has(`${s.candleTime}-${s.direction}`)) {
          console.log(`Missing win in newTrain: ${s.candleTime} (${new Date(s.candleTime).toISOString()}) ${s.direction} R=${s.outcome.rMultiple}`);
          const inNewButNotWin = newTrain.find(n => n.candleTime === s.candleTime && n.direction === s.direction);
          if (inNewButNotWin) {
            console.log(`  -> IT IS IN NEW TRAIN BUT R=${inNewButNotWin.outcome.rMultiple}`);
          } else {
            console.log(`  -> COMPLETELY MISSING FROM NEW TRAIN`);
          }
        }
      }
    }
    
  }

  const avg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  const min = (arr) => arr.length ? Math.min(...arr) : 0;
  const max = (arr) => arr.length ? Math.max(...arr) : 0;
  
  console.log('--- IS REMOVED TRADES ---');
  console.log(`Wins removed:   ${removedWinsIS.length}, Avg R: ${avg(removedWinsIS).toFixed(3)} [Min: ${min(removedWinsIS).toFixed(3)}, Max: ${max(removedWinsIS).toFixed(3)}]`);
  console.log(`Losses removed: ${removedLossesIS.length}, Avg R: ${avg(removedLossesIS).toFixed(3)} [Min: ${min(removedLossesIS).toFixed(3)}, Max: ${max(removedLossesIS).toFixed(3)}]`);
  
  console.log('--- OOS REMOVED TRADES ---');
  console.log(`Wins removed:   ${removedWinsOOS.length}, Avg R: ${avg(removedWinsOOS).toFixed(3)} [Min: ${min(removedWinsOOS).toFixed(3)}, Max: ${max(removedWinsOOS).toFixed(3)}]`);
  console.log(`Losses removed: ${removedLossesOOS.length}, Avg R: ${avg(removedLossesOOS).toFixed(3)} [Min: ${min(removedLossesOOS).toFixed(3)}, Max: ${max(removedLossesOOS).toFixed(3)}]`);
}

run();
