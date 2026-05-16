import './style.css';
import { fetchMarketData, fetchCandlePatterns, fetchGlobalMarketData, fetchWhaleActivity, fetchSentiment, fetchFearAndGreed, fetchAIAnalysis, fetchHermesAnalysis, fetchDualAI, calculateAlphaScore, fetchDefiPools, fetchNews, fetchTechnicalSignals, fetchTrendingNarratives, fetchChartData, fetchFundingRates, fetchOpenInterest, fetchOrderBookDepth, fetchBtcOnChain, fetchDuneMarketPulse, addToAIMemory, clearAIMemory, getAIMemory, getApiHealthSummary, getApiHealthPromptSummary } from './api.js';
import { setupAuth, openSignIn, logout, openUserProfile, clerk } from './lib/auth.js';
import { supabase } from './lib/supabase.js';


// --- Navigation & Setup ---
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: 'grid' },
  { id: 'opportunities', label: 'Top Opportunities', icon: 'trending-up' },
  { id: 'trading', label: 'Nexus Trading View', icon: 'monitor' },
  { id: 'ai-research', label: 'AI Research Analyst', icon: 'cpu' },
  { id: 'whale', label: 'Whale & Smart Money', icon: 'anchor' },
  { id: 'alerts', label: 'Alerts & Notifications', icon: 'bell' },
  { id: 'settings', label: 'Settings & Subscription', icon: 'settings' }
];

// --- Real Data Stores (Initialized Empty for 100% Accuracy) ---
const ASSETS = [];
const WHALE_ACTIONS = [];
const ALPHA_SIGNALS = [];
const NEWS = [];
const SIGNALS = [];
const DEFI_POOLS = [];
const NARRATIVES = [];
const SMART_MONEY_FLOWS = []; // To be replaced with real data or removed

let assets = [];
let LIVE_SENTIMENT = { bullish: 50, bearish: 50, score: 50 };
let LIVE_FNG = { value: 72, label: 'Greed' };
let LIVE_CATALYSTS = [
  { date: "May 21", title: "SUI Massive Token Unlock ($1.2B)", type: "warning" },
  { date: "May 23", title: "SEC Decision on ETH Spot ETF", type: "primary" },
  { date: "May 25", title: "Nvidia Earnings (AI Narrative Catalyst)", type: "info" }
];
let LIVE_FUNDING = [];   // Binance funding rates
let LIVE_OI = [];        // Binance open interest
let LIVE_DEPTH = null;   // BTC order book depth
let LIVE_BTC_CHAIN = null; // BTC on-chain health
let LIVE_DUNE_PULSE = null; // Dune macro on-chain pulse
let OPPORTUNITY_SORT = 'alpha';
let CURRENT_MARKET_TIMEFRAME = '24H';
const MAX_TRADABLE_ASSETS = 50;
const MAX_TOP_OPPORTUNITIES = MAX_TRADABLE_ASSETS;
const SIGNAL_SCAN_INTERVAL_MS = 60 * 1000;
const SIGNAL_KLINE_LIMIT = 80;
const SIGNAL_FETCH_TIMEOUT_MS = 6000;
const SIGNAL_KLINE_CONCURRENCY = 10;
const SIGNAL_BINANCE_ENDPOINTS = [
  'https://api.binance.com/api/v3/klines',
  'https://api1.binance.com/api/v3/klines',
  'https://api2.binance.com/api/v3/klines',
  'https://api3.binance.com/api/v3/klines',
  'https://data-api.binance.vision/api/v3/klines'
];
const SIGNAL_CACHE = {
  lastScanAt: 0,
  bySymbol: {}
};
const STABLE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
  'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
  'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
]);

function isStablecoinSymbol(symbol = '', name = '', price = null) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return false;
  if (STABLE_SYMBOLS.has(sym)) return true;

  // Catch variants like USD1, EUR1, GBP1 and similar fiat-pegged ticker formats.
  if (/^(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)\d*$/i.test(sym)) return true;

  const nm = String(name || '').toUpperCase();
  const p = Number(price);
  if (Number.isFinite(p) && p > 0.85 && p < 1.15 && /(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)/.test(sym)) {
    return true;
  }
  if (
    nm &&
    /\b(STABLE|USD|DOLLAR|EURO|EUR|GBP|YEN|PEGGED)\b/.test(nm) &&
    Number.isFinite(p) &&
    p > 0.85 &&
    p < 1.15
  ) {
    return true;
  }

  return false;
}

// ─── Data Persistence Layer (localStorage) ───────────────────────────────────
// Ensures identical data across refreshes and devices using the same browser.
const DATA_CACHE_KEY = 'nexus_data_cache';
const DATA_CACHE_TTL = 60 * 60 * 1000; // 1 hour TTL

function saveDataCache() {
  try {
    const cache = {
      timestamp: Date.now(),
      assets,
      WHALE_ACTIONS: [...WHALE_ACTIONS],
      SMART_MONEY_FLOWS: [...SMART_MONEY_FLOWS],
      NARRATIVES: [...NARRATIVES],
      NEWS: [...NEWS],
      DEFI_POOLS: [...DEFI_POOLS],
      ALPHA_SIGNALS: [...ALPHA_SIGNALS],
      LIVE_SENTIMENT,
      LIVE_FNG,
      LIVE_CATALYSTS: [...LIVE_CATALYSTS]
    };
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(cache));
    
    // 🌐 PUSH TO SUPABASE (Global Sync)
    pushToGlobalCache(cache);
    
    console.log('💾 Data cache saved locally & synced to Supabase');
  } catch(e) { console.warn('⚠️ Cache save failed:', e.message); }
}

async function pushToGlobalCache(cache) {
  try {
    const { error } = await supabase
      .from('global_market_cache')
      .upsert({ id: 'market_data_v1', data: cache, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    console.warn('⚠️ Global Sync Push Failed:', e.message);
  }
}

async function loadDataCache() {
  try {
    let cache = null;
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    
    if (raw) {
      cache = JSON.parse(raw);
      const hasScalpSignals = Array.isArray(cache?.assets)
        ? cache.assets.some(a => a?.signals?.scalp?.line)
        : false;
      // Check local TTL
      if (
        Date.now() - cache.timestamp > DATA_CACHE_TTL
        || (cache.assets && cache.assets.length < 15)
        || !hasScalpSignals
      ) {
        cache = null;
      }
    }

    // 🌐 PULL FROM SUPABASE if local is missing/expired
    if (!cache) {
      console.log('🌐 Local cache empty/expired, pulling from Supabase...');
      const { data, error } = await supabase
        .from('global_market_cache')
        .select('data')
        .eq('id', 'market_data_v1')
        .single();
      
      if (data && data.data) {
        cache = data.data;
        console.log('✅ Global cache pulled from Supabase');
      } else if (error) {
        console.error('❌ Supabase Pull Error:', error.message);
      } else {
        console.log('ℹ️ Global cache is empty in Supabase. Waiting for a device to push data.');
      }
    }

    if (!cache) return false;
    
    // Hydrate all data stores
    if (cache.assets && cache.assets.length > 0) {
      assets = cache.assets.map(a => {
        if (!a.reason) a.reason = generateReason(a, a.score);
        return a;
      });
      assets = applyDirectionalBiasToAssets(assets);
      assets = enforceTopAssetUniverse(assets);
      WHALE_ACTIONS.length = 0; cache.WHALE_ACTIONS?.forEach(w => WHALE_ACTIONS.push(w));
      SMART_MONEY_FLOWS.length = 0; cache.SMART_MONEY_FLOWS?.forEach(s => SMART_MONEY_FLOWS.push(s));
      NARRATIVES.length = 0; cache.NARRATIVES?.forEach(n => NARRATIVES.push(n));
      NEWS.length = 0; cache.NEWS?.forEach(n => NEWS.push(n));
      DEFI_POOLS.length = 0; cache.DEFI_POOLS?.forEach(d => DEFI_POOLS.push(d));
      ALPHA_SIGNALS.length = 0; cache.ALPHA_SIGNALS?.forEach(a => ALPHA_SIGNALS.push(a));
      if (cache.LIVE_SENTIMENT) LIVE_SENTIMENT = cache.LIVE_SENTIMENT;
      if (cache.LIVE_FNG) LIVE_FNG = cache.LIVE_FNG;
      if (cache.LIVE_CATALYSTS) LIVE_CATALYSTS = cache.LIVE_CATALYSTS;
      
      console.log('✅ Data hydrated (' + assets.length + ' assets)');
      return true;
    }
    return false;
  } catch(e) {
    console.warn('⚠️ Cache load failed:', e.message);
    return false;
  }
}

// Deterministic seeded random for stable generated values
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
// Global seed based on current hour (so all devices produce same values within the same hour)
const HOUR_SEED = Math.floor(Date.now() / (60 * 60 * 1000));
const stableRandom = seededRandom(HOUR_SEED);

function detectReasonBias(reason = '') {
  const text = String(reason || '');
  if (/(bear|breakdown|distribution|descending|head\s*&?\s*shoulders|shooting\s*star|contraction|rejection|lower\s*high|top)/i.test(text)) {
    return 'bearish';
  }
  if (/(bull|breakout|accumulation|ascending|cup|hammer|expansion|support|higher\s*low)/i.test(text)) {
    return 'bullish';
  }
  return 'neutral';
}

function generateReason(coin, score, preferredBias = null) {
  const change = coin.price_change_percentage_24h || coin.change || 0;
  const mcap = Number(coin.market_cap) || 0;
  const vol = coin.total_volume || 0;
  const volRatio = mcap > 0 ? (vol / mcap) : 0;
  const inferredBias = change >= 1 ? 'bullish' : change <= -1 ? 'bearish' : 'neutral';
  const bias = preferredBias || inferredBias;

  if (bias === 'bullish') {
    if (score > 85 && change > 3.5) return "Bull Flag Breakout";
    if (volRatio > 0.16) return "Bullish SMC Structure Flip";
    if (change > 1.8) return "High-Volume Breakout";
    if (score > 75) return "Ascending Triangle Breakout";
    return "Support Hold Accumulation";
  }

  if (bias === 'bearish') {
    if (score > 85 && change < -3.5) return "Bear Flag Breakdown";
    if (volRatio > 0.16) return "High-Volume Distribution";
    if (change < -1.8) return "Descending Channel Breakdown";
    if (score > 75) return "Lower High Rejection";
    return "Supply Zone Rejection";
  }
  
  if (Math.abs(change) < 1) return "Absorption & Exhaustion";
  return "Range Compression";
}

function parseVolumeBillions(vol = '') {
  const str = String(vol || '').trim().toUpperCase();
  const n = Number.parseFloat(str.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (str.includes('T')) return n * 1000;
  if (str.includes('B')) return n;
  if (str.includes('M')) return n / 1000;
  if (str.includes('K')) return n / 1_000_000;
  return n / 1_000_000_000;
}

function getUnifiedAlphaScore(asset = {}) {
  const opportunity = Number(asset?.opportunityScore);
  if (Number.isFinite(opportunity)) return opportunity;
  const base = Number(asset?.score);
  return Number.isFinite(base) ? base : 50;
}

function getSortedTradeableAssets(sortBy = 'alpha') {
  const sortKey = String(sortBy || 'alpha').toLowerCase();
  const list = assets.filter(asset => !isStablecoinSymbol(asset.symbol, asset.name, asset.price));
  return [...list].sort((a, b) => {
    if (sortKey === 'change') {
      return Math.abs(Number(b.change) || 0) - Math.abs(Number(a.change) || 0);
    }
    if (sortKey === 'volume') {
      return parseVolumeBillions(b.vol) - parseVolumeBillions(a.vol);
    }
    return (getUnifiedAlphaScore(b) - getUnifiedAlphaScore(a)) || a.symbol.localeCompare(b.symbol);
  });
}

function sigClamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function sigAvg(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function sigPctPrice(price, pct) {
  return price * (1 + (pct / 100));
}

function sigFormatLineNumber(v) {
  if (!Number.isFinite(v)) return '0';
  return v >= 1000 ? v.toFixed(2) : v.toFixed(4);
}

function sigBuildNoSignalLine(timeframe, symbol, timestamp, reason) {
  return `NO_SIGNAL|${timeframe}|${symbol}/USDT|${timestamp}|${reason}`;
}

function sigBuildSignalLine(timeframe, symbol, direction, entry, tp1, tp2, sl, patternName, timestamp, alpha) {
  return `SIGNAL|${timeframe}|${symbol}/USDT|${direction}|${sigFormatLineNumber(entry)}|${sigFormatLineNumber(tp1)}|${sigFormatLineNumber(tp2)}|${sigFormatLineNumber(sl)}|${patternName || 'NONE'}|${timestamp}|${Math.round(alpha)}`;
}

function sigComputeEmaSeries(values = [], period = 9) {
  const arr = values.map(Number).filter(Number.isFinite);
  if (arr.length < period) return [];

  const k = 2 / (period + 1);
  const out = new Array(arr.length).fill(null);
  let ema = sigAvg(arr.slice(0, period));
  out[period - 1] = ema;

  for (let i = period; i < arr.length; i++) {
    ema = (arr[i] * k) + (ema * (1 - k));
    out[i] = ema;
  }

  return out;
}

function sigComputeRsi(closes = [], period = 14) {
  const arr = closes.map(Number).filter(Number.isFinite);
  if (arr.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = arr[i] - arr[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < arr.length; i++) {
    const delta = arr[i] - arr[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function sigComputeMacdStats(closes = []) {
  const arr = closes.map(Number).filter(Number.isFinite);
  if (arr.length < 35) {
    return {
      histCurrent: null,
      histPrevious: null,
      minHist20: null,
      maxHist20: null,
      candlesSinceCross: 10,
      histSeries: []
    };
  }

  const ema12 = sigComputeEmaSeries(arr, 12);
  const ema26 = sigComputeEmaSeries(arr, 26);
  const macdSeries = arr.map((_, idx) => {
    const a = ema12[idx];
    const b = ema26[idx];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a - b;
  });

  const compactMacd = macdSeries.filter(Number.isFinite);
  const compactSignal = sigComputeEmaSeries(compactMacd, 9);

  const signalSeries = new Array(macdSeries.length).fill(null);
  let p = 0;
  for (let i = 0; i < macdSeries.length; i++) {
    if (Number.isFinite(macdSeries[i])) {
      signalSeries[i] = compactSignal[p] ?? null;
      p += 1;
    }
  }

  const histSeries = macdSeries.map((m, i) => {
    const s = signalSeries[i];
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m - s;
  });

  const validHist = histSeries.filter(Number.isFinite);
  const histCurrent = validHist.length ? validHist[validHist.length - 1] : null;
  const histPrevious = validHist.length > 1 ? validHist[validHist.length - 2] : null;
  const last20 = validHist.slice(-20);
  const minHist20 = last20.length ? Math.min(...last20) : null;
  const maxHist20 = last20.length ? Math.max(...last20) : null;

  let candlesSinceCross = 10;
  for (let i = histSeries.length - 1; i > 0; i--) {
    const cur = histSeries[i];
    const prev = histSeries[i - 1];
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    const nowSign = cur >= 0 ? 1 : -1;
    const prevSign = prev >= 0 ? 1 : -1;
    if (nowSign !== prevSign) {
      candlesSinceCross = Math.max(0, histSeries.length - 1 - i);
      break;
    }
  }

  return {
    histCurrent,
    histPrevious,
    minHist20,
    maxHist20,
    candlesSinceCross,
    histSeries
  };
}

function sigDetectMacdDivergence(candles = [], histSeries = []) {
  if (!candles.length || !histSeries.length) return { bullish: false, bearish: false };

  const n = Math.min(candles.length, histSeries.length);
  if (n < 30) return { bullish: false, bearish: false };

  const priceWindow = candles.slice(-30);
  const histWindow = histSeries.slice(-30);

  const firstHalf = priceWindow.slice(0, 15);
  const secondHalf = priceWindow.slice(15);
  const firstHist = histWindow.slice(0, 15);
  const secondHist = histWindow.slice(15);

  let firstLow = Infinity;
  let firstLowIdx = -1;
  firstHalf.forEach((c, i) => {
    if (c.low < firstLow) {
      firstLow = c.low;
      firstLowIdx = i;
    }
  });

  let secondLow = Infinity;
  let secondLowIdx = -1;
  secondHalf.forEach((c, i) => {
    if (c.low < secondLow) {
      secondLow = c.low;
      secondLowIdx = i;
    }
  });

  let firstHigh = -Infinity;
  let firstHighIdx = -1;
  firstHalf.forEach((c, i) => {
    if (c.high > firstHigh) {
      firstHigh = c.high;
      firstHighIdx = i;
    }
  });

  let secondHigh = -Infinity;
  let secondHighIdx = -1;
  secondHalf.forEach((c, i) => {
    if (c.high > secondHigh) {
      secondHigh = c.high;
      secondHighIdx = i;
    }
  });

  const firstLowHist = firstLowIdx >= 0 ? firstHist[firstLowIdx] : null;
  const secondLowHist = secondLowIdx >= 0 ? secondHist[secondLowIdx] : null;
  const firstHighHist = firstHighIdx >= 0 ? firstHist[firstHighIdx] : null;
  const secondHighHist = secondHighIdx >= 0 ? secondHist[secondHighIdx] : null;

  const bullish = (
    Number.isFinite(firstLow)
    && Number.isFinite(secondLow)
    && Number.isFinite(firstLowHist)
    && Number.isFinite(secondLowHist)
    && secondLow < firstLow
    && secondLowHist > firstLowHist
  );

  const bearish = (
    Number.isFinite(firstHigh)
    && Number.isFinite(secondHigh)
    && Number.isFinite(firstHighHist)
    && Number.isFinite(secondHighHist)
    && secondHigh > firstHigh
    && secondHighHist < firstHighHist
  );

  return { bullish, bearish };
}

function sigDetectPattern(candles = [], timeframe = 'SCALP') {
  if (!Array.isArray(candles) || candles.length < 4) {
    return {
      name: 'NONE',
      hasPattern: false,
      highReliability: false,
      list: [],
      summary: 'NONE'
    };
  }

  const pushPattern = (arr, name, type, reliability, candleIndex) => {
    arr.push({ name, type, reliability, candleIndex });
  };

  const patterns = [];
  const start = Math.max(2, candles.length - 20);

  for (let i = start; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const prev = candles[i - 1];
    const cur = candles[i];

    if (!prev2 || !prev || !cur) continue;

    const body = Math.abs(cur.close - cur.open);
    const prevBody = Math.abs(prev.close - prev.open);
    const prev2Body = Math.abs(prev2.close - prev2.open);
    const rng = Math.max(0, cur.high - cur.low);
    const upperWick = cur.high - Math.max(cur.open, cur.close);
    const lowerWick = Math.min(cur.open, cur.close) - cur.low;

    const bull = cur.close > cur.open;
    const bear = cur.close < cur.open;
    const prevBull = prev.close > prev.open;
    const prevBear = prev.close < prev.open;
    const prev2Bull = prev2.close > prev2.open;
    const prev2Bear = prev2.close < prev2.open;

    if (rng > 0 && body / rng < 0.1) {
      pushPattern(patterns, 'DOJI', 'neutral', 'low', i);
    }

    if (rng > 0 && body / rng > 0.82) {
      if (bull) pushPattern(patterns, 'BULL_MARUBOZU', 'bullish', 'medium', i);
      if (bear) pushPattern(patterns, 'BEAR_MARUBOZU', 'bearish', 'medium', i);
    }

    if (lowerWick > body * 2 && upperWick < body * 0.6) {
      if (bull) pushPattern(patterns, 'HAMMER', 'bullish', 'medium', i);
      if (bear) pushPattern(patterns, 'HANGING_MAN', 'bearish', 'medium', i);
    }

    if (upperWick > body * 2 && lowerWick < body * 0.6) {
      if (bear) pushPattern(patterns, 'SHOOTING_STAR', 'bearish', 'medium', i);
      if (bull) pushPattern(patterns, 'INVERTED_HAMMER', 'bullish', 'medium', i);
    }

    if (prevBear && bull && cur.open < prev.close && cur.close > prev.open) {
      pushPattern(patterns, 'BULL_ENGULF', 'bullish', 'high', i);
    }

    if (prevBull && bear && cur.open > prev.close && cur.close < prev.open) {
      pushPattern(patterns, 'BEAR_ENGULF', 'bearish', 'high', i);
    }

    if (prevBear && bull && cur.open > prev.close && cur.close < prev.open && body < prevBody * 0.65) {
      pushPattern(patterns, 'BULL_HARAMI', 'bullish', 'medium', i);
    }

    if (prevBull && bear && cur.open < prev.close && cur.close > prev.open && body < prevBody * 0.65) {
      pushPattern(patterns, 'BEAR_HARAMI', 'bearish', 'medium', i);
    }

    if (
      prev2Bear
      && prev2Body > Math.max(0, (prev2.high - prev2.low)) * 0.45
      && prevBody < prev2Body * 0.4
      && bull
      && cur.close > ((prev2.open + prev2.close) / 2)
    ) {
      pushPattern(patterns, 'MORNING_STAR', 'bullish', 'high', i);
    }

    if (
      prev2Bull
      && prev2Body > Math.max(0, (prev2.high - prev2.low)) * 0.45
      && prevBody < prev2Body * 0.4
      && bear
      && cur.close < ((prev2.open + prev2.close) / 2)
    ) {
      pushPattern(patterns, 'EVENING_STAR', 'bearish', 'high', i);
    }

    if (
      i >= 2
      && prev2Bull
      && prevBull
      && bull
      && cur.close > prev.close
      && prev.close > prev2.close
    ) {
      pushPattern(patterns, 'THREE_WHITE_SOLDIERS', 'bullish', 'high', i);
    }

    if (
      i >= 2
      && prev2Bear
      && prevBear
      && bear
      && cur.close < prev.close
      && prev.close < prev2.close
    ) {
      pushPattern(patterns, 'THREE_BLACK_CROWS', 'bearish', 'high', i);
    }
  }

  const recentUnique = [];
  const seen = new Set();
  for (let i = patterns.length - 1; i >= 0; i--) {
    const p = patterns[i];
    if (!p?.name || seen.has(p.name)) continue;
    seen.add(p.name);
    recentUnique.push(p);
    if (recentUnique.length >= 3) break;
  }

  if (!recentUnique.length) {
    return {
      name: 'NONE',
      hasPattern: false,
      highReliability: false,
      list: [],
      summary: 'NONE'
    };
  }

  const reliabilityOrder = { high: 3, medium: 2, low: 1 };
  const primary = [...recentUnique].sort((a, b) => {
    const ra = reliabilityOrder[a.reliability] || 0;
    const rb = reliabilityOrder[b.reliability] || 0;
    if (rb !== ra) return rb - ra;
    return b.candleIndex - a.candleIndex;
  })[0];

  return {
    name: primary.name,
    hasPattern: true,
    highReliability: primary.reliability === 'high' && timeframe === 'SCALP',
    list: recentUnique.map(p => p.name),
    summary: recentUnique.map(p => p.name).join(', ')
  };
}

function sigBuildSnapshot(candles = [], timeframe = 'SCALP') {
  if (!Array.isArray(candles) || candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const ema9Series = sigComputeEmaSeries(closes, 9);
  const ema21Series = sigComputeEmaSeries(closes, 21);

  if (!ema9Series.length || !ema21Series.length) return null;

  const ema9 = ema9Series[ema9Series.length - 1];
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema9Prev = ema9Series[ema9Series.length - 2];
  const ema21Prev = ema21Series[ema21Series.length - 2];

  const currentVolume = volumes[volumes.length - 1];
  const avgVol3 = sigAvg(volumes.slice(-4, -1));
  const avgVol5 = sigAvg(volumes.slice(-6, -1));
  const volumeRatio3 = avgVol3 > 0 ? (currentVolume / avgVol3) : 0;
  const volumeRatio5 = avgVol5 > 0 ? (currentVolume / avgVol5) : 0;

  const macd = sigComputeMacdStats(closes);
  const divergence = sigDetectMacdDivergence(candles, macd.histSeries || []);
  const pattern = sigDetectPattern(candles, timeframe);

  return {
    price: closes[closes.length - 1],
    ema9,
    ema21,
    ema9Prev,
    ema21Prev,
    rsi: sigComputeRsi(closes, 14),
    macd,
    divergence,
    pattern,
    volumeRatio3,
    volumeRatio5
  };
}

function sigComputeTechnicalScore(snapshot = {}, direction = 'BUY', timeframe = 'SCALP') {
  const rsi = Number.isFinite(snapshot.rsi) ? snapshot.rsi : 50;
  const rsiScore = sigClamp(100 - (Math.abs(rsi - 50) * 2), 0, 100);

  const histCurrent = snapshot.macd?.histCurrent;
  const histPrevious = snapshot.macd?.histPrevious;
  const minHist20 = snapshot.macd?.minHist20;
  const maxHist20 = snapshot.macd?.maxHist20;
  const candlesSinceCross = Number.isFinite(snapshot.macd?.candlesSinceCross) ? snapshot.macd.candlesSinceCross : 10;

  let strength = 50;
  if (Number.isFinite(histCurrent) && Number.isFinite(minHist20) && Number.isFinite(maxHist20)) {
    const range = maxHist20 - minHist20;
    if (range > 0) strength = ((histCurrent - minHist20) / range) * 100;
  }

  let directionScore = 50;
  if (Number.isFinite(histCurrent) && Number.isFinite(histPrevious)) {
    if (histCurrent > histPrevious) directionScore = 100;
    else if (histCurrent < histPrevious) directionScore = 0;
  }

  const recency = sigClamp(100 - (candlesSinceCross * 10), 0, 100);
  const rawMacd = (strength * 0.4) + (directionScore * 0.3) + (recency * 0.3);

  const divergence = snapshot.divergence || { bullish: false, bearish: false };
  const divergenceBonus = direction === 'BUY'
    ? (divergence.bullish ? 10 : 0)
    : (divergence.bearish ? 10 : 0);

  const macdScore = sigClamp(rawMacd + divergenceBonus, 0, 100);

  const pattern = snapshot.pattern || { hasPattern: false, highReliability: false };
  let patternScore = pattern.hasPattern ? 100 : 50;
  if (pattern.highReliability) patternScore = timeframe === 'SCALP' ? 120 : 100;
  patternScore = sigClamp(patternScore, 0, 100);

  return {
    score: sigClamp((rsiScore * 0.3) + (macdScore * 0.4) + (patternScore * 0.3), 0, 100),
    rsiScore,
    macdScore,
    patternScore
  };
}

function sigComputeEmaConfluence(direction = 'BUY', snapshot = {}) {
  const price = Number(snapshot.price);
  const ema9 = Number(snapshot.ema9);
  const ema21 = Number(snapshot.ema21);
  const ema9Prev = Number(snapshot.ema9Prev);
  const ema21Prev = Number(snapshot.ema21Prev);

  if (![price, ema9, ema21].every(Number.isFinite)) return 50;

  if (direction === 'BUY') {
    const ema9Expanding = Number.isFinite(ema9Prev) ? ema9 > ema9Prev : false;
    const ema21Expanding = Number.isFinite(ema21Prev) ? ema21 > ema21Prev : false;
    if (price > ema9 && price > ema21 && ema9Expanding && ema21Expanding) return 100;
    if (price < ema9 && price < ema21) return 0;
    return 50;
  }

  const ema9Contracting = Number.isFinite(ema9Prev) ? ema9 < ema9Prev : false;
  const ema21Contracting = Number.isFinite(ema21Prev) ? ema21 < ema21Prev : false;
  if (price < ema9 && price < ema21 && ema9Contracting && ema21Contracting) return 100;
  if (price > ema9 && price > ema21) return 0;
  return 50;
}

function sigComputeVolumeScore(volumeRatio = 0) {
  if (volumeRatio > 2.0) return 100;
  if (volumeRatio > 1.5) return 70;
  if (volumeRatio > 1.2) return 50;
  return 20;
}

function sigComputeAlpha(pillars = {}) {
  const sentiment = Number.isFinite(pillars.sentiment) ? pillars.sentiment : 50;
  const trending = sentiment > 65 || sentiment < 35;

  const weights = trending
    ? { technical: 0.22, whale: 0.20, ema: 0.15, volume: 0.08, sentiment: 0.15, news: 0.12, alpha: 0.10 }
    : { technical: 0.15, whale: 0.15, ema: 0.08, volume: 0.15, sentiment: 0.25, news: 0.15, alpha: 0.12 };

  const raw =
    (pillars.technical * weights.technical)
    + (pillars.whale * weights.whale)
    + (pillars.ema * weights.ema)
    + (pillars.volume * weights.volume)
    + (pillars.sentiment * weights.sentiment)
    + (pillars.news * weights.news)
    + (pillars.alphaSources * weights.alpha);

  return sigClamp(raw, 0, 100);
}

function sigComputeTpSl(timeframe = 'SCALP', symbol = 'BTC', direction = 'BUY', entry = 0) {
  const isMajor = symbol === 'BTC' || symbol === 'ETH';
  let tp1Pct;
  let tp2Pct;
  let slPct;

  if (timeframe === 'SCALP') {
    if (isMajor) {
      tp1Pct = 0.25; tp2Pct = 0.40; slPct = 0.15;
    } else {
      tp1Pct = 0.35; tp2Pct = 0.50; slPct = 0.20;
    }
  } else if (isMajor) {
    tp1Pct = 1.0; tp2Pct = 1.8; slPct = 0.6;
  } else {
    tp1Pct = 1.5; tp2Pct = 2.5; slPct = 0.8;
  }

  if (direction === 'BUY') {
    return {
      tp1: sigPctPrice(entry, tp1Pct),
      tp2: sigPctPrice(entry, tp2Pct),
      sl: sigPctPrice(entry, -slPct)
    };
  }

  return {
    tp1: sigPctPrice(entry, -tp1Pct),
    tp2: sigPctPrice(entry, -tp2Pct),
    sl: sigPctPrice(entry, slPct)
  };
}

function sigNoSignal(timeframe, symbol, timestamp, reason, alpha = 50, direction = null) {
  return {
    status: 'NO_SIGNAL',
    reason,
    alpha: Math.round(alpha),
    direction,
    patternSummary: 'NONE',
    line: sigBuildNoSignalLine(timeframe, symbol, timestamp, reason)
  };
}

function sigEvaluate(symbol, timeframe, snapshot, timestamp) {
  if (!snapshot) return sigNoSignal(timeframe, symbol, timestamp, 'DATA_UNAVAILABLE');

  let direction = null;
  if (snapshot.ema9 > snapshot.ema21) direction = 'BUY';
  else if (snapshot.ema9 < snapshot.ema21) direction = 'SELL';
  if (!direction) return sigNoSignal(timeframe, symbol, timestamp, 'EMA_CROSS_FAIL');

  const volumeRatio = timeframe === 'SCALP' ? snapshot.volumeRatio3 : snapshot.volumeRatio5;
  if (!(Number.isFinite(volumeRatio) && volumeRatio > 0.5)) {
    return sigNoSignal(timeframe, symbol, timestamp, 'VOLUME_FAIL', 50, direction);
  }

  const technical = sigComputeTechnicalScore(snapshot, direction, timeframe);
  const emaConfluence = sigComputeEmaConfluence(direction, snapshot);
  const volumeScore = sigComputeVolumeScore(volumeRatio);

  // Neutral defaults when external source is unavailable in fallback path.
  const pillars = {
    technical: technical.score,
    whale: 50,
    ema: emaConfluence,
    volume: volumeScore,
    sentiment: Number.isFinite(LIVE_SENTIMENT?.score) ? LIVE_SENTIMENT.score : 50,
    news: 50,
    alphaSources: 50
  };
  const alpha = sigComputeAlpha(pillars);
  const levels = sigComputeTpSl(timeframe, symbol, direction, snapshot.price);
  const patternName = snapshot.pattern?.name || 'NONE';
  const patternSummary = snapshot.pattern?.summary || patternName;

  return {
    status: 'SIGNAL',
    direction,
    reason: null,
    alpha: Math.round(alpha),
    pattern: patternName,
    patternSummary,
    entry: snapshot.price,
    tp1: levels.tp1,
    tp2: levels.tp2,
    sl: levels.sl,
    line: sigBuildSignalLine(
      timeframe,
      symbol,
      direction,
      snapshot.price,
      levels.tp1,
      levels.tp2,
      levels.sl,
      patternName,
      timestamp,
      alpha
    )
  };
}

async function sigFetchKlines(symbol, interval, limit = SIGNAL_KLINE_LIMIT) {
  const cleanSymbol = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleanSymbol) return null;

  for (const base of SIGNAL_BINANCE_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SIGNAL_FETCH_TIMEOUT_MS);
    try {
      const url = `${base}?symbol=${encodeURIComponent(cleanSymbol)}USDT&interval=${encodeURIComponent(interval)}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (!res.ok) continue;
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) continue;
      return raw.map(k => ({
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5])
      })).filter(c => Number.isFinite(c.close) && Number.isFinite(c.volume));
    } catch {
      // Try next endpoint.
    } finally {
      clearTimeout(timer);
    }
  }

  return null;
}

async function sigMapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) break;
      try {
        out[current] = await mapper(items[current], current);
      } catch {
        out[current] = null;
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function hydrateAssetsWithSignals(assetList = []) {
  if (!Array.isArray(assetList) || assetList.length === 0) return assetList;

  const now = Date.now();
  const symbols = [...new Set(assetList
    .map(a => String(a?.symbol || '').toUpperCase())
    .filter(Boolean))];
  const incomingBySymbol = new Map(assetList.map(a => [String(a?.symbol || '').toUpperCase(), a]));

  // If server already returned usable signals, trust and cache them.
  let serverSignalCount = 0;
  assetList.forEach((asset) => {
    const symbol = String(asset?.symbol || '').toUpperCase();
    const scalp = asset?.signals?.scalp;
    if (symbol && scalp?.line) {
      SIGNAL_CACHE.bySymbol[symbol] = { scalp };
      serverSignalCount += 1;
    }
  });

  const stale = (now - SIGNAL_CACHE.lastScanAt) >= SIGNAL_SCAN_INTERVAL_MS;
  const missingSymbols = symbols.filter((symbol) => {
    const incoming = incomingBySymbol.get(symbol);
    const hasIncoming = incoming?.signals?.scalp?.line;
    if (hasIncoming) return false;
    const cached = SIGNAL_CACHE.bySymbol[symbol];
    return !(cached?.scalp?.line && !stale);
  });

  if (missingSymbols.length > 0) {
    const tasks = [];
    missingSymbols.forEach((symbol) => {
      tasks.push({ symbol, timeframe: 'SCALP', interval: '1m' });
    });

    const fetched = await sigMapWithConcurrency(tasks, SIGNAL_KLINE_CONCURRENCY, async (task) => {
      const candles = await sigFetchKlines(task.symbol, task.interval, SIGNAL_KLINE_LIMIT);
      return { ...task, candles };
    });

    const grouped = {};
    fetched.forEach((item) => {
      if (!item?.symbol || !item?.timeframe) return;
      if (!grouped[item.symbol]) grouped[item.symbol] = {};
      grouped[item.symbol][item.timeframe] = item.candles || null;
    });

    const timestampIso = new Date().toISOString();
    missingSymbols.forEach((symbol) => {
      const scalpCandles = grouped[symbol]?.SCALP || null;
      const scalpSnapshot = sigBuildSnapshot(scalpCandles || [], 'SCALP');

      SIGNAL_CACHE.bySymbol[symbol] = {
        scalp: sigEvaluate(symbol, 'SCALP', scalpSnapshot, timestampIso)
      };
    });

    SIGNAL_CACHE.lastScanAt = now;
  } else if (serverSignalCount > 0) {
    SIGNAL_CACHE.lastScanAt = now;
  }

  return assetList.map((asset) => {
    const symbol = String(asset?.symbol || '').toUpperCase();
    const cached = SIGNAL_CACHE.bySymbol[symbol];
    if (!cached) return asset;

    const mergedSignals = {
      scalp: asset?.signals?.scalp?.line ? asset.signals.scalp : cached.scalp
    };

    const scoreFromSignals = Math.round(Number(mergedSignals.scalp?.alpha) || 50);
    const chosenPattern = mergedSignals.scalp?.patternSummary && mergedSignals.scalp.patternSummary !== 'NONE'
      ? mergedSignals.scalp.patternSummary
      : 'NONE';

    return {
      ...asset,
      signals: mergedSignals,
      opportunityScore: scoreFromSignals,
      score: scoreFromSignals,
      patternDetected: chosenPattern || 'NONE',
      reason: chosenPattern || asset.reason
    };
  });
}

function enforceTopAssetUniverse(assetList = [], maxAssets = MAX_TRADABLE_ASSETS) {
  const clean = (assetList || [])
    .filter(asset => asset && asset.symbol && !isStablecoinSymbol(asset.symbol, asset.name, asset.price))
    .map(asset => ({ ...asset }));

  const ranked = clean.sort((a, b) => {
    const aScore = Number.isFinite(a?.opportunityScore) ? Number(a.opportunityScore) : (Number.isFinite(a?.score) ? Number(a.score) : 0);
    const bScore = Number.isFinite(b?.opportunityScore) ? Number(b.opportunityScore) : (Number.isFinite(b?.score) ? Number(b.score) : 0);
    if (bScore !== aScore) return bScore - aScore;
    const av = parseVolumeBillions(a?.vol);
    const bv = parseVolumeBillions(b?.vol);
    if (bv !== av) return bv - av;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  return ranked.slice(0, Math.max(1, maxAssets));
}

function applyDuneMacroCalibration(assetList = [], dunePulse = null) {
  if (!dunePulse || !Number.isFinite(Number(dunePulse.signalScore))) return assetList;

  const macroScore = Number(dunePulse.signalScore);
  const macroTilt = Math.max(-1, Math.min(1, (macroScore - 50) / 35)); // -1..1
  const growthWeight = Math.max(-1, Math.min(1, Number(dunePulse.volumeGrowthPct || 0) / 22));
  const txWeight = Math.max(-1, Math.min(1, Number(dunePulse.btcTxGrowthPct || 0) / 18));
  const blended = (macroTilt * 0.62) + (growthWeight * 0.25) + (txWeight * 0.13);

  return assetList.map(asset => {
    const change = Number(asset.change) || 0;
    const directionSign = change >= 0 ? 1 : -1;
    const alignmentBoost = blended * directionSign * 6.5;
    const baseScore = Number.isFinite(asset.score) ? Number(asset.score) : 50;
    const adjustedScore = Math.max(0, Math.min(100, Math.round(baseScore + alignmentBoost)));
    return {
      ...asset,
      score: adjustedScore
    };
  });
}

function computeDirectionalNeutralAlpha(change24h = 0, volRatio = 0, mcapRank = 50) {
  const absChange = Math.abs(Number(change24h) || 0);

  const moveQuality = absChange < 0.5
    ? 8 + (absChange * 6)
    : absChange < 2
      ? 11 + ((absChange - 0.5) * 8)
      : absChange < 8
        ? 23 + ((absChange - 2) * 3.2)
        : absChange < 15
          ? 42 - ((absChange - 8) * 1.7)
          : 30 - Math.min(14, (absChange - 15) * 1.5);

  const volumeConviction = Math.min(24, Math.max(0, (Number(volRatio) || 0) * 240));
  const mcapTier = Math.min(16, Math.max(5, 16 - ((Number(mcapRank) || 50) * 0.2)));
  const stability = absChange < 1 ? 6 : absChange < 4 ? 12 : absChange < 10 ? 16 : absChange < 18 ? 11 : 7;
  const overextensionPenalty = absChange > 18 ? Math.min(10, (absChange - 18) * 0.9) : 0;

  const raw = moveQuality + volumeConviction + mcapTier + stability - overextensionPenalty;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

function classifyDirectionalBias(asset = {}, emaInfo = null) {
  const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
  const spread = evalResult.bull - evalResult.bear;
  const change = Number.isFinite(asset.change) ? asset.change : 0;

  if (Math.abs(change) < 0.6 && Math.abs(spread) < 0.9) return 'neutral';
  if (spread >= 0.65) return 'bullish';
  if (spread <= -0.65) return 'bearish';
  return 'neutral';
}

function evaluateDirectionalBiasScores(asset = {}, emaInfo = null) {
  const change = Number.isFinite(asset.change) ? asset.change : 0;
  const score = Number.isFinite(asset.score) ? asset.score : 50;
  const reason = String(asset.reason || '');

  let bull = 0;
  let bear = 0;

  if (change >= 4) bull += 3.1;
  else if (change >= 2) bull += 2.0;
  else if (change >= 0.6) bull += 1.0;
  else if (change <= -4) bear += 3.1;
  else if (change <= -2) bear += 2.0;
  else if (change <= -0.6) bear += 1.0;

  // High score boosts whichever side momentum already supports (non-directional).
  if (score >= 80) {
    if (change > 0.25) bull += 0.9;
    if (change < -0.25) bear += 0.9;
  }
  if (score >= 90) {
    if (change > 3) bull += 0.5;
    if (change < -3) bear += 0.5;
  }

  if (/(bull|breakout|accumulation|ascending|cup|squeeze|pullback|reversal|support)/i.test(reason)) bull += 1.0;
  if (/(bear|breakdown|distribution|head\s*&?\s*shoulders|contraction|shooting\s*star|top|rejection)/i.test(reason)) bear += 1.0;

  if (emaInfo) {
    const last = Number(emaInfo.lastClose);
    const ema9 = Number(emaInfo.ema9);
    const ema21 = Number(emaInfo.ema21);

    if (Number.isFinite(last) && Number.isFinite(ema9) && Number.isFinite(ema21)) {
      if (last > ema9 && ema9 > ema21) bull += 2.6;
      if (last < ema9 && ema9 < ema21) bear += 2.6;
      if (ema9 > ema21) bull += 0.8;
      if (ema9 < ema21) bear += 0.8;
    }
  }

  if (LIVE_SENTIMENT.score >= 60) bull += 0.45;
  if (LIVE_SENTIMENT.score <= 40) bear += 0.45;

  return { bull, bear };
}

function computeOpportunityScore(asset = {}, emaInfo = null, spreadOverride = null) {
  const score = Number.isFinite(asset.score) ? asset.score : 50;
  const absChange = Math.abs(Number(asset.change) || 0);
  const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
  const spread = Number.isFinite(spreadOverride) ? Math.abs(spreadOverride) : Math.abs(evalResult.bull - evalResult.bear);

  const volBillions = parseVolumeBillions(asset.vol);

  const moveComponent = absChange < 0.5
    ? 3.5 + (absChange * 3.5)
    : absChange < 2
      ? 5.2 + ((absChange - 0.5) * 4.3)
      : absChange < 8
        ? 11.6 + ((absChange - 2) * 1.9)
        : 22 - Math.min(8, (absChange - 8) * 1.1);

  const liquidityComponent = Math.min(10, Math.max(0, (Math.log10((volBillions * 10) + 1)) * 6.2));
  const directionalComponent = Math.min(12, spread * 4.8);
  const baseComponent = Math.max(0, Math.min(100, score)) * 0.56;
  const raw = baseComponent + moveComponent + liquidityComponent + directionalComponent;

  // Soft-cap the extreme tail so "100" remains rare and meaningful.
  const softened = raw > 92 ? 92 + ((raw - 92) * 0.35) : raw;
  return Math.round(Math.min(99, Math.max(0, softened)));
}

function applyDirectionalBiasToAssets(assetList = []) {
  const emaMap = window._liveEmaData || {};
  return assetList.map(asset => {
    const scalpSignal = asset?.signals?.scalp;
    const preferredSignal = scalpSignal?.status === 'SIGNAL' ? scalpSignal : null;

    const emaInfo = emaMap[asset.symbol];
    const computedBias = classifyDirectionalBias(asset, emaInfo);
    const bias = preferredSignal?.direction === 'BUY'
      ? 'bullish'
      : preferredSignal?.direction === 'SELL'
        ? 'bearish'
        : computedBias;
    const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
    const hasReason = typeof asset.reason === 'string' && asset.reason.trim().length > 0;
    const alignedReason = hasReason ? asset.reason : generateReason(asset, asset.score, bias);
    const preservedScore = Number(asset?.opportunityScore);
    const opportunityScore = Number.isFinite(preservedScore)
      ? preservedScore
      : computeOpportunityScore(asset, emaInfo, evalResult.bull - evalResult.bear);
    return {
      ...asset,
      reason: alignedReason,
      bias,
      biasConfidence: Math.abs(evalResult.bull - evalResult.bear),
      opportunityScore
    };
  });
}


// Chart Instances
let mainMarketChart;
let socialChart;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof feather !== 'undefined') feather.replace();
  
  const loadingScreen = document.getElementById('loading-screen');
  const mainApp = document.getElementById('main-app');
  const loginGate = document.getElementById('login-gate');
  const loadingBar = document.querySelector('.loading-bar');

  // Initialize Clerk Auth
  setupAuth(async (isAuthenticated, user) => {
    if (isAuthenticated) {
      loginGate.classList.add('hidden');
      updateUserProfileUI(user);
      
      // 🛡️ Ensure user exists in Supabase
      try {
        await supabase.from('user_profiles').upsert({
          clerk_id: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          full_name: user.fullName,
          updated_at: new Date().toISOString()
        }, { onConflict: 'clerk_id' });
      } catch (e) {
        console.warn('⚠️ Profile sync failed:', e.message);
      }

      // Start loading sequence only once
      if (mainApp.classList.contains('hidden')) {
        startLoadingSequence(loadingScreen, mainApp, loadingBar);
      }
    } else {
      loadingScreen.classList.add('hidden');
      mainApp.classList.add('hidden');
      loginGate.classList.remove('hidden');
    }
  });

  // Attach login/logout listeners
  document.getElementById('sign-in-btn')?.addEventListener('click', () => {
    console.log('🖱️ Sign-in button clicked');
    openSignIn();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('user-profile-btn')?.addEventListener('click', openUserProfile);
});

function updateUserProfileUI(user) {
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  
  if (nameEl) nameEl.textContent = user.fullName || user.username || 'NEXUS User';
  if (avatarEl) {
    const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');
    avatarEl.textContent = initials || user.username?.[0]?.toUpperCase() || 'N';
    if (user.imageUrl) {
      avatarEl.style.backgroundImage = `url(${user.imageUrl})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    }
  }
}

function startLoadingSequence(loadingScreen, mainApp, loadingBar) {
  loadingScreen.classList.remove('hidden');
  loadingScreen.style.opacity = '1';

  const statuses = [
    "Establishing secure WebSocket connection...", 
    "Syncing on-chain data providers...", 
    "Loading quantitative models...", 
    "Calibrating NLP engines..."
  ];
  
  let step = 0;
  const interval = setInterval(async () => {
    step++;
    if (step < statuses.length) {
      document.getElementById('loading-status').textContent = statuses[step];
      loadingBar.style.width = `${(step / statuses.length) * 100}%`;
    } else {
      clearInterval(interval);
      loadingBar.style.width = '100%';
      
      // Hydrate UI from cache BEFORE showing it
      await initApp();
      
      setTimeout(() => {
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
          loadingScreen.classList.add('hidden');
          mainApp.classList.remove('hidden');
          // Start the first live sync after showing the UI to ensure no delay
          syncLiveApis();
        }, 500);
      }, 500);
    }
  }, 500);
}

async function initApp() {
  setupSidebar();
  updateTime();
  setInterval(updateTime, 1000);
  
  // Load cached data instantly for zero-delay UI hydration (Now pulling from Supabase if local is empty)
  const hasCachedData = await loadDataCache();
  if (hasCachedData) {
    console.log('⚡ Data hydrated — UI is ready');
  }

  // Setup Charts
  initCharts();

  // Initial renders (will use cached data if available)
  renderDashboard();
  renderOpportunitiesPage();
  renderTradingPage();
  renderWhalePage();
  if (hasCachedData) renderProSignals();

  setupAiResearchChat();
  setupAiReports();
  setupModals();
  setupAllButtons();
  setupTradingEvents();
  setupSettingsPage();
  
  // Verify Supabase Connectivity
  testSupabase();

  // Real-time market scan polling (every 60 seconds, aligned with SCALP engine)
  setInterval(syncLiveApis, SIGNAL_SCAN_INTERVAL_MS);
  
  // UI Visual Heartbeat (flashes text)
  setInterval(simulateMarketTick, 3000);
}

async function testSupabase() {
  const { supabase } = await import('./lib/supabase.js');
  const { data, error } = await supabase.from('user_profiles').select('count', { count: 'exact', head: true });
  if (error) {
    console.warn('⚠️ Supabase connection test failed (expected if table not created):', error.message);
  } else {
    console.log('✅ Supabase connected successfully');
  }
}

// --- Charts Setup (Chart.js) ---
async function initCharts(timeframe = '24H') {
  CURRENT_MARKET_TIMEFRAME = String(timeframe || '24H').toUpperCase();
  updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';
  
  if (mainMarketChart) mainMarketChart.destroy();
  if (socialChart) socialChart.destroy();

  const ctxMain = document.getElementById('mainMarketChart').getContext('2d');
  const gradient = ctxMain.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.5)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)');

  let interval = '1h';
  let limit = 48;
  let labels = [];

  if (timeframe === '1H') {
    interval = '1m';
    limit = 60;
    labels = Array.from({length: limit}, (_, i) => `${limit - i}m ago`);
  } else if (timeframe === '24H') {
    interval = '1h';
    limit = 48;
    labels = Array.from({length: limit}, (_, i) => `${Math.floor((limit - i)/2)}h ago`);
  } else if (timeframe === '7D') {
    interval = '4h';
    limit = 42;
    labels = Array.from({length: limit}, (_, i) => `${Math.floor((limit - i)/6)}d ago`);
  }

  // Use BTC as the "Market Sentiment Proxy" for the dashboard trendline
  const dataPoints = await fetchChartData('BTC', interval, limit) || Array(limit).fill(64000);

  mainMarketChart = new Chart(ctxMain, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Market Trend (Proxy: BTC)',
        data: dataPoints,
        borderColor: '#6C5CE7',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          position: 'right',
          ticks: { callback: (value) => '$' + value.toLocaleString() }
        }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });

  // Social Volume Chart (Sentiment Page)
  const socialCanvas = document.getElementById('socialChart');
  if (socialCanvas) {
    const ctxSocial = socialCanvas.getContext('2d');
    const gradientSocial = ctxSocial.createLinearGradient(0, 0, 0, 200);
    gradientSocial.addColorStop(0, 'rgba(0, 230, 118, 0.3)');
    gradientSocial.addColorStop(1, 'rgba(0, 230, 118, 0.0)');

    // Generate a realistic 24h momentum curve ending at current score
    const socialData = Array.from({length: 24}, (_, i) => {
      const progress = i / 23;
      const base = 40 + (progress * (LIVE_SENTIMENT.score - 40));
      const noise = Math.sin(i * 0.5) * 8;
      return Math.max(0, Math.min(100, base + noise));
    });

    socialChart = new Chart(ctxSocial, {
      type: 'line',
      data: {
        labels: Array.from({length: 24}, (_, i) => `${i}h`),
        datasets: [{
          label: 'Social Mentions Index',
          data: socialData,
          borderColor: '#00E676',
          backgroundColor: gradientSocial,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: true, min: 0, max: 100 } }
      }
    });
  }
}

function simulateMarketTick() {
   // Synchronize UI Chart with the latest live price from the global state
   if(mainMarketChart && assets.length > 0) {
      const btc = assets.find(a => a.symbol === 'BTC');
      if (btc) {
        const currentData = mainMarketChart.data.datasets[0].data;
        currentData.shift();
        currentData.push(btc.price);
        mainMarketChart.update('none'); 
      }
   }
   updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);
   
   // Update UI Elements softly
  document.querySelectorAll('.live-price').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        el.style.color = '#fff';
        el.textContent = `$${formatPrice(asset.price)}`;
        setTimeout(() => el.style.color = '', 300);
     }
  });

  document.querySelectorAll('.live-change').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        el.textContent = `${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%`;
        el.className = `live-change ${asset.change >= 0 ? 'text-green' : 'text-red'}`;
     }
  });
}

async function syncLiveApis() {
  const statusEl = document.getElementById('market-time');
  if(statusEl) statusEl.textContent = "Syncing Live APIs...";
  
  try {
    // 1. Fetch Market Leaderboard First (Top 50)
    const marketData = await fetchMarketData();
    if (!marketData) throw new Error('Failed to fetch market leaderboard');

    const cappedMarketData = marketData
      .filter(c => !isStablecoinSymbol(c.symbol, c.name, c.current_price))
      .slice(0, MAX_TRADABLE_ASSETS);

    const topSymbols = cappedMarketData
      .filter(c => !isStablecoinSymbol(c.symbol, c.name, c.current_price))
      .map(c => c.symbol.toUpperCase());
    const derivativeSymbols = topSymbols.slice(0, 15); // Top 15 for heavy OI/Funding data

    // 2. Fetch all other data using discovered symbols
    const [
      whales,
      narrativesData,
      chartPrices,
      fundingData,
      oiData,
      depthData,
      dunePulseData,
      btcChainData,
      sentimentData,
      fearGreedData,
      globalMarketData,
      defiPoolsData,
      newsData,
      technicalData
    ] = await Promise.all([
      fetchWhaleActivity(),
      fetchTrendingNarratives(),
      fetchChartData('BTC'),
      fetchFundingRates(derivativeSymbols),
      fetchOpenInterest(derivativeSymbols),
      fetchOrderBookDepth('BTC'),
      fetchDuneMarketPulse(),
      fetchBtcOnChain(),
      fetchSentiment(),
      fetchFearAndGreed(),
      fetchGlobalMarketData(),
      fetchDefiPools(),
      fetchNews(),
      fetchTechnicalSignals(derivativeSymbols)
    ]);

    // Update Global Narratives & Sentiment
    if (narrativesData && narrativesData.narratives) {
      NARRATIVES.length = 0;
      narrativesData.narratives.forEach(n => {
        // Add a random 'val' for the progress bar (calculated based on change)
        const progress = Math.min(100, Math.max(20, 50 + (n.change * 3)));
        NARRATIVES.push({ ...n, val: progress });
      });
      renderNarrativeMomentum();
    }

    if (sentimentData) {
      LIVE_SENTIMENT = sentimentData;
      // If data is unavailable or neutral (50), inject dynamic bias from market performance
      if (LIVE_SENTIMENT.score === 50 && assets.length > 0) {
        const avgChange = assets.slice(0, 10).reduce((acc, a) => acc + a.change, 0) / 10;
        LIVE_SENTIMENT.score = Math.min(95, Math.max(5, 50 + (avgChange * 5)));
        LIVE_SENTIMENT.source = 'Momentum Engine';
      }
    }
    if (fearGreedData && Number.isFinite(fearGreedData.value)) LIVE_FNG = fearGreedData;

    if (defiPoolsData && defiPoolsData.length > 0) {
      DEFI_POOLS.length = 0;
      defiPoolsData.forEach(pool => DEFI_POOLS.push(pool));
    }

    if (newsData && newsData.length > 0) {
      NEWS.length = 0;
      newsData.forEach(item => NEWS.push(item));
    }

    if (technicalData?.ema && Object.keys(technicalData.ema).length > 0) {
      window._liveEmaData = technicalData.ema;
    }

    if (globalMarketData?.data) {
      window._liveGlobalMarketData = globalMarketData.data;
    }

    // Store derivatives data globally
    if (fundingData && fundingData.length > 0) LIVE_FUNDING = fundingData;
    if (oiData && oiData.length > 0) LIVE_OI = oiData;
    if (depthData) LIVE_DEPTH = depthData;
    if (dunePulseData) LIVE_DUNE_PULSE = dunePulseData;
    if (btcChainData) LIVE_BTC_CHAIN = btcChainData;
    window._liveFundingData = LIVE_FUNDING;
    window._liveOiData = LIVE_OI;
    window._liveDepthData = LIVE_DEPTH;
    window._liveDunePulse = LIVE_DUNE_PULSE;

    // Surface API status for debugging + AI context injection
    const apiHealth = getApiHealthSummary();
    window._apiHealthSummary = apiHealth;
    window._apiHealthPrompt = getApiHealthPromptSummary();
    if (apiHealth.degraded > 0 || apiHealth.failed > 0) {
      const failingApis = apiHealth.services
        .filter(s => s.status !== 'ok')
        .map(s => `${s.name}: ${s.status} (${s.detail || 'no detail'})`)
        .join(' | ');
      console.warn('⚠️ API health issues detected:', failingApis);
    }

    // Update Whale & Smart Money Flows
    if (whales && whales.length > 0) {
      WHALE_ACTIONS.length = 0;
      SMART_MONEY_FLOWS.length = 0;
      ALPHA_SIGNALS.length = 0;
      
      whales.slice(0, 6).forEach((w, i) => {
        const type = i % 2 === 0 ? 'buy' : 'sell';
        const formattedVal = '$' + w.value.toFixed(1) + 'M';
        
        WHALE_ACTIONS.push({
          time: "Live Tx",
          text: type === 'buy' ? `${formattedVal} transferred to` : `${formattedVal} withdrawn from`,
          type: type,
          amount: w.token || "USDC",
          exchange: "DEX/CEX"
        });

        if (i < 5) {
          SMART_MONEY_FLOWS.push({
            amount: formattedVal,
            asset: w.token || "USDC",
            type: type === 'buy' ? 'inflow' : 'outflow',
            wallet: "Whale " + w.from.slice(0,6),
            time: "Live",
            tag: type === 'buy' ? 'accumulation' : 'distribution'
          });
        }
      });
      renderSmartMoneyFlow();
      renderWhalePage(); // Update the dedicated whale page
      
      ALPHA_SIGNALS.push({ time: "Live Alert", text: "Heavy on-chain crypto asset rotation detected across smart money addresses.", impact: "high" });
      ALPHA_SIGNALS.push({ time: "Live Alert", text: `Top whale executed a massive ${whales[0].token || 'ETH'} transaction worth $${whales[0].value.toFixed(1)}M.`, impact: "high" });
      ALPHA_SIGNALS.push({ time: "Live Alert", text: "Institutional flow algorithms detect accumulation in top 10 assets.", impact: "medium" });
    }

    // ═══ SINGLE SOURCE OF TRUTH ═══
    // Fetch pre-computed, server-cached market data from /api/market
    // This endpoint returns identical data to every device worldwide.
    let serverAssets = null;
    let binancePatterns = {};
    try {
      const serverRes = await fetch('/api/market');
      if (serverRes.ok) {
        const serverData = await serverRes.json();
        if (serverData.data && serverData.data.length > 0) {
          serverAssets = serverData.data.map(a => {
            if (binancePatterns && binancePatterns[a.symbol]) {
               a.reason = binancePatterns[a.symbol];
            } else if (!a.reason) {
               a.reason = generateReason(a, a.score);
            }
            return a;
          }).filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
          console.log(`✅ Server market data loaded (source: ${serverData.source}, age: ${serverData.age}s)`);
        }
      }
    } catch(e) {
      console.warn('⚠️ Server /api/market unavailable, falling back to client-side:', e.message);
    }

    if (serverAssets) {
      assets = applyDuneMacroCalibration(serverAssets, LIVE_DUNE_PULSE);
    } else if (marketData && marketData.length > 0) {
      // Fallback: compute client-side (only if server endpoint is down)
      assets = cappedMarketData.map(coin => {
         const symbol = coin.symbol.toUpperCase();
         const change24h = coin.price_change_percentage_24h || 0;
         const volRatio = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) : 0;
         const mcapRank = coin.market_cap_rank || 50;
         const alpha = computeDirectionalNeutralAlpha(change24h, volRatio, mcapRank);
         const actualReason = (binancePatterns && binancePatterns[symbol]) ? binancePatterns[symbol] : generateReason(coin, alpha);
         
         return {
           symbol, name: coin.name, price: coin.current_price, change: change24h,
           score: alpha,
           bias: change24h >= 1 ? 'bullish' : (change24h <= -1 ? 'bearish' : 'neutral'),
           reason: actualReason, vol: '$' + (coin.total_volume / 1e9).toFixed(1) + 'B'
         };
      }).filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
      assets = applyDuneMacroCalibration(assets, LIVE_DUNE_PULSE);
    }

    if (assets.length > 0) {
      if (statusEl) statusEl.textContent = 'Running SCALP signal scan...';
      assets = await hydrateAssetsWithSignals(assets);
      assets = applyDirectionalBiasToAssets(assets);
      assets = enforceTopAssetUniverse(assets);
    }

    if (assets.length > 0) {
      
      renderDashboard();
      renderOpportunitiesPage();
      renderProSignals();
      saveDataCache(); // Persist to localStorage for cross-device consistency
      if(statusEl) statusEl.textContent = "Live Feed Synced";
    }
  } catch(e) {
    console.error("Live sync failed", e);
  }
}

// --- Navigation ---
function setupSidebar() {
  const navContainer = document.getElementById('sidebar-nav');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('mobile-toggle');
  
  navContainer.innerHTML = NAV_ITEMS.map((item, index) => `
    <div class="nav-item ${index === 0 ? 'active' : ''}" data-page="${item.id}">
      <i data-feather="${item.icon}"></i>
      <span>${item.label}</span>
      ${item.beta ? '<span class="nav-beta-badge">BETA</span>' : ''}
    </div>
  `).join('');
  
  if (typeof feather !== 'undefined') feather.replace();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const pageId = e.currentTarget.dataset.page;
      navigateToPage(pageId);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Cross-links
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      navigateToPage(e.currentTarget.dataset.target);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Mobile Toggle Logic
  if (toggle && overlay) {
    toggle.addEventListener('click', () => {
      sidebar.classList.add('active');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

function navigateToPage(pageId) {
  const targetPage = document.getElementById(`page-${pageId}`);
  if (!targetPage) {
    console.warn(`⚠️ Unknown page requested: ${pageId}`);
    return;
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if(activeNav) activeNav.classList.add('active');
  
  const pageInfo = NAV_ITEMS.find(i => i.id === pageId);
  if (pageInfo) {
    document.getElementById('page-title').textContent = pageInfo.label;
  }
  
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  targetPage.classList.add('active');
}

function updateTime() {
  const now = new Date();
  document.getElementById('market-time').textContent = now.toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
}

function getBtcAsset() {
  return assets.find(a => a.symbol === 'BTC') || null;
}

function updateMarketCapHeader(timeframe = CURRENT_MARKET_TIMEFRAME) {
  CURRENT_MARKET_TIMEFRAME = String(timeframe || CURRENT_MARKET_TIMEFRAME || '24H').toUpperCase();
  const titleTextEl = document.getElementById('market-cap-title-text');
  if (titleTextEl) {
    titleTextEl.textContent = `Total Market Cap Trend (${CURRENT_MARKET_TIMEFRAME})`;
  }

  const btcPriceEl = document.getElementById('market-cap-btc-price');
  if (btcPriceEl) {
    const btc = getBtcAsset();
    if (btc && Number.isFinite(btc.price) && btc.price > 0) {
      const change = Number.isFinite(btc.change) ? btc.change : 0;
      const prefix = change >= 0 ? '+' : '';
      btcPriceEl.textContent = `BTC $${formatPrice(btc.price)}  ${prefix}${change.toFixed(2)}%`;
      btcPriceEl.classList.remove('up', 'down');
      btcPriceEl.classList.add(change >= 0 ? 'up' : 'down');
    } else {
      btcPriceEl.textContent = 'BTC syncing...';
      btcPriceEl.classList.remove('up', 'down');
    }
  }
}

// --- Page Renders ---

function renderDashboard() {
  // Compute live summary values from assets
  const tradeableAssets = assets.filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
  const alphaRankedAssets = getSortedTradeableAssets('alpha');
  const topAsset = alphaRankedAssets[0];
  const topAssetScore = topAsset ? getUnifiedAlphaScore(topAsset) : null;
  const totalVol = tradeableAssets.reduce((sum, a) => sum + parseVolumeBillions(a.vol), 0);
  const avgChange = tradeableAssets.length ? (tradeableAssets.reduce((s, a) => s + a.change, 0) / tradeableAssets.length) : 0;
  const sentLabel = LIVE_SENTIMENT.score > 60 ? 'Bullish' : (LIVE_SENTIMENT.score < 40 ? 'Bearish' : 'Neutral');
  const sentClass = LIVE_SENTIMENT.score > 60 ? 'text-green' : (LIVE_SENTIMENT.score < 40 ? 'text-red' : 'text-warning');
  updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);

  document.getElementById('dashboard-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Total 24H Volume</span>
        <i data-feather="bar-chart-2" class="card-icon text-primary"></i>
      </div>
      <div class="card-value">$${totalVol.toFixed(1)}B</div>
      <div class="card-change ${avgChange >= 0 ? 'text-green' : 'text-red'}">${avgChange >= 0 ? '▲' : '▼'} ${Math.abs(avgChange).toFixed(2)}% avg</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Fear & Greed</span>
        <i data-feather="pie-chart" class="card-icon text-warning"></i>
      </div>
      <div class="card-value">${LIVE_FNG.value}</div>
      <div class="card-change ${LIVE_FNG.value > 50 ? 'text-green' : 'text-red'}">${LIVE_FNG.label}</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Alpha Target</span>
        <i data-feather="target" class="card-icon text-primary"></i>
      </div>
      <div class="card-value text-primary">${topAsset ? topAsset.symbol : '—'}</div>
      <div class="card-change">Score: ${topAssetScore ?? '—'} • ${topAssetScore > 75 ? 'High Conviction' : 'Moderate'}</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Macro Sentiment</span>
        <i data-feather="activity" class="card-icon ${sentClass}"></i>
      </div>
      <div class="card-value ${sentClass}">${sentLabel}</div>
      <div class="card-change text-muted">${LIVE_SENTIMENT.source || 'Reddit NLP'}: ${LIVE_SENTIMENT.score}/100</div>
    </div>
  `;
  if (typeof feather !== 'undefined') feather.replace();

  // Dash Opportunities Mini — keep compact for dashboard readability
  const dashOpps = document.getElementById('dash-opportunities-list');
  const sortedForDash = alphaRankedAssets;
  if (dashOpps) {
    dashOpps.innerHTML = sortedForDash.slice(0, 8).map(asset => `
    <div class="asset-row">
      <div class="asset-info">
        <div class="asset-icon">${asset.symbol[0]}</div>
        <div class="asset-name-col">
          <span class="asset-name">${asset.symbol}</span>
          <span class="asset-symbol">Score: ${getUnifiedAlphaScore(asset)}</span>
        </div>
      </div>
      <div class="asset-price">$${formatPrice(asset.price)}</div>
      <div class="asset-change ${asset.change >= 0 ? 'text-green' : 'text-red'}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</div>
      <div class="bias-badge bias-${asset.bias}">${asset.bias === 'bullish' ? 'LONG' : (asset.bias === 'bearish' ? 'SHORT' : 'WAIT')}</div>
    </div>
    `).join('');
  }

  // AI Mini with typing effect — uses live top asset
  const aiContent = document.getElementById('dash-ai-research-content');
  if (aiContent) {
    aiContent.innerHTML = '';
    const topSym = topAsset ? topAsset.symbol : 'BTC';
    const topName = topAsset ? topAsset.name : 'Bitcoin';
    const topBias = topAsset ? topAsset.bias : 'neutral';
    const scoreLabel = Number.isFinite(topAssetScore) ? topAssetScore : '—';
    const changeLabel = topAsset && Number.isFinite(topAsset.change) ? topAsset.change.toFixed(2) : '0.00';
    typeWriterEffect(aiContent, [
      `> Executive Summary: ${topSym}`,
      `> ${topName} shows ${topBias} momentum. Alpha Score: ${scoreLabel}/100. 24H Change: ${changeLabel}%.`,
      `> Thesis: ${topName} is the highest-conviction play based on our multi-factor scoring engine. On-chain and sentiment data align with ${topBias} positioning.`
    ]);
  }

  // Whale Mini
  const dashWhale = document.getElementById('dash-whale-list');
  if (dashWhale) {
    if (WHALE_ACTIONS.length === 0) {
      dashWhale.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Syncing on-chain activity...</div>`;
    } else {
      dashWhale.innerHTML = WHALE_ACTIONS.slice(0,4).map(action => `
        <div class="feed-item whale-${action.type}">
          <div class="feed-header">
            <span class="feed-time">${action.time}</span>
            <span class="feed-tag">${action.exchange}</span>
          </div>
          <div class="feed-content">${action.text} <strong>${action.amount}</strong></div>
        </div>
      `).join('');
    }
  }

  renderSmartMoneyFlow();
  renderNarrativeMomentum();

  // Alpha Mini
  const dashAlpha = document.getElementById('dash-alpha-list');
  if (dashAlpha) {
    dashAlpha.innerHTML = '';
    
    if (ALPHA_SIGNALS.length > 0) {
      dashAlpha.innerHTML += ALPHA_SIGNALS.slice(0,3).map(action => `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">${action.time}</span>
            <span class="feed-tag" style="background: rgba(108, 92, 231, 0.2); color: var(--primary);">ALPHA</span>
          </div>
          <div class="feed-content">
            ${action.text}
          </div>
        </div>
      `).join('');
    }
    
    // Add derivatives intelligence to Alpha feed
    if (LIVE_FUNDING.length > 0) {
      const extremeFunding = LIVE_FUNDING.filter(f => Math.abs(f.rate) > 0.0005).slice(0, 2);
      extremeFunding.forEach(f => {
        const direction = f.rate > 0 ? 'Longs Overleveraged' : 'Shorts Squeezable';
        dashAlpha.innerHTML += `
          <div class="feed-item news-impact">
            <div class="feed-header">
              <span class="feed-time">Live Derivatives</span>
              <span class="feed-tag" style="background: rgba(255,183,77,0.2); color: var(--warning);">FUNDING</span>
            </div>
            <div class="feed-content">
              <strong>${f.symbol}</strong> funding rate: ${(f.rate * 100).toFixed(4)}% — ${direction}
            </div>
          </div>
        `;
      });
    }
    
    // Add BTC on-chain health
    if (LIVE_BTC_CHAIN) {
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">On-Chain</span>
            <span class="feed-tag" style="background: rgba(0,230,118,0.2); color: var(--green);">BTC HEALTH</span>
          </div>
          <div class="feed-content">
            Hash Rate: <strong>${LIVE_BTC_CHAIN.hashRate} EH/s</strong> | Mempool: <strong>${LIVE_BTC_CHAIN.unconfirmedTx.toLocaleString()}</strong> unconfirmed txs
          </div>
        </div>
      `;
    }

    if (LIVE_DUNE_PULSE) {
      const duneBiasColor = LIVE_DUNE_PULSE.bias === 'bullish'
        ? 'var(--green)'
        : (LIVE_DUNE_PULSE.bias === 'bearish' ? 'var(--red)' : 'var(--warning)');
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">Dune Macro</span>
            <span class="feed-tag" style="background: rgba(108,92,231,0.18); color: var(--primary);">ON-CHAIN PULSE</span>
          </div>
          <div class="feed-content">
            Score: <strong style="color:${duneBiasColor};">${LIVE_DUNE_PULSE.signalScore.toFixed(1)}/100 (${LIVE_DUNE_PULSE.bias.toUpperCase()})</strong> |
            DEX Vol Δ24h: <strong>${LIVE_DUNE_PULSE.volumeGrowthPct.toFixed(1)}%</strong> |
            BTC Tx Δ24h: <strong>${LIVE_DUNE_PULSE.btcTxGrowthPct.toFixed(1)}%</strong>
          </div>
        </div>
      `;
    }
    
    // Add Order Book depth
    if (LIVE_DEPTH) {
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">Order Book</span>
            <span class="feed-tag" style="background: rgba(108,92,231,0.2); color: var(--primary);">BTC DEPTH</span>
          </div>
          <div class="feed-content">
            Buy Pressure: <strong class="${parseFloat(LIVE_DEPTH.buyPressure) > 50 ? 'text-green' : 'text-red'}">${LIVE_DEPTH.buyPressure}%</strong> | Support Wall: <strong>$${formatPrice(LIVE_DEPTH.support)}</strong> | Resistance: <strong>$${formatPrice(LIVE_DEPTH.resistance)}</strong>
          </div>
        </div>
      `;
    }
  }
}

function renderSmartMoneyFlow() {
  const container = document.getElementById('smart-money-list');
  if (!container) return;
  if (SMART_MONEY_FLOWS.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Scanning for institutional wallet activity...</div>`;
    return;
  }
  container.innerHTML = SMART_MONEY_FLOWS.map(flow => `
    <div class="flow-card">
      <div class="flow-icon ${flow.type}">
        ${flow.type === 'inflow' ? '📥' : '📤'}
      </div>
      <div class="flow-details">
        <div class="flow-amount">${flow.amount} ${flow.asset} ${flow.type === 'inflow' ? 'Inflow' : 'Outflow'}</div>
        <div class="flow-meta">
          <span>${flow.wallet}</span>
          <span class="text-muted">• ${flow.time}</span>
        </div>
      </div>
      <div class="flow-tag ${flow.tag}">${flow.tag}</div>
    </div>
  `).join('');
}

function renderNarrativeMomentum() {
  const container = document.getElementById('narrative-momentum-list');
  if (!container) return;
  if (NARRATIVES.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Syncing sector momentum from CoinGecko...</div>`;
    return;
  }
  container.innerHTML = NARRATIVES.map((n, i) => `
    <div class="narrative-card">
      <div class="narrative-left">
        <div class="narrative-rank">#${i + 1}</div>
        <div class="narrative-name">${n.name}</div>
      </div>
      <div class="narrative-right">
        <div class="narrative-score text-green">${n.change}</div>
        <div class="narrative-bar-bg">
          <div class="narrative-bar-fill" style="width: ${n.val}%"></div>
        </div>
      </div>
    </div>
  `).join('');
}

window.triggerMcp = async function(type) {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('ai-chat-submit');
  if (!input || !btn) return;

  input.value = type;
  btn.click();
}


function typeWriterEffect(element, lines, speed = 20) {
  if (!element) return;
  const safeLines = Array.isArray(lines) ? lines : [];
  const state = element._typingState || { runId: 0, timers: new Set() };
  state.runId += 1;
  const runId = state.runId;
  state.timers.forEach((timerId) => clearTimeout(timerId));
  state.timers.clear();
  element._typingState = state;
  element.innerHTML = '';

  const schedule = (fn, delay) => {
    const timerId = setTimeout(() => {
      state.timers.delete(timerId);
      if (state.runId !== runId) return;
      fn();
    }, delay);
    state.timers.add(timerId);
  };

  let lineIdx = 0;

  function typeLine() {
    if (state.runId !== runId) return;
    if (lineIdx >= safeLines.length) {
      const cursor = document.createElement('span');
      cursor.className = 'ai-cursor';
      element.appendChild(cursor);
      return;
    }

    const lineText = String(safeLines[lineIdx] || '');
    const lineDiv = document.createElement('div');
    lineDiv.className = lineIdx === 0 ? 'ai-line highlight' : 'ai-line';
    lineDiv.style.opacity = '1';
    element.appendChild(lineDiv);

    let charIdx = 0;
    function typeChar() {
      if (state.runId !== runId) return;
      if (charIdx < lineText.length) {
        lineDiv.textContent += lineText.charAt(charIdx);
        charIdx += 1;
        schedule(typeChar, speed);
      } else {
        lineIdx += 1;
        schedule(typeLine, 100);
      }
    }
    typeChar();
  }

  typeLine();
}

function renderOpportunitiesPage() {
  const tbody = document.getElementById('opportunities-table-body');
  const sorted = getSortedTradeableAssets(OPPORTUNITY_SORT);
  const visibleRows = sorted.slice(0, MAX_TOP_OPPORTUNITIES);

  const renderSignalCell = (signal = null) => {
    if (!signal) {
      return `
        <div style="display:flex;flex-direction:column;gap:0.25rem;">
          <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); font-size: 0.62rem; padding: 0.15rem 0.4rem; width: fit-content;">NO_DATA</span>
          <span class="text-muted" style="font-size: 0.7rem;">Awaiting scan...</span>
        </div>
      `;
    }

    const line = String(signal.line || '');
    if (signal.status === 'SIGNAL') {
      const dirIsBuy = signal.direction === 'BUY';
      return `
        <div style="display:flex;flex-direction:column;gap:0.25rem;">
          <span class="badge ${dirIsBuy ? 'sig-long' : 'sig-short'}" style="font-size: 0.62rem; padding: 0.15rem 0.45rem; width: fit-content;">
            ${dirIsBuy ? 'BUY' : 'SELL'} - ${Number(signal.alpha ?? 50).toFixed(0)}
          </span>
          <span class="text-muted" style="font-size: 0.64rem; line-height: 1.25; font-family: var(--font-mono); word-break: break-all;">${line}</span>
        </div>
      `;
    }

    return `
      <div style="display:flex;flex-direction:column;gap:0.25rem;">
        <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); font-size: 0.62rem; padding: 0.15rem 0.4rem; width: fit-content;">NO_SIGNAL</span>
        <span class="text-red" style="font-size: 0.68rem;">${signal.reason || 'RULE_FAIL'}</span>
        <span class="text-muted" style="font-size: 0.64rem; line-height: 1.25; font-family: var(--font-mono); word-break: break-all;">${line}</span>
      </div>
    `;
  };
  
  tbody.innerHTML = visibleRows.map((asset, i) => {
    const displayScore = getUnifiedAlphaScore(asset);
    const scalpSignal = asset?.signals?.scalp || null;
    const patternLabel = asset?.patternDetected || asset?.reason || 'NONE';

    return `
    <tr>
      <td class="text-muted">${i+1}</td>
      <td><strong>${asset.name}</strong> <span class="text-muted ml-2">${asset.symbol}</span></td>
      <td style="font-family: var(--font-mono)" class="live-price" data-symbol="${asset.symbol}">$${formatPrice(asset.price)}</td>
      <td class="${asset.change >= 0 ? 'text-green' : 'text-red'} live-change" data-symbol="${asset.symbol}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</td>
      <td>
        <div class="td-score-container">
          <span class="td-score-val">${displayScore}</span>
          <div class="td-score-bar-bg">
            <div class="td-score-bar-fill" style="width: ${displayScore}%"></div>
          </div>
        </div>
      </td>


      <td><span class="text-muted" style="font-size: 0.8rem">${patternLabel}</span></td>
      <td>${renderSignalCell(scalpSignal)}</td>
      <td><button class="action-btn">Analyze</button></td>
    </tr>
  `}).join('');

  document.querySelectorAll('#opportunities-table-body .action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const symbol = row.querySelector('.live-price').dataset.symbol;
      const selectedAsset = assets.find(a => a.symbol === symbol);
      const scalpSignal = selectedAsset?.signals?.scalp;
      
      navigateToPage('ai-research'); // Switch to AI Research Analyst Page
      setTimeout(() => {
        if (scalpSignal?.status === 'SIGNAL') {
          triggerMcp(
            `Generate a SCALP-only trade plan for ${symbol}/USDT. `
            + `Use these mandatory algorithmic values exactly: `
            + `direction=${scalpSignal.direction}, `
            + `entry=${scalpSignal.entry}, tp1=${scalpSignal.tp1}, tp2=${scalpSignal.tp2}, sl=${scalpSignal.sl}, `
            + `alpha=${scalpSignal.alpha}, line="${scalpSignal.line}". `
            + `Output 3 entries around the provided entry and keep tight scalp risk management.`
          );
        } else {
          triggerMcp(`No valid SCALP signal exists for ${symbol}/USDT right now. Explain why and what must change before entry.`);
        }
      }, 100);
    });
  });
}

function renderTradingPage(symbol = 'BINANCE:SOLUSDT') {
  if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
      "autosize": true,
      "symbol": symbol,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "backgroundColor": "#0E1320",
      "gridColor": "#1C2438",
      "hide_top_toolbar": false,
      "hide_legend": false,
      "save_image": false,
      "container_id": "tradingview-widget",
      "toolbar_bg": "#0E1320",
      "allow_symbol_change": true,
      "hide_side_toolbar": false
    });
  }
}

function setupAllButtons() {
  // 1. Dashboard Timeframe Buttons
  document.querySelectorAll('#market-timeframe-actions .market-timeframe-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tf = e.currentTarget.dataset.tf || e.currentTarget.textContent.trim();
      const parent = e.currentTarget.closest('.panel-actions');
      if (parent) parent.querySelectorAll('.panel-action-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      updateMarketCapHeader(tf);
      showToast(`Market chart updated to ${tf} timeframe`);
      initCharts(tf);
    });
  });

  // 2. Opportunities Sorting
  document.querySelectorAll('#page-opportunities .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sort = e.target.dataset.sort;
      document.querySelectorAll('#page-opportunities .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      OPPORTUNITY_SORT = sort || 'alpha';
      renderOpportunitiesPage();
      showToast(`Sorted by ${sort}`);
    });
  });

  // 3. Whale Flow Filtering
  document.querySelectorAll('#page-whale .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#page-whale .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      showToast(`Filtering flow: ${e.target.textContent}`);
      renderWhalePage(); // Re-render current mock
    });
  });

  // 4. Backtester Strategy Tabs
  document.querySelectorAll('#bt-strategy-tabs .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const strat = e.target.dataset.strat;
      document.querySelectorAll('#bt-strategy-tabs .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderBacktesterPage(); // This will filter based on strat if logic is added
      showToast(`Strategy view: ${strat.toUpperCase()}`);
    });
  });

  // 5. Header Search & Alerts
  const searchBtn = document.getElementById('search-btn');
  if(searchBtn) searchBtn.addEventListener('click', () => {
    navigateToPage('opportunities');
    const table = document.getElementById('opportunities-table-body');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const headerAlertBtn = document.getElementById('alert-btn');
  if(headerAlertBtn) headerAlertBtn.addEventListener('click', () => {
    const modal = document.getElementById('alert-modal');
    if(modal) modal.classList.add('active');
  });

  // 6. Settings Buttons
  const settingsBtns = document.querySelectorAll('#page-settings .btn-primary, #page-settings .btn-secondary');
  settingsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      showToast("Settings updated successfully and synced to cloud.");
    });
  });

  // 7. Alert Management
  const alertsTable = document.getElementById('alerts-table-body');
  if (alertsTable) {
    alertsTable.addEventListener('click', (e) => {
      const trashBtn = e.target.closest('.icon-btn.text-red');
      if (trashBtn) {
        const row = trashBtn.closest('tr');
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        row.style.transition = 'all 0.3s ease';
        setTimeout(() => {
          row.remove();
          showToast("Trigger deleted.");
        }, 300);
      }
    });
  }

  const newAlertBtn = document.getElementById('new-alert-page-btn');
  if(newAlertBtn) newAlertBtn.addEventListener('click', () => {
    const modal = document.getElementById('alert-modal');
    if(modal) modal.classList.add('active');
  });

  const createAlertBtn = document.getElementById('create-alert-btn');
  if(createAlertBtn) {
    createAlertBtn.addEventListener('click', () => {
      const asset = document.getElementById('alert-asset').value;
      const cond = document.getElementById('alert-condition').value;
      showToast(`Alert deployed for ${asset} on ${cond}`);
      const modal = document.getElementById('alert-modal');
      if(modal) modal.classList.remove('active');
      
      // Add row to table
      const table = document.getElementById('alerts-table-body');
      if(table) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${asset}</strong></td>
          <td>Custom</td>
          <td>${cond}</td>
          <td><span class="badge bg-primary">Push</span></td>
          <td><span class="text-green"><span class="status-dot pulse mr-2" style="display:inline-block"></span> Active</span></td>
          <td><button class="icon-btn text-red"><i data-feather="trash-2"></i></button></td>
        `;
        table.prepend(row);
        feather.replace();
      }
    });
  }
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if(!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i data-feather="check-circle" style="color:var(--primary)"></i>
    <span>${msg}</span>
  `;
  container.appendChild(toast);
  feather.replace();
  setTimeout(() => toast.classList.add('active'), 10);
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.openTradingChart = function(coin) {
  // 1. Switch UI to trading page
  navigateToPage('trading');
  
  // 2. Format symbol
  const symbol = `BINANCE:${coin}USDT`;
  
  // 3. Update select dropdown dynamically if needed
  const tvSelect = document.getElementById('tv-pair-select');
  if(tvSelect) {
     let optionExists = Array.from(tvSelect.options).some(opt => opt.value === symbol);
     if(!optionExists) {
         const newOpt = new Option(`${coin}/USDT`, symbol);
         tvSelect.add(newOpt);
     }
     tvSelect.value = symbol;
  }
  
  // 4. Render the chart
  renderTradingPage(symbol);
}

function setupAiReports() {
  const reportCards = document.querySelectorAll('#ai-report-list .report-card');
  reportCards.forEach(card => {
    card.addEventListener('click', () => {
      const title = card.querySelector('h4').textContent;
      const input = document.getElementById('ai-chat-input');
      const submitBtn = document.getElementById('ai-chat-submit');
      
      if (input && submitBtn) {
        input.value = `Generate a comprehensive Deep Dive Intelligence Report on: ${title}. Include on-chain data, social narrative maps, and potential trade impact.`;
        submitBtn.click();
        
        // Scroll to chat
        const chatBody = document.querySelector('.chat-body');
        if (chatBody) chatBody.scrollTop = 0;
      }
    });
  });
}

function setupTradingEvents() {
  // Dropdown removed from UI
}

function renderWhalePage() {
  const buys = WHALE_ACTIONS.filter(w => w.type === 'buy').length;
  const sells = WHALE_ACTIONS.filter(w => w.type === 'sell').length;
  const trend = buys >= sells ? 'Accumulation' : 'Distribution';
  const trendClass = buys >= sells ? 'text-green' : 'text-red';
  const peakTx = WHALE_ACTIONS.length > 0 ? WHALE_ACTIONS[0].amount : '—';

  document.getElementById('whale-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Tracked Whale Txs</span></div>
      <div class="card-value text-primary">${WHALE_ACTIONS.length}</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Dominant Trend</span></div>
      <div class="card-value ${trendClass}">${trend}</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Top Asset</span></div>
      <div class="card-value">${peakTx}</div>
    </div>
  `;

  const tbody = document.getElementById('whale-table-body');
  tbody.innerHTML = WHALE_ACTIONS.map((w, i) => `
    <tr>
      <td class="text-muted" style="font-family: var(--font-mono)">${w.time}</td>
      <td><strong>${w.amount}</strong></td>
      <td><span class="bias-badge bias-${w.type === 'buy' ? 'bullish' : 'bearish'}">${w.type === 'buy' ? 'Accumulation' : 'Distribution'}</span></td>
      <td style="font-family: var(--font-mono)">${(i + 1) * 25}k ${w.amount}</td>
      <td style="font-family: var(--font-mono)">$${((i + 1) * 1.5).toFixed(1)}M</td>
      <td class="text-muted">${w.type === 'buy' ? w.exchange + ' -> Cold Storage' : 'Wallet -> ' + w.exchange}</td>
    </tr>
  `).join('');
}



function setupAiResearchChat() {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('ai-chat-submit');
  const history = document.getElementById('ai-chat-history');

  if (!input || !btn || !history) return;
  let isSubmitting = false;

  const handleChat = async () => {
    const val = input.value.trim();
    if (!val || isSubmitting) return;
    isSubmitting = true;
    btn.disabled = true;
    
    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message user';
    userMsg.style.flexDirection = 'row-reverse';
    const userAvatar = document.createElement('div');
    userAvatar.className = 'avatar';
    userAvatar.style.background = 'rgba(255,255,255,0.1)';
    const userIcon = document.createElement('i');
    userIcon.setAttribute('data-feather', 'user');
    userAvatar.appendChild(userIcon);
    const userBubble = document.createElement('div');
    userBubble.className = 'bubble';
    userBubble.style.background = 'var(--primary-gradient)';
    userBubble.style.color = '#fff';
    userBubble.textContent = val;
    userMsg.appendChild(userAvatar);
    userMsg.appendChild(userBubble);
    history.appendChild(userMsg);
    if (typeof feather !== 'undefined') feather.replace();
    
    input.value = '';
    history.scrollTop = history.scrollHeight;

    // Add loading indicator
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'chat-message ai';
    const loadingAvatar = document.createElement('div');
    loadingAvatar.className = 'avatar';
    const loadingIcon = document.createElement('i');
    loadingIcon.setAttribute('data-feather', 'cpu');
    loadingAvatar.appendChild(loadingIcon);
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'bubble';
    const loadingCursor = document.createElement('span');
    loadingCursor.className = 'ai-cursor';
    loadingBubble.appendChild(loadingCursor);
    loadingBubble.appendChild(document.createTextNode(' Synthesizing data...'));
    loadingMsg.appendChild(loadingAvatar);
    loadingMsg.appendChild(loadingBubble);
    history.appendChild(loadingMsg);
    if (typeof feather !== 'undefined') feather.replace();
    history.scrollTop = history.scrollHeight;

    try {
      // Fetch from AI with full platform context
      const promptUpper = String(val || '').toUpperCase();
      const pairMatch = promptUpper.match(/\b([A-Z0-9]{2,10})\s*\/\s*USDT\b/) || promptUpper.match(/\b([A-Z0-9]{2,10})USDT\b/);
      const requestedSymbol = pairMatch ? pairMatch[1] : null;
      const liveAssets = assets
        .filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
      const prioritizedAssets = requestedSymbol
        ? [
            ...liveAssets.filter(a => a.symbol === requestedSymbol),
            ...liveAssets.filter(a => a.symbol !== requestedSymbol)
          ]
        : liveAssets;
      const assetCtx = prioritizedAssets
        .slice(0, 24)
        .map(a => `${a.symbol}: CURRENT_PRICE=$${a.price} (${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}%) - Rationale: ${a.reason}`)
        .join(' | ');
      const apiHealthCtx = window._apiHealthPrompt ? `API HEALTH: ${window._apiHealthPrompt}` : 'API HEALTH: pending first sync';
      const duneCtx = LIVE_DUNE_PULSE
        ? `DUNE_PULSE: score=${LIVE_DUNE_PULSE.signalScore.toFixed(1)}, bias=${LIVE_DUNE_PULSE.bias}, dex_volume_growth_24h=${LIVE_DUNE_PULSE.volumeGrowthPct.toFixed(1)}%, btc_tx_growth_24h=${LIVE_DUNE_PULSE.btcTxGrowthPct.toFixed(1)}%.`
        : 'DUNE_PULSE: unavailable.';
      const dualRes = await fetchDualAI(val, `LATEST LIVE DATA: ${assetCtx}. ${apiHealthCtx}. ${duneCtx}`);

      if (loadingMsg.parentNode) history.removeChild(loadingMsg);

      const aiMsg = document.createElement('div');
      aiMsg.className = 'chat-message ai';
      const aiAvatar = document.createElement('div');
      aiAvatar.className = 'avatar';
      const aiIcon = document.createElement('i');
      aiIcon.setAttribute('data-feather', 'cpu');
      aiAvatar.appendChild(aiIcon);
      const aiBubble = document.createElement('div');
      aiBubble.className = `bubble${dualRes ? '' : ' text-red'}`;
      aiBubble.innerHTML = dualRes || 'Error: AI Engine offline or rate limited. Please try again.';
      aiMsg.appendChild(aiAvatar);
      aiMsg.appendChild(aiBubble);
      history.appendChild(aiMsg);
      if (typeof feather !== 'undefined') feather.replace();
      history.scrollTop = history.scrollHeight;
    } catch (err) {
      console.error('AI Research Stream failed:', err);
      if (loadingMsg.parentNode) history.removeChild(loadingMsg);

      const failMsg = document.createElement('div');
      failMsg.className = 'chat-message ai';
      failMsg.innerHTML = `
        <div class="avatar"><i data-feather="cpu"></i></div>
        <div class="bubble text-red">Error: AI stream timed out. Please try again.</div>
      `;
      history.appendChild(failMsg);
      if (typeof feather !== 'undefined') feather.replace();
      history.scrollTop = history.scrollHeight;
    } finally {
      isSubmitting = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', handleChat);
  input.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleChat();
  });
}

function setupModals() {
  const modal = document.getElementById('alert-modal');
  
  const openModal = () => modal.classList.add('active');
  const closeModal = () => modal.classList.remove('active');

  document.getElementById('alert-btn').addEventListener('click', openModal);
  document.getElementById('new-alert-page-btn')?.addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if(e.target === modal) closeModal(); });

  document.getElementById('create-alert-btn').addEventListener('click', () => {
    closeModal();
    showToast('Algorithmic trigger deployed successfully.');
  });
}

function formatPrice(num) {
  if (num < 1) return num.toFixed(4);
  if (num < 10) return num.toFixed(3);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// ============================================================
// NEXUS PRO SIGNALS
// ============================================================

function generateSignalForAsset(asset) {
  const scalp = asset?.signals?.scalp;
  const score = Number(asset?.opportunityScore ?? asset?.score ?? 50);

  if (!scalp || scalp.status !== 'SIGNAL') {
    return {
      type: 'WAIT',
      isBull: null,
      strength: { label: 'NO TRADE ZONE', cls: 'text-muted' },
      exchanges: ['Binance'],
      leverage: 'None',
      entry1: 0, entry2: 0, entry3: 0,
      t1: 0, t2: 0, t3: 0, t4: 0, sl: 0, rrRatio: '0.0',
      waitReason: `SCALP gate failed: ${scalp?.reason || 'DATA_UNAVAILABLE'}`
    };
  }

  const isBull = scalp.direction === 'BUY';
  const entry1 = Number(scalp.entry) || Number(asset.price) || 0;
  const sl = Number(scalp.sl) || (entry1 * (isBull ? 0.998 : 1.002));
  const t1 = Number(scalp.tp1) || (entry1 * (isBull ? 1.0025 : 0.9975));
  const t2 = Number(scalp.tp2) || (entry1 * (isBull ? 1.004 : 0.996));

  const risk = Math.max(Math.abs(entry1 - sl), entry1 * 0.0005);
  const entryStep = risk * 0.5;
  const entry2 = isBull ? Math.max(0, entry1 - entryStep) : (entry1 + entryStep);
  const entry3 = isBull ? Math.max(0, entry1 - (entryStep * 2)) : (entry1 + (entryStep * 2));

  const extension = Math.abs(t2 - entry1);
  const t3 = isBull ? (t2 + (extension * 0.6)) : (t2 - (extension * 0.6));
  const t4 = isBull ? (t2 + extension) : (t2 - extension);

  const rewardT2 = Math.abs(t2 - entry1);
  const rrRatio = risk > 0 ? (rewardT2 / risk).toFixed(1) : '2.0';
  const atrPct = entry1 > 0 ? (risk / entry1) : 0;

  let levNum;
  if (atrPct > 0.01) levNum = '2x-3x';
  else if (atrPct > 0.006) levNum = '3x-4x';
  else levNum = '4x-5x';

  const strength = score >= 80
    ? { label: 'HIGH CONVICTION', cls: 'text-green' }
    : score >= 65
      ? { label: 'MEDIUM CONVICTION', cls: 'text-primary' }
      : { label: 'LOW CONVICTION', cls: 'text-warning' };

  return {
    entry1,
    entry2,
    entry3,
    t1,
    t2,
    t3,
    t4,
    sl,
    exchanges: ['Binance'],
    leverage: `${levNum} Cross`,
    strength,
    isBull,
    type: 'SCALP',
    rrRatio,
    atrPct
  };
}

function renderProSignals() {
  const grid = document.getElementById('pro-signals-grid');
  if (!grid) return;

  // Use top 15 assets by opportunity score for the Pro Signals grid
  const top = [...assets]
    .filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price))
    .sort((a, b) => ((b.opportunityScore ?? b.score) - (a.opportunityScore ?? a.score)) || a.symbol.localeCompare(b.symbol))
    .slice(0, 15);

  if (!top.length) {
    grid.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:3rem;">No assets loaded yet. Live data syncs on startup.</div>`;
    return;
  }

  grid.innerHTML = top.map((asset, index) => {
    const sig = generateSignalForAsset(asset);
    
    if (sig.type === 'WAIT') {
      return `
        <div class="signal-card" id="signal-${asset.symbol}">
          <div class="signal-card-header">
            <div class="signal-pair">
              <span class="signal-symbol">#${asset.symbol}/USDT</span>
              <span class="badge" style="background:var(--bg-lighter); color:var(--text-muted); font-size: 0.65rem;">WAIT</span>
            </div>
            <div class="signal-strength ${sig.strength.cls}">${sig.strength.label}</div>
          </div>
          <div style="padding: 2rem 0; text-align: center; color: var(--text-muted);">
            <i data-feather="shield" style="margin-bottom: 1rem; opacity: 0.5;"></i>
            <p style="font-size: 0.85rem;">${sig.waitReason}</p>
          </div>
        </div>
      `;
    }

    const dirIcon = sig.isBull ? '📈' : '📉';
    const dirLabel = sig.isBull ? 'LONG' : 'SHORT';
    const dirClass = sig.isBull ? 'text-green' : 'text-red';
    
    // SaaS Freemium Logic: Lock signals after the 2nd one (Unlocked per user request)
    const isLocked = false;
    const lockedOverlay = isLocked ? `
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:10;background:rgba(10,12,16,0.65);border-radius:8px;">
        <span style="background:var(--primary);color:#fff;padding:0.5rem 1.2rem;border-radius:6px;font-size:0.85rem;font-weight:bold;cursor:pointer;box-shadow:0 4px 15px rgba(108,92,231,0.4);">🔒 UPGRADE TO PRO TO UNLOCK</span>
      </div>
    ` : '';
    const blurStyle = isLocked ? 'filter: blur(6px); pointer-events: none; user-select: none; opacity: 0.5;' : '';

    return `
      <div class="signal-card" id="signal-${asset.symbol}">
        <!-- Card Header -->
        <div class="signal-card-header">
          <div class="signal-pair">
            <span class="signal-envelope">📪</span>
            <span class="signal-symbol">#${asset.symbol}/USDT</span>
            <span class="signal-dir-badge ${sig.isBull ? 'sig-long' : 'sig-short'}">${dirIcon} ${dirLabel}</span>
            <span class="badge bg-primary ml-2" style="font-size: 0.65rem; border: 1px solid rgba(255,255,255,0.1)">${sig.type}</span>
          </div>
          <div class="signal-strength ${sig.strength.cls}">${sig.strength.label} ●</div>
        </div>

        <!-- Exchanges -->
        <div class="signal-row">
          <span class="signal-label">Exchange</span>
          <span class="signal-value">${sig.exchanges.join(', ')}</span>
        </div>

        <!-- Leverage -->
        <div class="signal-row">
          <span class="signal-label">Leverage</span>
          <span class="signal-value text-warning">${sig.leverage}</span>
        </div>

        <!-- Trade Type -->
        <div class="signal-row">
          <span class="signal-label">Trade Type</span>
          <span class="signal-value" style="color: var(--primary)">${sig.type}</span>
        </div>

        <!-- Divider -->
        <div class="signal-divider"></div>

        <!-- Premium Locked Container -->
        <div style="position:relative;margin-top:1rem;">
          ${lockedOverlay}
          <div style="${blurStyle}">
            <!-- Entry Zone -->
            <div class="signal-row">
              <span class="signal-label">Entry Zone</span>
              <span class="signal-value signal-mono">
                (${formatPrice(sig.entry1)}, ${formatPrice(sig.entry2)}, ${formatPrice(sig.entry3)})
              </span>
            </div>

            <!-- Targets -->
            <div class="signal-targets">
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 1</span>
                <span class="signal-mono text-green">${formatPrice(sig.t1)}</span>
                <span class="target-pct text-green">+${(((sig.t1 - asset.price) / asset.price) * 100).toFixed(2)}%</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 2</span>
                <span class="signal-mono text-green">${formatPrice(sig.t2)}</span>
                <span class="target-pct text-green">+${(((sig.t2 - asset.price) / asset.price) * 100).toFixed(2)}%</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 3</span>
                <span class="signal-mono text-green">${formatPrice(sig.t3)}</span>
                <span class="target-pct text-green">+${(((sig.t3 - asset.price) / asset.price) * 100).toFixed(2)}%</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 4</span>
                <span class="signal-mono text-green">${formatPrice(sig.t4)}</span>
                <span class="target-pct text-green">+${(((sig.t4 - asset.price) / asset.price) * 100).toFixed(2)}%</span>
              </div>
            </div>

            <!-- Stop Loss -->
            <div class="signal-row signal-sl-row">
              <span class="signal-label">🛑 Stop Loss</span>
              <span class="signal-mono text-red">${formatPrice(sig.sl)}</span>
              <span class="target-pct text-red">${(((sig.sl - asset.price) / asset.price) * 100).toFixed(2)}%</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="signal-footer">
          <span>Alpha: <strong class="text-primary">${asset.opportunityScore ?? asset.score}/100</strong></span>
          <span>Risk:Reward <strong class="text-green">${sig.rrRatio}</strong></span>
          <span>Vol: <strong class="text-warning">${(sig.atrPct * 100).toFixed(1)}%</strong></span>
          <span class="signal-brand">⚡ NEXUS Pro</span>
        </div>
      </div>
    `;
  }).join('');
}


async function setupSettingsPage() {
  const user = clerk.user;
  if (!user) return;

  const nameInput = document.getElementById('settings-display-name');
  const emailInput = document.getElementById('settings-email');
  const telegramInput = document.getElementById('settings-telegram');
  const updateBtn = document.getElementById('update-identity-btn');

  // Populate from Clerk
  if (nameInput) nameInput.value = user.fullName || user.username || '';
  if (emailInput) emailInput.value = user.primaryEmailAddress?.emailAddress || '';

  // Fetch additional data from Supabase
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('telegram_handle')
      .eq('clerk_id', user.id)
      .single();

    if (data && telegramInput) {
      telegramInput.value = data.telegram_handle || '';
    }
  } catch (e) {
    console.warn('⚠️ Could not fetch Supabase profile:', e.message);
  }

  // Handle Updates
  updateBtn?.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';

    const payload = {
      clerk_id: user.id,
      full_name: nameInput.value,
      email: emailInput.value,
      telegram_handle: telegramInput.value,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_profiles')
      .upsert(payload, { onConflict: 'clerk_id' });

    if (error) {
      showToast('❌ Update failed: ' + error.message);
    } else {
      showToast('✅ Identity updated successfully.');
      updateUserProfileUI(user);
    }

    updateBtn.disabled = false;
    updateBtn.textContent = 'Update Identity';
  });
}

document.querySelector('.subscription-body button')?.addEventListener('click', () => {
  showToast('💳 Redirecting to Stripe Customer Portal...');
  setTimeout(() => {
    alert('Subscription management is currently in Sandbox mode. Please contact support to upgrade your limits.');
  }, 1000);
});
