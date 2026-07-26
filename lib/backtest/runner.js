// ═══════════════════════════════════════════════════════
// Backtest Runner v2 — Production Config
// ═══════════════════════════════════════════════════════
// - All 7 scoring categories (5 real, 2 neutral — on-chain + news)
// - Fees & slippage on every entry/exit
// - Historical funding rates from Binance Futures
// - Historical Fear & Greed from Alternative.me
// - Out-of-sample split support

import { createDataPoint, indexBySymbolMetric } from '../ingestion/schema.js';
import { scoreSymbol } from '../scoring/engine.js';
import { evaluateSignal, clearAllCooldowns } from '../scoring/signal-generator.js';
import { computeMetrics } from './metrics.js';

const BINANCE_KLINE = 'https://api.binance.com/api/v3/klines';
const BINANCE_FUNDING = 'https://fapi.binance.com/fapi/v1/fundingRate';
const FNG_URL = 'https://api.alternative.me/fng';
const MAX_REQ = 1000;

// ─── Trading costs ───────────────────────────────────
export const TAKER_FEE   = 0.0004;  // 0.04%
export const SLIPPAGE    = 0.0005;  // 0.05%
export const COST_PER_SIDE = TAKER_FEE + SLIPPAGE; // 0.09%

// ─── Production config (mirrors scoring.yaml) ────────
export const PRODUCTION_CONFIG = {
  weights: {
    trend: 0.20, momentum: 0.20, derivatives: 0.15,
    volatility: 0.10, sentiment: 0.15, onchain: 0.10, news: 0.10,
  },
  category_types: {
    trend: 'gate', momentum: 'gate', sentiment: 'gate',
    derivatives: 'voter', volatility: 'voter', onchain: 'voter', news: 'voter'
  },
  signal: {
    min_score: 0.80,
    min_agreeing_categories: 1,
    category_agreement_threshold: 0.3,
    cooldown_seconds: 900,
  },
  exits: {
    scale_out_splits: [0.3, 0.3, 0.2, 0.2] // Configurable partial TPs
  },
  levels: {
    entry_spread_pct: 0.35,
    stop_atr_multiplier: 1.5,
    tp1_r: 1.0, tp2_r: 2.0, tp3_r: 3.0, tp4_r: 5.0,
    max_stop_pct: 3.0, min_rr_tp2: 1.5,
  },
};

// ═══════════════════════════════════════════════════════
// Data fetchers
// ═══════════════════════════════════════════════════════

async function fetchHistoricalKlines(symbol, interval, startTime, endTime) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const res = await fetch(`${BINANCE_KLINE}?symbol=${pair}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=${MAX_REQ}`);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status} for ${pair}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const k of raw) {
      all.push({ openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] });
    }
    cursor = raw[raw.length - 1][6] + 1;
    await sleep(80);
  }
  return all;
}

async function fetchHistoricalFunding(symbol, startTime, endTime) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    try {
      const res = await fetch(`${BINANCE_FUNDING}?symbol=${pair}&startTime=${cursor}&endTime=${endTime}&limit=${MAX_REQ}`);
      if (!res.ok) break;
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) break;
      for (const r of raw) all.push({ ts: r.fundingTime, rate: +r.fundingRate, mark: +r.markPrice });
      cursor = raw[raw.length - 1].fundingTime + 1;
      await sleep(80);
    } catch { break; }
  }
  all.sort((a, b) => a.ts - b.ts);
  console.log(`[backtest]   Funding rates: ${all.length} records`);
  return all;
}

async function fetchHistoricalFNG(days = 200) {
  try {
    const res = await fetch(`${FNG_URL}/?limit=${days}&format=json`);
    if (!res.ok) return [];
    const data = await res.json();
    const out = (data.data || []).map(d => ({ ts: parseInt(d.timestamp, 10) * 1000, value: +d.value, label: d.value_classification }));
    out.sort((a, b) => a.ts - b.ts); // oldest first
    console.log(`[backtest]   Fear & Greed: ${out.length} daily records`);
    return out;
  } catch { return []; }
}

/** Fetch all historical data needed for backtest. */
export async function fetchAllData(symbol, startTime, endTime) {
  console.log(`[backtest] Fetching data for ${symbol}...`);
  const [candles, funding] = await Promise.all([
    fetchHistoricalKlines(symbol, '15m', startTime, endTime),
    fetchHistoricalFunding(symbol, startTime, endTime),
  ]);
  console.log(`[backtest]   Klines: ${candles.length} candles`);
  return { candles, funding };
}

// ═══════════════════════════════════════════════════════
// Synthetic index builder
// ═══════════════════════════════════════════════════════

function buildSyntheticIndex(candles, endIdx, symbol, funding, fng) {
  const slice = candles.slice(Math.max(0, endIdx - 200), endIdx + 1);
  if (slice.length < 30) return null;

  const closes = slice.map(c => c.close);
  const price = slice[slice.length - 1].close;
  const candleTime = candles[endIdx].closeTime || candles[endIdx].openTime;

  const points = [
    createDataPoint('backtest', symbol, 'price', price),
    createDataPoint('backtest', symbol, 'klines_15m', slice),
  ];

  // ─── EMA 50/200 ───────────────────────────────────
  const ema = (data, period) => {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let e = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  };
  const e50 = ema(closes, 50), e200 = ema(closes, 200);
  if (e50 != null) points.push(createDataPoint('backtest', symbol, 'ema_50', e50));
  if (e200 != null) points.push(createDataPoint('backtest', symbol, 'ema_200', e200));

  // ─── RSI ──────────────────────────────────────────
  if (closes.length >= 15) {
    let gains = 0, losses = 0;
    for (let i = 1; i <= 14; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gains += d; else losses -= d;
    }
    let ag = gains / 14, al = losses / 14;
    for (let i = 15; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * 13 + (d > 0 ? d : 0)) / 14;
      al = (al * 13 + (d < 0 ? -d : 0)) / 14;
    }
    const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    points.push(createDataPoint('backtest', symbol, 'rsi_14', rsi));
  }

  // ─── MACD (12/26/9) ───────────────────────────────
  if (closes.length >= 35) {
    const es12 = emaSeries(closes, 12);
    const es26 = emaSeries(closes, 26);
    const macdLine = es12.map((v, i) => v != null && es26[i] != null ? v - es26[i] : null).filter(v => v != null);
    const sigLine = emaSeries(macdLine, 9);
    if (macdLine.length > 0 && sigLine.length > 0) {
      const m = macdLine[macdLine.length - 1];
      const s = sigLine[sigLine.length - 1] ?? m;
      points.push(createDataPoint('backtest', symbol, 'macd', { macd: m, signal: s, histogram: m - s }));
    }
  }

  // ─── Bollinger Bands (20, 2σ) ─────────────────────
  if (closes.length >= 20) {
    const w = closes.slice(-20);
    const sma = w.reduce((s, v) => s + v, 0) / 20;
    const sd = Math.sqrt(w.reduce((s, v) => s + (v - sma) ** 2, 0) / 20);
    points.push(createDataPoint('backtest', symbol, 'bbands', { upper: sma + 2 * sd, middle: sma, lower: sma - 2 * sd }));
  }

  // ─── Stochastic (14) ─────────────────────────────
  if (slice.length >= 14) {
    const sw = slice.slice(-14);
    const lo = Math.min(...sw.map(c => c.low));
    const hi = Math.max(...sw.map(c => c.high));
    const r = hi - lo;
    const k = r > 0 ? ((price - lo) / r) * 100 : 50;
    points.push(createDataPoint('backtest', symbol, 'stochastic', { k, d: k }));
  }

  // ─── Derivatives: historical funding rate ─────────
  if (funding.length > 0) {
    const fr = findNearest(funding, candleTime);
    if (fr) {
      points.push(createDataPoint('backtest', symbol, 'funding_rate', {
        rate: fr.rate, markPrice: fr.mark, indexPrice: price,
      }));
    }
  }

  // ─── Sentiment: historical Fear & Greed ───────────
  if (fng.length > 0) {
    const fg = findNearest(fng, candleTime);
    if (fg) {
      points.push(createDataPoint('backtest', '*', 'fear_greed', { value: fg.value, label: fg.label }));
    }
  }

  return indexBySymbolMetric(points);
}

function emaSeries(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(data.length).fill(null);
  let e = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < data.length; i++) { e = data[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

function findNearest(sorted, ts) {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid].ts <= ts) lo = mid; else hi = mid - 1;
  }
  return sorted[lo];
}

// ═══════════════════════════════════════════════════════
// Main backtest loop
// ═══════════════════════════════════════════════════════

export async function backtestSymbol({ symbol, candles, funding = [], fng = [], cfg = {}, onProgress }) {
  if (candles.length < 200) {
    console.warn(`[backtest] Insufficient candles for ${symbol}: ${candles.length}`);
    return { symbol, signals: [], metrics: null, candleCount: candles.length };
  }

  clearAllCooldowns();
  const signals = [];
  const step = 4;
  let maxConfluence = 0;

  for (let i = 200; i < candles.length; i += step) {
    const index = buildSyntheticIndex(candles, i, symbol, funding, fng);
    if (!index) continue;

    const result = scoreSymbol(index, symbol, cfg);
    const absScore = Math.abs(result.confluenceScore);
    if (absScore > maxConfluence) maxConfluence = absScore;

    const candleTime = candles[i].closeTime || candles[i].openTime;
    const signal = evaluateSignal({
      symbol,
      scores: result.scores,
      confluenceScore: result.confluenceScore,
      index,
      cfg: { ...cfg.signal, levels: cfg.levels, category_types: cfg.category_types },
      now: candleTime,
    });

    if (signal) {
      const outcome = simulateOutcome(candles, i, signal, cfg);
      signals.push({ ...signal, outcome, candleIndex: i, candleTime });
    }

    if (onProgress && i % 500 === 0) {
      onProgress({ symbol, progress: ((i - 200) / (candles.length - 200) * 100).toFixed(1) });
    }
  }

  const metrics = computeMetrics(signals);
  metrics.maxConfluenceScore = maxConfluence;
  return { symbol, signals, metrics, candleCount: candles.length };
}

// ═══════════════════════════════════════════════════════
// Outcome simulation WITH fees & partial scale-outs
// ═══════════════════════════════════════════════════════

function simulateOutcome(candles, entryIdx, signal, cfg = {}) {
  const isLong = signal.direction === 'long';
  const avgEntry = signal.levels?.avgEntry || signal.levels?.entries?.[1];
  let currentSl = signal.levels?.stopLoss;
  const tps = signal.levels?.takeProfit || [];

  if (!avgEntry || !currentSl || tps.length === 0) return { result: 'no_levels', rMultiple: 0 };

  const initialRisk = Math.abs(avgEntry - currentSl);
  const maxBars = 99999; // Removed 96-bar artificial timeout to match production parity

  // Effective entry after fees
  const effEntry = isLong ? avgEntry * (1 + COST_PER_SIDE) : avgEntry * (1 - COST_PER_SIDE);

  let remainingSize = 1.0;
  let realizedR = 0;
  let highestTpLevel = 0;
  
  // Use scale-out splits from config, default to [0.3, 0.3, 0.2, 0.2]
  const splitConfig = cfg.exits?.scale_out_splits || [0.3, 0.3, 0.2, 0.2];
  const tpFractions = [];
  let remainingAlloc = 1.0;
  
  for (let i = 0; i < tps.length; i++) {
    if (i === tps.length - 1) {
      tpFractions.push(remainingAlloc);
    } else {
      const alloc = splitConfig[i] ?? (remainingAlloc / (tps.length - i));
      tpFractions.push(alloc);
      remainingAlloc -= alloc;
    }
  }

  let finalResultStr = 'expired';
  let barsHeld = maxBars;

  for (let i = entryIdx + 1; i < Math.min(entryIdx + maxBars, candles.length); i++) {
    const c = candles[i];
    
    // Check Stop Loss
    if ((isLong && c.low <= currentSl) || (!isLong && c.high >= currentSl)) {
      const effExit = isLong ? currentSl * (1 - COST_PER_SIDE) : currentSl * (1 + COST_PER_SIDE);
      const pnl = isLong ? effExit - effEntry : effEntry - effExit;
      const r = initialRisk > 0 ? pnl / initialRisk : 0;
      realizedR += r * remainingSize;
      
      remainingSize = 0;
      finalResultStr = highestTpLevel > 0 ? `tp${highestTpLevel}_sl` : 'stopped_out';
      barsHeld = i - entryIdx;
      break;
    }

    // Check Take Profits (only levels we haven't hit yet)
    for (let t = highestTpLevel; t < tps.length; t++) {
      if ((isLong && c.high >= tps[t]) || (!isLong && c.low <= tps[t])) {
        // Secure profit for this fraction
        const effExit = isLong ? tps[t] * (1 - COST_PER_SIDE) : tps[t] * (1 + COST_PER_SIDE);
        const pnl = isLong ? effExit - effEntry : effEntry - effExit;
        const r = initialRisk > 0 ? pnl / initialRisk : 0;
        
        const sizeToClose = tpFractions[t];
        realizedR += r * sizeToClose;
        remainingSize -= sizeToClose;
        highestTpLevel = t + 1;
        
        // Move SL to breakeven after TP1 (effEntry ensures we truly break even after fees)
        if (highestTpLevel === 1) {
          currentSl = effEntry; 
        }
      } else {
        break; // TPs are ordered, if we didn't hit this one, we didn't hit higher ones
      }
    }
    
    if (remainingSize <= 0.001) {
      finalResultStr = `tp${tps.length}_hit`;
      barsHeld = i - entryIdx;
      break; // All closed
    }
  }

  // If expired with remaining size, close at market
  if (remainingSize > 0.001) {
    const exitPrice = candles[Math.min(entryIdx + maxBars, candles.length - 1)]?.close || avgEntry;
    const effExit = isLong ? exitPrice * (1 - COST_PER_SIDE) : exitPrice * (1 + COST_PER_SIDE);
    const pnl = isLong ? effExit - effEntry : effEntry - effExit;
    const r = initialRisk > 0 ? pnl / initialRisk : 0;
    realizedR += r * remainingSize;
    if (finalResultStr === 'expired' && highestTpLevel > 0) {
      finalResultStr = `tp${highestTpLevel}_expired`;
    }
  }

  return { 
    result: finalResultStr, 
    rMultiple: realizedR, 
    barsHeld, 
    tpLevel: highestTpLevel 
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
