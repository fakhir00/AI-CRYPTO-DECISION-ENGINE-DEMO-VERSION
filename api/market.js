// ═══════════════════════════════════════════════════════════════
// NEXUS Server-Side Market Data — Single Source of Truth
// ═══════════════════════════════════════════════════════════════
// This Vercel serverless function fetches Binance data ONCE,
// computes deterministic Alpha Scores, and caches the result
// for 5 minutes. Every device reads from this single endpoint,
// guaranteeing 100% identical data across all clients.

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 15 * 1000; // 15 seconds (High-Precision Snapshot)

const BINANCE_TOP_N = 50;
const MIN_QUOTE_VOLUME_USD = 20_000_000;
const MAX_ABS_CHANGE_PCT = 20;
const MAX_INTRADAY_RANGE_PCT = 24;
const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
  'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
  'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
]);
const EXCLUDED_HIGH_RISK_SYMBOLS = new Set([
  'DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'MEME', 'TURBO',
  'MOG', 'POPCAT', 'PENGU', 'NEIRO', 'BRETT', 'TRUMP'
]);

function isStablecoinLike(symbol = '', name = '', price = null) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return false;
  if (STABLECOINS.has(sym)) return true;
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

function isUnpredictableOrSham(ticker = {}) {
  const base = String(ticker.base || '').toUpperCase();
  if (!base) return true;
  if (EXCLUDED_HIGH_RISK_SYMBOLS.has(base)) return true;
  if (/^(1000|1000000)/.test(base)) return true;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return true;

  const quoteVolume = Number(ticker.quoteVolume) || 0;
  const absChange = Math.abs(Number(ticker.changePct) || 0);
  const openPrice = Number(ticker.openPrice) || 0;
  const highPrice = Number(ticker.highPrice) || 0;
  const lowPrice = Number(ticker.lowPrice) || 0;
  const rangePct = openPrice > 0 ? ((highPrice - lowPrice) / openPrice) * 100 : absChange;

  if (quoteVolume < MIN_QUOTE_VOLUME_USD) return true;
  if (absChange > MAX_ABS_CHANGE_PCT) return true;
  if (rangePct > MAX_INTRADAY_RANGE_PCT) return true;
  return false;
}

function computeBinanceOnlyAlpha(changePct = 0, quoteVolumeUsd = 0) {
  const absChange = Math.abs(Number(changePct) || 0);
  const vol = Math.max(0, Number(quoteVolumeUsd) || 0);

  const moveComponent = absChange < 0.5
    ? 10 + (absChange * 5)
    : absChange < 2
      ? 12 + ((absChange - 0.5) * 8)
      : absChange < 8
        ? 24 + ((absChange - 2) * 3.1)
        : absChange < 15
          ? 42 - ((absChange - 8) * 1.7)
          : 29 - Math.min(14, (absChange - 15) * 1.5);

  const volumeComponent = Math.min(26, Math.max(0, (Math.log10(vol + 1) - 6) * 8));
  const overextensionPenalty = absChange > 18 ? Math.min(10, (absChange - 18) * 0.9) : 0;

  return Math.round(Math.min(100, Math.max(0, moveComponent + volumeComponent + 26 - overextensionPenalty)));
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  // Return cached data if still fresh
  if (cachedData && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return res.status(200).json({
      source: 'cache',
      age: Math.round((Date.now() - cacheTimestamp) / 1000),
      data: cachedData
    });
  }

  try {
    const binance24hRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!binance24hRes.ok) throw new Error(`Binance HTTP ${binance24hRes.status}`);
    const binance24h = await binance24hRes.json();

    // Binance top-50 USDT pairs by quote volume after quality filtering.
    const topBinance = Array.isArray(binance24h)
      ? binance24h
          .filter(t => typeof t?.symbol === 'string' && t.symbol.endsWith('USDT'))
          .map(t => {
            const base = t.symbol.replace('USDT', '').toUpperCase();
            return {
              base,
              lastPrice: Number(t.lastPrice) || 0,
              changePct: Number(t.priceChangePercent) || 0,
              quoteVolume: Number(t.quoteVolume) || 0,
              openPrice: Number(t.openPrice) || 0,
              highPrice: Number(t.highPrice) || 0,
              lowPrice: Number(t.lowPrice) || 0
            };
          })
          .filter(t => t.base && !isStablecoinLike(t.base, t.base, t.lastPrice))
          .filter(t => !isUnpredictableOrSham(t))
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, BINANCE_TOP_N)
      : [];

    const assets = topBinance.map((t, idx) => {
      const alpha = computeBinanceOnlyAlpha(t.changePct, t.quoteVolume);
      return {
        symbol: t.base,
        name: t.base,
        price: t.lastPrice,
        change: t.changePct,
        score: alpha,
        bias: t.changePct >= 1 ? 'bullish' : (t.changePct <= -1 ? 'bearish' : 'neutral'),
        confidence: Math.min(99, alpha),
        vol: '$' + (t.quoteVolume / 1e9).toFixed(1) + 'B',
        market_cap_rank: idx + 1,
        market_cap: 0,
        total_volume: t.quoteVolume
      };
    });

    // Sort by alpha score (highest first)
    assets.sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol));

    cachedData = assets;
    cacheTimestamp = Date.now();

    return res.status(200).json({
      source: 'fresh',
      age: 0,
      data: assets,
      universe: {
        binanceTopIncluded: topBinance.length,
        qualityFilters: {
          minQuoteVolumeUsd: MIN_QUOTE_VOLUME_USD,
          maxAbsChangePct: MAX_ABS_CHANGE_PCT,
          maxIntradayRangePct: MAX_INTRADAY_RANGE_PCT
        }
      }
    });
  } catch (error) {
    console.error('Market API Error:', error.message);
    
    // Return stale cache if available
    if (cachedData) {
      return res.status(200).json({
        source: 'stale-cache',
        age: Math.round((Date.now() - cacheTimestamp) / 1000),
        data: cachedData
      });
    }
    
    return res.status(500).json({ error: 'Failed to fetch market data' });
  }
}
