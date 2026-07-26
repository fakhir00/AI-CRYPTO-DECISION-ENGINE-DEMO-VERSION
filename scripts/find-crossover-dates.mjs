#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// Find the first date each borderline asset crossed $50M
// trailing 30-day average daily volume on Binance.
// ═══════════════════════════════════════════════════════
// Strategy: fetch daily klines from listing date through today,
// compute 30-day rolling average of quoteVolume, find first
// date where that average ≥ $50M.

const BORDERLINE = ['DEXE', 'ZEC', 'VANA', 'WLD', 'KAITO', 'ACE', 'SUI', 'NEAR', 'AVAX', 'UNI'];
const THRESHOLD = 50_000_000; // $50M
const BACKTEST_START = new Date('2026-01-25T00:00:00Z').getTime();
const BACKTEST_IS_END = new Date('2026-04-30T23:59:59Z').getTime();
const BACKTEST_OOS_START = new Date('2026-05-01T00:00:00Z').getTime();
const BACKTEST_END = new Date('2026-07-26T00:00:00Z').getTime();
const MIN_SIGNALS_FLOOR = 15; // minimum signals per period to be useful

async function fetchDailyKlines(symbol, startTime, endTime) {
  const pair = `${symbol}USDT`;
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  API error ${res.status} for ${pair}`);
      return [];
    }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const k of raw) {
      all.push({
        openTime: k[0],
        closeTime: k[6],
        quoteVolume: parseFloat(k[7]),
        date: new Date(k[0]).toISOString().split('T')[0],
      });
    }
    cursor = raw[raw.length - 1][6] + 1;
    await new Promise(r => setTimeout(r, 200)); // rate limit
  }
  return all;
}

console.log('════════ POINT-IN-TIME CROSSOVER DATE ANALYSIS ════════\n');
console.log(`Threshold: $${(THRESHOLD / 1e6).toFixed(0)}M trailing 30-day avg daily volume`);
console.log(`Backtest window: Jan 25 – Jul 26, 2026`);
console.log(`IS period: Jan 25 – Apr 30  |  OOS period: May 1 – Jul 26`);
console.log(`Minimum signal floor: ${MIN_SIGNALS_FLOOR} per period\n`);

const results = [];

for (const sym of BORDERLINE) {
  console.log(`[${sym}] Fetching daily klines...`);
  // Fetch from 60 days before backtest start to have enough history for 30-day avg
  const fetchStart = BACKTEST_START - (60 * 24 * 60 * 60 * 1000);
  const klines = await fetchDailyKlines(sym, fetchStart, BACKTEST_END);
  
  if (klines.length === 0) {
    console.log(`  ❌ No data available\n`);
    results.push({ sym, crossoverDate: null, status: 'NO_DATA' });
    continue;
  }

  // Compute 30-day trailing average
  let crossoverDate = null;
  let crossoverIdx = -1;
  
  for (let i = 29; i < klines.length; i++) {
    const window = klines.slice(i - 29, i + 1);
    const avg = window.reduce((sum, k) => sum + k.quoteVolume, 0) / 30;
    
    if (avg >= THRESHOLD && klines[i].openTime >= BACKTEST_START) {
      crossoverDate = klines[i].date;
      crossoverIdx = i;
      break;
    }
  }

  // Also get Jan 25 specific volume
  const jan25 = klines.find(k => k.date === '2026-01-25');
  const jan25Vol = jan25 ? (jan25.quoteVolume / 1e6).toFixed(1) : 'N/A';
  
  // Get volume at crossover
  let crossoverVol = 'N/A';
  if (crossoverIdx >= 0) {
    const window = klines.slice(crossoverIdx - 29, crossoverIdx + 1);
    crossoverVol = (window.reduce((sum, k) => sum + k.quoteVolume, 0) / 30 / 1e6).toFixed(1);
  }

  // Determine IS/OOS signal eligibility
  let isEligibleDays = 0;
  let oosEligibleDays = 0;
  
  if (crossoverDate) {
    const crossTs = new Date(crossoverDate).getTime();
    if (crossTs <= BACKTEST_IS_END) {
      isEligibleDays = Math.floor((BACKTEST_IS_END - Math.max(crossTs, BACKTEST_START)) / (24*60*60*1000));
      oosEligibleDays = Math.floor((BACKTEST_END - BACKTEST_OOS_START) / (24*60*60*1000));
    } else if (crossTs <= BACKTEST_END) {
      isEligibleDays = 0;
      oosEligibleDays = Math.floor((BACKTEST_END - crossTs) / (24*60*60*1000));
    }
  }

  const crossTs = crossoverDate ? new Date(crossoverDate).getTime() : null;
  let status;
  if (!crossoverDate) {
    status = 'NEVER_CROSSED';
  } else if (crossTs <= BACKTEST_START) {
    status = 'ALREADY_QUALIFIED';
  } else if (crossTs <= BACKTEST_IS_END) {
    status = isEligibleDays >= 30 ? 'LATE_IS_ENTRY' : 'INSUFFICIENT_IS';
  } else {
    status = 'OOS_ONLY';
  }

  console.log(`  Jan 25 daily vol: $${jan25Vol}M`);
  console.log(`  30d avg crossover: ${crossoverDate || 'NEVER'} (avg at cross: $${crossoverVol}M)`);
  console.log(`  IS eligible days: ${isEligibleDays} | OOS eligible days: ${oosEligibleDays}`);
  console.log(`  Status: ${status}\n`);

  results.push({ sym, crossoverDate, crossoverVol, jan25Vol, isEligibleDays, oosEligibleDays, status });
}

// Summary table
console.log('\n════════ CROSSOVER SUMMARY TABLE ════════\n');
console.log('| Asset | Jan 25 Vol | Crossover Date | 30d Avg at Cross | IS Days | OOS Days | Status | Recommendation |');
console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

for (const r of results) {
  let rec;
  switch (r.status) {
    case 'ALREADY_QUALIFIED': rec = '✅ Include full window'; break;
    case 'LATE_IS_ENTRY': rec = `⚠️ Phase-in from ${r.crossoverDate}`; break;
    case 'INSUFFICIENT_IS': rec = '❌ Exclude (too few IS days)'; break;
    case 'OOS_ONLY': rec = '❌ Exclude (no IS period)'; break;
    case 'NEVER_CROSSED': rec = '❌ Exclude (never qualified)'; break;
    default: rec = '❌ Exclude (no data)';
  }
  console.log(`| **${r.sym}** | $${r.jan25Vol}M | ${r.crossoverDate || 'NEVER'} | $${r.crossoverVol}M | ${r.isEligibleDays} | ${r.oosEligibleDays} | ${r.status} | ${rec} |`);
}

// Final clean universe
console.log('\n════════ RECOMMENDED CLEAN UNIVERSE ════════\n');
const CORE = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'TRX'];
const fullWindow = results.filter(r => r.status === 'ALREADY_QUALIFIED').map(r => r.sym);
const phaseIn = results.filter(r => r.status === 'LATE_IS_ENTRY').map(r => ({ sym: r.sym, from: r.crossoverDate }));
const excluded = results.filter(r => !['ALREADY_QUALIFIED', 'LATE_IS_ENTRY'].includes(r.status)).map(r => r.sym);

console.log(`Core (full window): ${CORE.join(', ')}`);
console.log(`Borderline (full window): ${fullWindow.length > 0 ? fullWindow.join(', ') : 'NONE'}`);
console.log(`Phase-in: ${phaseIn.length > 0 ? phaseIn.map(p => `${p.sym} (from ${p.from})`).join(', ') : 'NONE'}`);
console.log(`Excluded: ${excluded.length > 0 ? excluded.join(', ') : 'NONE'}`);
console.log(`\nTotal clean universe: ${CORE.length + fullWindow.length + phaseIn.length} assets`);
