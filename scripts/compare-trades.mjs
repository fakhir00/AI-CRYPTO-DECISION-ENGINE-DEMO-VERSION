import { fetchAllData, backtestSymbol, PRODUCTION_CONFIG } from '../lib/backtest/runner.js';

const START = new Date('2026-01-25T00:00:00Z').getTime();
const END = Date.now();
const SPLIT = new Date('2026-05-01T00:00:00Z').getTime();
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ZEC', 'DOGE', 'TRX', 'SUI'];

async function run() {
  // Fetch global FNG
  let fngRes = [];
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=200&format=json');
    const json = await res.json();
    fngRes = (json.data || []).map(d => ({ ts: parseInt(d.timestamp, 10) * 1000, value: +d.value, label: d.value_classification }));
    fngRes.sort((a, b) => a.ts - b.ts);
  } catch {}

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
        if (s.outcome.isWin) removedWinsIS.push(s.outcome.rMultiple);
        else removedLossesIS.push(s.outcome.rMultiple);
      }
    }
    const oldTest = oldRes.signals.filter(s => s.candleTime >= SPLIT);
    console.log(`[${symbol}] IS: old=${oldTrain.length}, new=${newTrain.length} | OOS: old=${oldTest.length}, new=${newTest.length}`);
    for (const s of oldTest) {
      if (!newKeysOOS.has(`${s.candleTime}-${s.direction}`)) {
        if (s.outcome.isWin) removedWinsOOS.push(s.outcome.rMultiple);
        else removedLossesOOS.push(s.outcome.rMultiple);
      }
    }
  }

  const avg = (arr) => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
  
  console.log('--- IS REMOVED TRADES ---');
  console.log(`Wins removed: ${removedWinsIS.length}, Avg R: ${avg(removedWinsIS).toFixed(3)}`);
  console.log(`Losses removed: ${removedLossesIS.length}, Avg R: ${avg(removedLossesIS).toFixed(3)}`);
  
  console.log('--- OOS REMOVED TRADES ---');
  console.log(`Wins removed: ${removedWinsOOS.length}, Avg R: ${avg(removedWinsOOS).toFixed(3)}`);
  console.log(`Losses removed: ${removedLossesOOS.length}, Avg R: ${avg(removedLossesOOS).toFixed(3)}`);
}

run();
