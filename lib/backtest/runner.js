// ═══════════════════════════════════════════════════════
// Backtest Runner — Runs scoring engine against historical data
// ═══════════════════════════════════════════════════════
// Fetches 6 months of 15m klines from Binance for BTC/ETH/SOL,
// simulates the scoring engine at each candle close, and
// records signals + outcomes.

import { createDataPoint, indexBySymbolMetric } from '../ingestion/schema.js';
import { scoreSymbol } from '../scoring/engine.js';
import { evaluateSignal, clearAllCooldowns } from '../scoring/signal-generator.js';
import { computeATR } from '../scoring/levels.js';
import { computeMetrics } from './metrics.js';

const BINANCE_KLINE_URL = 'https://api.binance.com/api/v3/klines';
const MAX_PER_REQUEST = 1000;

/**
 * Fetch historical klines with pagination (Binance limits 1000 per request).
 * @param {string} symbol - e.g. 'BTC'
 * @param {string} interval - e.g. '15m'
 * @param {number} startTime - Unix ms
 * @param {number} endTime - Unix ms
 * @returns {Promise<Array>} Parsed candle objects
 */
async function fetchHistoricalKlines(symbol, interval, startTime, endTime) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const allCandles = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const url = `${BINANCE_KLINE_URL}?symbol=${pair}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=${MAX_PER_REQUEST}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status} for ${pair}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const k of raw) {
      allCandles.push({
        openTime: k[0],
        open:     parseFloat(k[1]),
        high:     parseFloat(k[2]),
        low:      parseFloat(k[3]),
        close:    parseFloat(k[4]),
        volume:   parseFloat(k[5]),
        closeTime: k[6],
      });
    }

    // Move cursor past the last candle
    cursor = raw[raw.length - 1][6] + 1;
    // Rate limit: Binance allows ~1200 requests/min
    await new Promise(r => setTimeout(r, 100));
  }

  return allCandles;
}

/**
 * Build synthetic DataPoints from historical klines at a given candle index.
 * Simulates what the ingestion layer would produce at that point in time.
 */
function buildSyntheticIndex(candles, endIdx, symbol) {
  const slice = candles.slice(Math.max(0, endIdx - 200), endIdx + 1);
  if (slice.length < 30) return null;

  const closes = slice.map(c => c.close);
  const price = slice[slice.length - 1].close;

  // Compute technicals inline (simplified for backtest — no external API calls)
  const points = [
    createDataPoint('backtest', symbol, 'price', price),
    createDataPoint('backtest', symbol, 'klines_15m', slice),
  ];

  // Simple EMA computation
  const ema = (data, period) => {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let e = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  };

  // Simple RSI computation
  const rsi = (data, period = 14) => {
    if (data.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = data[i] - data[i - 1];
      if (d >= 0) gains += d; else losses += Math.abs(d);
    }
    let ag = gains / period, al = losses / period;
    for (let i = period + 1; i < data.length; i++) {
      const d = data[i] - data[i - 1];
      ag = ((ag * (period - 1)) + (d > 0 ? d : 0)) / period;
      al = ((al * (period - 1)) + (d < 0 ? Math.abs(d) : 0)) / period;
    }
    if (al === 0) return 100;
    return 100 - (100 / (1 + ag / al));
  };

  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiVal = rsi(closes, 14);

  if (ema50 != null) points.push(createDataPoint('backtest', symbol, 'ema_50', ema50));
  if (ema200 != null) points.push(createDataPoint('backtest', symbol, 'ema_200', ema200));
  if (rsiVal != null) points.push(createDataPoint('backtest', symbol, 'rsi_14', rsiVal));

  // MACD (proper signal line via EMA-9 of MACD series)
  if (closes.length >= 35) {
    const ema12Series = emaSeries(closes, 12);
    const ema26Series = emaSeries(closes, 26);
    const macdSeries = ema12Series.map((v, i) => {
      const b = ema26Series[i];
      if (v == null || b == null) return null;
      return v - b;
    }).filter(v => v != null);
    const signalSeries = emaSeries(macdSeries, 9);
    if (macdSeries.length > 0 && signalSeries.length > 0) {
      const macdVal = macdSeries[macdSeries.length - 1];
      const sigVal = signalSeries[signalSeries.length - 1] ?? macdVal;
      points.push(createDataPoint('backtest', symbol, 'macd', {
        macd: macdVal,
        signal: sigVal,
        histogram: macdVal - sigVal,
      }));
    }
  }

  // Bollinger Bands (20-period SMA + 2 std dev)
  if (closes.length >= 20) {
    const period = 20;
    const window = closes.slice(-period);
    const sma = window.reduce((s, v) => s + v, 0) / period;
    const variance = window.reduce((s, v) => s + (v - sma) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    points.push(createDataPoint('backtest', symbol, 'bbands', {
      upper: sma + 2 * stdDev,
      middle: sma,
      lower: sma - 2 * stdDev,
    }));
  }

  // Stochastic %K/%D (14-period)
  if (slice.length >= 14) {
    const stochPeriod = 14;
    const stochWindow = slice.slice(-stochPeriod);
    const lowestLow = Math.min(...stochWindow.map(c => c.low));
    const highestHigh = Math.max(...stochWindow.map(c => c.high));
    const range = highestHigh - lowestLow;
    const k = range > 0 ? ((price - lowestLow) / range) * 100 : 50;
    // %D is 3-period SMA of %K — simplified to just use current K
    points.push(createDataPoint('backtest', symbol, 'stochastic', { k, d: k }));
  }

  return indexBySymbolMetric(points);
}

// Full EMA series for proper MACD computation
function emaSeries(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(data.length).fill(null);
  let e = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < data.length; i++) {
    e = data[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

// Backtest-specific config: only weight the categories we can compute from klines.
// Trend + Momentum + Volatility are kline-derived. The other 4 need live API data.
const BACKTEST_CONFIG = {
  weights: {
    trend:       0.40,
    momentum:    0.40,
    derivatives: 0.00,
    volatility:  0.20,
    sentiment:   0.00,
    onchain:     0.00,
    news:        0.00,
  },
  signal: {
    min_score: 0.35,
    min_agreeing_categories: 2,
    category_agreement_threshold: 0.3,
    cooldown_seconds: 3600, // 1 hour cooldown (in candle time, ~4 candles at step=4)
  },
  levels: {
    entry_spread_pct: 0.35,
    stop_atr_multiplier: 1.5,
    tp1_r: 1.0,
    tp2_r: 2.0,
    tp3_r: 3.0,
    tp4_r: 5.0,
    max_stop_pct: 3.0,
    min_rr_tp2: 1.5,
  },
};

/**
 * Run a backtest for one symbol.
 */
export async function backtestSymbol({ symbol, monthsBack = 6, cfg = {}, onProgress }) {
  const endTime = Date.now();
  const startTime = endTime - (monthsBack * 30 * 24 * 60 * 60 * 1000);

  console.log(`[backtest] Fetching ${monthsBack} months of 15m klines for ${symbol}...`);
  const candles = await fetchHistoricalKlines(symbol, '15m', startTime, endTime);
  console.log(`[backtest] Got ${candles.length} candles for ${symbol}`);

  if (candles.length < 200) {
    console.warn(`[backtest] Insufficient data for ${symbol}`);
    return { symbol, signals: [], metrics: null, candleCount: candles.length };
  }

  // Merge user config with backtest defaults (backtest weights take priority)
  const mergedCfg = { ...BACKTEST_CONFIG, ...cfg, weights: BACKTEST_CONFIG.weights };

  clearAllCooldowns();
  const signals = [];
  const step = 4;

  for (let i = 200; i < candles.length; i += step) {
    const index = buildSyntheticIndex(candles, i, symbol);
    if (!index) continue;

    const result = scoreSymbol(index, symbol, mergedCfg);

    // Pass the candle's close time so cooldown works in simulated time
    const candleTime = candles[i].closeTime || candles[i].openTime;
    const signal = evaluateSignal({
      symbol,
      scores: result.scores,
      confluenceScore: result.confluenceScore,
      index,
      cfg: { ...mergedCfg.signal, levels: mergedCfg.levels },
      now: candleTime,
    });


    if (signal) {
      // Simulate outcome by scanning forward
      const outcome = simulateOutcome(candles, i, signal);
      signals.push({ ...signal, outcome, candleIndex: i });
    }

    if (onProgress && i % 500 === 0) {
      onProgress({ symbol, progress: ((i - 200) / (candles.length - 200) * 100).toFixed(1) });
    }
  }

  const metrics = computeMetrics(signals);
  console.log(`[backtest] ${symbol}: ${signals.length} signals, win rate ${metrics.winRate}%`);

  return { symbol, signals, metrics, candleCount: candles.length };
}

/**
 * Simulate the outcome of a signal by scanning forward in candle data.
 */
function simulateOutcome(candles, entryIdx, signal) {
  const isLong = signal.direction === 'long';
  const avgEntry = signal.levels?.avgEntry || signal.levels?.entries?.[1];
  const sl = signal.levels?.stopLoss;
  const tps = signal.levels?.takeProfit || [];

  if (!avgEntry || !sl) return { result: 'no_levels', rMultiple: 0 };

  const risk = Math.abs(avgEntry - sl);
  const maxBars = 96; // 24 hours at 15m

  for (let i = entryIdx + 1; i < Math.min(entryIdx + maxBars, candles.length); i++) {
    const c = candles[i];

    // Check stop-loss
    if ((isLong && c.low <= sl) || (!isLong && c.high >= sl)) {
      return { result: 'stopped_out', rMultiple: -1, barsHeld: i - entryIdx };
    }

    // Check take-profits (highest first)
    for (let t = tps.length - 1; t >= 0; t--) {
      if ((isLong && c.high >= tps[t]) || (!isLong && c.low <= tps[t])) {
        const pnl = Math.abs(tps[t] - avgEntry);
        return { result: `tp${t + 1}_hit`, rMultiple: risk > 0 ? pnl / risk : 0, barsHeld: i - entryIdx, tpLevel: t + 1 };
      }
    }
  }

  // Expired (no TP or SL hit within maxBars)
  const exitPrice = candles[Math.min(entryIdx + maxBars, candles.length - 1)]?.close || avgEntry;
  const pnl = isLong ? exitPrice - avgEntry : avgEntry - exitPrice;
  return { result: 'expired', rMultiple: risk > 0 ? pnl / risk : 0, barsHeld: maxBars };
}
