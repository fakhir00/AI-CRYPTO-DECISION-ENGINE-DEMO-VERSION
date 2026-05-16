// ═══════════════════════════════════════════════════════════════
// NEXUS Candlestick Pattern Recognition Engine
// Fetches OHLCV from Binance and detects institutional patterns
// ═══════════════════════════════════════════════════════════════

// Cache: symbol+interval → { patterns, timestamp }
const cache = {};
const CACHE_TTL = 20 * 1000; // 20 seconds (scalp data freshness)

// ── Pattern Detection Helpers ──────────────────────────────────

function bodySize(o, c) { return Math.abs(c - o); }
function upperWick(o, c, h) { return h - Math.max(o, c); }
function lowerWick(o, c, l) { return Math.min(o, c) - l; }
function range(h, l) { return h - l; }
function isBull(o, c) { return c > o; }
function isBear(o, c) { return c < o; }

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabase = null;

function getSupabaseClient() {
  if (supabase) return supabase;
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    return supabase;
  } catch {
    return null;
  }
}

// ── Market Structure & Volatility ──────────────────────────────
function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  
  let trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i-1];
    const tr1 = cur.high - cur.low;
    const tr2 = Math.abs(cur.high - prev.close);
    const tr3 = Math.abs(cur.low - prev.close);
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }
  
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

function getMarketStructure(candles) {
  if (candles.length === 0) return { swingHigh: 0, swingLow: 0 };
  let maxHigh = candles[0].high;
  let minLow = candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > maxHigh) maxHigh = candles[i].high;
    if (candles[i].low < minLow) minLow = candles[i].low;
  }
  return { swingHigh: maxHigh, swingLow: minLow };
}

function dedupeLevels(levels = [], minGapPct = 0.14) {
  const sorted = [...levels]
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  const output = [];
  for (const level of sorted) {
    if (output.length === 0) {
      output.push(level);
      continue;
    }
    const prev = output[output.length - 1];
    const gapPct = prev > 0 ? (Math.abs(level - prev) / prev) * 100 : 0;
    if (gapPct >= minGapPct) output.push(level);
  }
  return output;
}

function getLocalKeyLevels(candles, pivotRadius = 2, lookback = 80) {
  if (!Array.isArray(candles) || candles.length < (pivotRadius * 2 + 3)) {
    return { localResistances: [], localSupports: [] };
  }

  const series = candles.slice(-Math.max(lookback, 24));
  const resistanceCandidates = [];
  const supportCandidates = [];

  for (let i = pivotRadius; i < series.length - pivotRadius; i++) {
    const c = series[i];
    let isPivotHigh = true;
    let isPivotLow = true;

    for (let j = 1; j <= pivotRadius; j++) {
      if (!(c.high > series[i - j].high && c.high >= series[i + j].high)) isPivotHigh = false;
      if (!(c.low < series[i - j].low && c.low <= series[i + j].low)) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }

    if (isPivotHigh) resistanceCandidates.push(c.high);
    if (isPivotLow) supportCandidates.push(c.low);
  }

  // Add recent extremes so near-term scalp levels are always represented.
  const recent = series.slice(-14);
  for (const c of recent) {
    resistanceCandidates.push(c.high);
    supportCandidates.push(c.low);
  }

  const localResistances = dedupeLevels(resistanceCandidates, 0.12).slice(-10);
  const localSupports = dedupeLevels(supportCandidates, 0.12).slice(0, 10);

  return { localResistances, localSupports };
}

function detectPatterns(candles) {
  const patterns = [];

  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const prev  = candles[i - 1];
    const cur   = candles[i];

    const [po2, ph2, pl2, pc2] = [prev2.open, prev2.high, prev2.low, prev2.close];
    const [po,  ph,  pl,  pc ] = [prev.open,  prev.high,  prev.low,  prev.close];
    const [co,  ch,  cl,  cc ] = [cur.open,   cur.high,   cur.low,   cur.close];

    const body   = bodySize(co, cc);
    const rng    = range(ch, cl);
    const uWick  = upperWick(co, cc, ch);
    const lWick  = lowerWick(co, cc, cl);
    const pBody  = bodySize(po, pc);
    const pRng   = range(ph, pl);

    // ── Doji (indecision) ──
    if (rng > 0 && body / rng < 0.1) {
      patterns.push({
        name: 'Doji',
        type: 'neutral',
        description: 'Market indecision — wait for confirmation before entering.',
        candle: i
      });
    }

    // ── Hammer (bullish reversal at bottom) ──
    if (lWick > body * 2 && uWick < body * 0.5 && isBull(co, cc)) {
      patterns.push({
        name: 'Hammer',
        type: 'bullish',
        description: 'Buyers rejected lower prices strongly — potential reversal to the upside.',
        candle: i
      });
    }

    // ── Hanging Man (bearish reversal at top) ──
    if (lWick > body * 2 && uWick < body * 0.5 && isBear(co, cc)) {
      patterns.push({
        name: 'Hanging Man',
        type: 'bearish',
        description: 'Same shape as Hammer but in an uptrend — potential reversal to the downside.',
        candle: i
      });
    }

    // ── Shooting Star (bearish) ──
    if (uWick > body * 2 && lWick < body * 0.5 && isBear(co, cc)) {
      patterns.push({
        name: 'Shooting Star',
        type: 'bearish',
        description: 'Sellers rejected higher prices — bearish rejection from a key level.',
        candle: i
      });
    }

    // ── Inverted Hammer (bullish) ──
    if (uWick > body * 2 && lWick < body * 0.5 && isBull(co, cc)) {
      patterns.push({
        name: 'Inverted Hammer',
        type: 'bullish',
        description: 'Buyers pushing for higher prices after a downtrend — potential bullish reversal.',
        candle: i
      });
    }

    // ── Bullish Engulfing ──
    if (isBear(po, pc) && isBull(co, cc) && co < pc && cc > po) {
      patterns.push({
        name: 'Bullish Engulfing',
        type: 'bullish',
        description: 'Strong bullish candle completely engulfs prior bearish candle — high-conviction long setup.',
        candle: i
      });
    }

    // ── Bearish Engulfing ──
    if (isBull(po, pc) && isBear(co, cc) && co > pc && cc < po) {
      patterns.push({
        name: 'Bearish Engulfing',
        type: 'bearish',
        description: 'Strong bearish candle completely engulfs prior bullish candle — high-conviction short setup.',
        candle: i
      });
    }

    // ── Bullish Harami ──
    if (isBear(po, pc) && isBull(co, cc) && co > pc && cc < po && body < pBody * 0.6) {
      patterns.push({
        name: 'Bullish Harami',
        type: 'bullish',
        description: 'Small bullish candle inside a large bearish candle — sellers losing momentum.',
        candle: i
      });
    }

    // ── Bearish Harami ──
    if (isBull(po, pc) && isBear(co, cc) && co < pc && cc > po && body < pBody * 0.6) {
      patterns.push({
        name: 'Bearish Harami',
        type: 'bearish',
        description: 'Small bearish candle inside a large bullish candle — buyers losing momentum.',
        candle: i
      });
    }

    // ── Morning Star (bullish 3-candle) ──
    if (
      isBear(po2, pc2) && bodySize(po2, pc2) > pRng * 0.5 &&
      bodySize(po, pc) < pBody * 0.3 &&
      isBull(co, cc) && cc > (po2 + pc2) / 2
    ) {
      patterns.push({
        name: 'Morning Star',
        type: 'bullish',
        description: '3-candle bullish reversal: strong bear → indecision → strong bull. Institutional grade entry signal.',
        candle: i
      });
    }

    // ── Evening Star (bearish 3-candle) ──
    if (
      isBull(po2, pc2) && bodySize(po2, pc2) > pRng * 0.5 &&
      bodySize(po, pc) < pBody * 0.3 &&
      isBear(co, cc) && cc < (po2 + pc2) / 2
    ) {
      patterns.push({
        name: 'Evening Star',
        type: 'bearish',
        description: '3-candle bearish reversal: strong bull → indecision → strong bear. Institutional grade short signal.',
        candle: i
      });
    }

    // ── Three White Soldiers (bullish) ──
    if (
      i >= 3 &&
      isBull(candles[i-2].open, candles[i-2].close) &&
      isBull(po, pc) &&
      isBull(co, cc) &&
      pc > candles[i-2].close &&
      cc > pc
    ) {
      patterns.push({
        name: 'Three White Soldiers',
        type: 'bullish',
        description: 'Three consecutive strong bullish candles — sustained buying pressure, strong trend continuation.',
        candle: i
      });
    }

    // ── Three Black Crows (bearish) ──
    if (
      i >= 3 &&
      isBear(candles[i-2].open, candles[i-2].close) &&
      isBear(po, pc) &&
      isBear(co, cc) &&
      pc < candles[i-2].close &&
      cc < pc
    ) {
      patterns.push({
        name: 'Three Black Crows',
        type: 'bearish',
        description: 'Three consecutive strong bearish candles — sustained selling pressure, strong trend continuation.',
        candle: i
      });
    }

    // ── Pin Bar (strong rejection) ──
    const tailPct = Math.max(uWick, lWick) / (rng || 1);
    if (tailPct > 0.65 && body < rng * 0.25) {
      const dir = uWick > lWick ? 'bearish' : 'bullish';
      patterns.push({
        name: `Pin Bar (${dir === 'bullish' ? 'Bullish' : 'Bearish'})`,
        type: dir,
        description: `Strong ${dir === 'bullish' ? 'support' : 'resistance'} rejection — price swept a level and snapped back hard.`,
        candle: i
      });
    }
  }

  // Return only the 3 most recent patterns (last candles are most relevant)
  return patterns.slice(-5).reverse();
}

// ── Main Handler ──────────────────────────────────────────────

const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d']);
const BINANCE_KLINE_ENDPOINTS = [
  'https://api.binance.com/api/v3/klines',
  'https://api1.binance.com/api/v3/klines',
  'https://api2.binance.com/api/v3/klines',
  'https://api3.binance.com/api/v3/klines',
  'https://data-api.binance.vision/api/v3/klines'
];

function sanitizeSymbol(raw = 'BTCUSDT') {
  const cleaned = String(raw || 'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return 'BTCUSDT';
  return cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
}

async function fetchKlinesWithEndpointFallback(symbol, interval, limit = 100) {
  let lastError = null;
  let lastStatus = null;

  for (const endpoint of BINANCE_KLINE_ENDPOINTS) {
    const url = `${endpoint}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' }
      });
      if (!response.ok) {
        lastStatus = response.status;
        lastError = new Error(`${new URL(endpoint).hostname} HTTP ${response.status}`);
        continue;
      }
      const raw = await response.json();
      if (!Array.isArray(raw) || raw.length === 0) {
        lastError = new Error(`${new URL(endpoint).hostname} returned empty candles`);
        continue;
      }
      return {
        ok: true,
        raw,
        endpoint
      };
    } catch (err) {
      lastError = err;
    }
  }

  return {
    ok: false,
    status: lastStatus,
    error: lastError || new Error('No Binance candle endpoint returned data')
  };
}

function parseCandleResult(raw, symbol, interval, source = 'fresh') {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      source,
      symbol,
      interval,
      candleCount: 0,
      currentPrice: null,
      atr: null,
      swingHigh: null,
      swingLow: null,
      localResistances: [],
      localSupports: [],
      patterns: [],
      summary: 'No candlestick data available.'
    };
  }

  // Binance kline format: [openTime, open, high, low, close, volume, ...]
  const candles = raw.map(k => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));

  const patterns = detectPatterns(candles);
  const atr = calculateATR(candles, 14);
  const structure = getMarketStructure(candles);
  const localLevels = getLocalKeyLevels(candles);
  const lastClose = candles[candles.length - 1]?.close;
  const currentPrice = Number.isFinite(lastClose) ? lastClose : null;

  return {
    source,
    symbol,
    interval,
    candleCount: candles.length,
    currentPrice,
    atr,
    swingHigh: structure.swingHigh,
    swingLow: structure.swingLow,
    localResistances: localLevels.localResistances,
    localSupports: localLevels.localSupports,
    patterns,
    summary: patterns.length > 0
      ? patterns.map(p => `${p.name} (${p.type}): ${p.description}`).join(' | ')
      : 'No significant candlestick pattern detected on this timeframe.'
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const requestedSymbol = sanitizeSymbol(req.query.symbol || 'BTCUSDT');
  const interval = ALLOWED_INTERVALS.has(req.query.interval) ? req.query.interval : '4h';
  const cacheKey = `candles_${requestedSymbol}_${interval}`;
  const now = Date.now();
  const localCached = cache[cacheKey];
  let staleGlobalCache = null;

  try {
    // 1) Fast local cache for warm paths
    if (localCached && (now - localCached.timestamp) < CACHE_TTL) {
      return res.status(200).json({ source: 'memory_cache', ...localCached.data });
    }

    // 2) Optional Supabase global cache (if configured)
    const supabaseClient = getSupabaseClient();
    if (supabaseClient) {
      try {
        const { data: cachedData } = await supabaseClient
          .from('global_market_cache')
          .select('data, updated_at')
          .eq('id', cacheKey)
          .single();

        if (cachedData?.data && cachedData?.updated_at) {
          const age = now - new Date(cachedData.updated_at).getTime();
          if (age >= 0) {
            staleGlobalCache = {
              ageMs: age,
              data: cachedData.data
            };
          }
        }
      } catch (cacheErr) {
        console.warn('⚠️ Candle cache read skipped:', cacheErr.message);
      }
    }

    // 3) Fetch requested symbol from Binance
    let activeSymbol = requestedSymbol;
    let klinesResult = await fetchKlinesWithEndpointFallback(activeSymbol, interval, 100);

    // If requested symbol is invalid/unavailable, gracefully fallback to BTCUSDT.
    if (!klinesResult.ok && activeSymbol !== 'BTCUSDT') {
      const fallbackResult = await fetchKlinesWithEndpointFallback('BTCUSDT', interval, 100);
      if (fallbackResult.ok) {
        klinesResult = fallbackResult;
        activeSymbol = 'BTCUSDT';
      }
    }

    if (!klinesResult.ok) {
      // As last resort, serve stale cache tiers before returning a non-fatal empty payload.
      if (localCached?.data) {
        return res.status(200).json({
          source: 'stale_memory',
          warning: `Live fetch failed: ${klinesResult.error?.message || `Binance HTTP ${klinesResult.status || 'unknown'}`}`,
          ...localCached.data
        });
      }
      if (staleGlobalCache?.data && staleGlobalCache.ageMs <= 30 * 60 * 1000) {
        return res.status(200).json({
          source: 'stale_global_cache',
          warning: `Live fetch failed: ${klinesResult.error?.message || `Binance HTTP ${klinesResult.status || 'unknown'}`}`,
          staleAgeSec: Math.max(1, Math.round(staleGlobalCache.ageMs / 1000)),
          ...staleGlobalCache.data
        });
      }
      return res.status(200).json({
        source: 'fallback_empty',
        symbol: activeSymbol,
        interval,
        candleCount: 0,
        currentPrice: null,
        atr: null,
        swingHigh: null,
        swingLow: null,
        localResistances: [],
        localSupports: [],
        patterns: [],
        summary: 'Candle feed temporarily unavailable.'
      });
    }

    const raw = klinesResult.raw;
    const result = parseCandleResult(raw, activeSymbol, interval, activeSymbol === requestedSymbol ? 'fresh' : 'fallback_symbol');
    result.exchangeEndpoint = (() => {
      try {
        return new URL(klinesResult.endpoint).hostname;
      } catch {
        return null;
      }
    })();
    if (activeSymbol !== requestedSymbol) {
      result.requestedSymbol = requestedSymbol;
      result.note = `Requested symbol unavailable on Binance; using ${activeSymbol} context.`;
    }

    // Update local cache
    cache[cacheKey] = { timestamp: now, data: result };

    // Best-effort global cache write
    if (supabaseClient) {
      try {
        await supabaseClient.from('global_market_cache').upsert({
          id: cacheKey,
          data: result,
          updated_at: new Date().toISOString()
        });
      } catch (writeErr) {
        console.warn('⚠️ Candle cache write skipped:', writeErr.message);
      }
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('❌ Global Candle API Error:', err.message);
    if (localCached?.data) {
      return res.status(200).json({
        source: 'stale_memory',
        warning: err.message,
        ...localCached.data
      });
    }
    return res.status(200).json({
      source: 'fallback_empty',
      symbol: requestedSymbol,
      interval,
      candleCount: 0,
      currentPrice: null,
      atr: null,
      swingHigh: null,
      swingLow: null,
      localResistances: [],
      localSupports: [],
      patterns: [],
      summary: 'Candle feed temporarily unavailable.'
    });
  }
}
