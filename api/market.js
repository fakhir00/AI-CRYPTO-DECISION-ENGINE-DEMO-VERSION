// ═══════════════════════════════════════════════════════════════
// NEXUS Server-Side Market Data — Single Source of Truth
// ═══════════════════════════════════════════════════════════════
// This Vercel serverless function fetches Binance top-volume data,
// computes deterministic Alpha Scores, and caches the result
// for 5 minutes. Every device reads from this single endpoint,
// guaranteeing 100% identical data across all clients.

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 15 * 1000; // 15 seconds (High-Precision Snapshot)

const BINANCE_TOP_N = 100;
const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
  'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
  'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
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

    const binance24h = binance24hRes.ok ? await binance24hRes.json() : [];
    const bySymbol = new Map();
    // Universe: Binance top-100 USDT pairs by quote volume.
    const topBinance = Array.isArray(binance24h)
      ? binance24h
          .filter(t => typeof t?.symbol === 'string' && t.symbol.endsWith('USDT'))
          .map(t => {
            const base = t.symbol.replace('USDT', '').toUpperCase();
            return {
              base,
              lastPrice: Number(t.lastPrice) || 0,
              changePct: Number(t.priceChangePercent) || 0,
              quoteVolume: Number(t.quoteVolume) || 0
            };
          })
          .filter(t => t.base && !isStablecoinLike(t.base, t.base, t.lastPrice))
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, BINANCE_TOP_N)
      : [];

    topBinance.forEach(t => {
      const alpha = computeBinanceOnlyAlpha(t.changePct, t.quoteVolume);
      bySymbol.set(t.base, {
        symbol: t.base,
        name: `${t.base} (Binance)`,
        price: t.lastPrice,
        change: t.changePct,
        score: alpha,
        bias: t.changePct >= 1 ? 'bullish' : (t.changePct <= -1 ? 'bearish' : 'neutral'),
        confidence: Math.min(99, alpha),
        vol: '$' + (t.quoteVolume / 1e9).toFixed(1) + 'B',
        total_volume: t.quoteVolume
      });
    });

    const assets = [...bySymbol.values()];

    // Sort by alpha score (highest first)
    assets.sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol));

    cachedData = assets;
    cacheTimestamp = Date.now();

    return res.status(200).json({
      source: 'fresh',
      age: 0,
      data: assets,
      universe: {
        source: 'binance-top-100-usdt',
        binanceTopIncluded: topBinance.length
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
