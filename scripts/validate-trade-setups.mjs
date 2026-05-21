import {
  buildLocalStructureLevels,
  computeStructureAwareTradePlan,
  formatPlanNumber,
  validateTradePlanPriceOrder
} from '../lib/trade-plan.js';

const SYMBOLS = process.argv.slice(2).length ? process.argv.slice(2) : ['XTZ', 'BTC', 'ETH', 'SOL'];
const ENDPOINTS = [
  'https://api.binance.com/api/v3/klines',
  'https://api1.binance.com/api/v3/klines',
  'https://api2.binance.com/api/v3/klines',
  'https://api3.binance.com/api/v3/klines',
  'https://data-api.binance.vision/api/v3/klines'
];

function avg(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function ema(values = [], period = 9) {
  const arr = values.map(Number).filter(Number.isFinite);
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let current = avg(arr.slice(0, period));
  for (let i = period; i < arr.length; i++) {
    current = (arr[i] * k) + (current * (1 - k));
  }
  return current;
}

function rsi(values = [], period = 14) {
  const arr = values.map(Number).filter(Number.isFinite);
  if (arr.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = arr.length - period; i < arr.length; i++) {
    const change = arr[i] - arr[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function atrPct(candles = [], period = 14) {
  if (candles.length < period + 1) return 0;
  let trSum = 0;
  let count = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const hl = cur.high - cur.low;
    const hpc = Math.abs(cur.high - prev.close);
    const lpc = Math.abs(cur.low - prev.close);
    trSum += Math.max(hl, hpc, lpc);
    count += 1;
  }

  const atr = count ? trSum / count : 0;
  const lastClose = candles[candles.length - 1]?.close || 0;
  return lastClose > 0 ? (atr / lastClose) * 100 : 0;
}

function riskReward(entry, target, stop) {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return risk > 0 ? reward / risk : 0;
}

function chooseDirection(candles = []) {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const currentRsi = rsi(closes, 14);
  const momentum = price - closes[Math.max(0, closes.length - 7)];

  let buyScore = 0;
  let sellScore = 0;
  if (price > ema9) buyScore += 1;
  if (price < ema9) sellScore += 1;
  if (ema9 > ema21) buyScore += 1;
  if (ema9 < ema21) sellScore += 1;
  if (price > ema50) buyScore += 0.75;
  if (price < ema50) sellScore += 0.75;
  if (momentum > 0) buyScore += 0.75;
  if (momentum < 0) sellScore += 0.75;
  if (currentRsi >= 50 && currentRsi <= 72) buyScore += 0.75;
  if (currentRsi <= 50 && currentRsi >= 28) sellScore += 0.75;

  return {
    direction: buyScore >= sellScore ? 'BUY' : 'SELL',
    ema9,
    ema21,
    ema50,
    rsi: currentRsi,
    buyScore,
    sellScore
  };
}

async function fetchKlines(symbol, interval = '15m', limit = 120) {
  const clean = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const endpoint of ENDPOINTS) {
    const url = `${endpoint}?symbol=${encodeURIComponent(clean)}USDT&interval=${interval}&limit=${limit}`;
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) continue;
      const raw = await response.json();
      if (!Array.isArray(raw) || !raw.length) continue;
      return raw.map(k => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5])
      })).filter(c => [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite));
    } catch {
      // Try the next Binance mirror.
    }
  }
  throw new Error(`No Binance candles available for ${clean}/USDT`);
}

function printSetup(symbol, candles) {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const volatility = atrPct(candles, 14);
  const directionMeta = chooseDirection(candles);
  const structureLevels = buildLocalStructureLevels(candles, price, volatility);
  const plan = computeStructureAwareTradePlan(
    symbol,
    directionMeta.direction,
    price,
    volatility,
    { price, atrPct: volatility, structureLevels },
    { maxStopDistancePct: 1.85, minRrToTp2: 1.5, positionRiskPct: 0.5 }
  );

  const rrTp2 = riskReward(plan.avgEntry, plan.tp2, plan.sl);
  const priceOrderOk = validateTradePlanPriceOrder(directionMeta.direction, plan);
  const localSupport = plan.localSupport ? formatPlanNumber(plan.localSupport) : 'none nearby';
  const localResistance = plan.localResistance ? formatPlanNumber(plan.localResistance) : 'none nearby';
  const trend = [
    `EMA9 ${formatPlanNumber(directionMeta.ema9)}`,
    `EMA21 ${formatPlanNumber(directionMeta.ema21)}`,
    `RSI ${Number(directionMeta.rsi || 0).toFixed(1)}`
  ].join(' | ');

  console.log(`\n${symbol.toUpperCase()}/USDT ${directionMeta.direction} | price ${formatPlanNumber(price)} | ATR ${volatility.toFixed(2)}% | ${trend}`);
  console.log(`Entry: ${formatPlanNumber(plan.entry1)} - ${formatPlanNumber(plan.entry2)} - ${formatPlanNumber(plan.entry3)} | avg ${formatPlanNumber(plan.avgEntry)}`);
  console.log(`Targets: ${formatPlanNumber(plan.tp1)} / ${formatPlanNumber(plan.tp2)} / ${formatPlanNumber(plan.tp3)} / ${formatPlanNumber(plan.tp4)}`);
  console.log(`Stop: ${formatPlanNumber(plan.sl)} | risk ${plan.riskPct.toFixed(2)}% | TP2 R:R ${rrTp2.toFixed(2)} | lev ${plan.leverage}`);
  console.log(`Order: ${priceOrderOk ? 'valid' : 'invalid'} | ${plan.priceOrder}`);
  console.log(`Chart levels: support ${localSupport}, resistance ${localResistance} | stop ${plan.stopBasis} | targets ${plan.targetBasis.join(', ')}`);
}

console.log('Diagnostic trade setup validation from live Binance 15m candles. Not financial advice.');
for (const symbol of SYMBOLS) {
  try {
    const candles = await fetchKlines(symbol);
    printSetup(symbol, candles);
  } catch (error) {
    console.log(`\n${symbol.toUpperCase()}/USDT skipped: ${error.message}`);
  }
}
