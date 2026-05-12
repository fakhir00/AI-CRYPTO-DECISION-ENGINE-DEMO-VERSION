// ═══════════════════════════════════════════════════════════════
// NEXUS Server-Side Market Data — Single Source of Truth
// ═══════════════════════════════════════════════════════════════
// This Vercel serverless function fetches CoinGecko data ONCE,
// computes deterministic Alpha Scores, and caches the result
// for 5 minutes. Every device reads from this single endpoint,
// guaranteeing 100% identical data across all clients.

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 15 * 1000; // 15 seconds (High-Precision Snapshot)

const COINGECKO_KEY = 'CG-7gTv8kk2qS7r8kj515m2rVQJ';
const MIN_MARKET_CAP_USD = 100_000_000;
const CG_PER_PAGE = 250;
const MAX_CG_PAGES = 5;
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

function computeAlphaScore(coin) {
  const change24h = Number(coin.price_change_percentage_24h) || 0;
  const volRatio = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) : 0;
  const mcapRank = Number(coin.market_cap_rank) || 50;
  const absChange = Math.abs(change24h);

  // Direction-neutral conversion score:
  // strong bearish and bullish trends can both rank highly.
  const moveQuality = absChange < 0.5
    ? 8 + (absChange * 6)
    : absChange < 2
      ? 11 + ((absChange - 0.5) * 8)
      : absChange < 8
        ? 23 + ((absChange - 2) * 3.2)
        : absChange < 15
          ? 42 - ((absChange - 8) * 1.7)
          : 30 - Math.min(14, (absChange - 15) * 1.5);

  const volumeConviction = Math.min(24, Math.max(0, volRatio * 240));
  const mcapTier = Math.min(16, Math.max(5, 16 - (mcapRank * 0.2)));
  const stability = absChange < 1 ? 6 : absChange < 4 ? 12 : absChange < 10 ? 16 : absChange < 18 ? 11 : 7;
  const overextensionPenalty = absChange > 18 ? Math.min(10, (absChange - 18) * 0.9) : 0;

  return Math.round(Math.min(100, Math.max(0, moveQuality + volumeConviction + mcapTier + stability - overextensionPenalty)));
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

async function fetchCoinGeckoUniverse() {
  const coins = [];

  for (let page = 1; page <= MAX_CG_PAGES; page++) {
    const url = `https://api.coingecko.com/api/v3/coins/markets`
      + `?vs_currency=usd&order=market_cap_desc&per_page=${CG_PER_PAGE}&page=${page}`
      + `&x_cg_demo_api_key=${COINGECKO_KEY}&sparkline=false`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      if (page === 1) throw new Error(`CoinGecko HTTP ${res.status}`);
      break;
    }

    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;

    coins.push(...batch);

    const lastMarketCap = Number(batch[batch.length - 1]?.market_cap) || 0;
    if (batch.length < CG_PER_PAGE || lastMarketCap < MIN_MARKET_CAP_USD) break;
  }

  return coins;
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
    const [cgCoins, binanceBtcRes, binance24hRes] = await Promise.all([
      fetchCoinGeckoUniverse(),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
      fetch('https://api.binance.com/api/v3/ticker/24hr')
    ]);
    
    let binanceBtcPrice = null;
    if (binanceBtcRes.ok) {
      const bData = await binanceBtcRes.json();
      binanceBtcPrice = parseFloat(bData.price);
    }

    const binance24h = binance24hRes.ok ? await binance24hRes.json() : [];
    const bySymbol = new Map();

    // Universe A: all non-stable CoinGecko coins with market cap >= $100M.
    cgCoins
      .filter(coin => Number(coin.market_cap) >= MIN_MARKET_CAP_USD)
      .filter(coin => !isStablecoinLike(coin.symbol, coin.name, coin.current_price))
      .forEach(coin => {
        const symbol = String(coin.symbol || '').toUpperCase();
        if (!symbol) return;

        let price = Number(coin.current_price) || 0;
        if (symbol === 'BTC' && binanceBtcPrice) price = binanceBtcPrice;

        const change = Number(coin.price_change_percentage_24h) || 0;
        const alpha = computeAlphaScore(coin);
        bySymbol.set(symbol, {
          symbol,
          name: coin.name,
          price,
          change,
          score: alpha,
          bias: change >= 1 ? 'bullish' : (change <= -1 ? 'bearish' : 'neutral'),
          confidence: Math.min(99, alpha),
          vol: '$' + ((Number(coin.total_volume) || 0) / 1e9).toFixed(1) + 'B',
          market_cap_rank: coin.market_cap_rank,
          market_cap: coin.market_cap,
          total_volume: coin.total_volume
        });
      });

    // Universe B: Binance top-100 USDT pairs by quote volume.
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
      const existing = bySymbol.get(t.base);
      if (existing) {
        existing.price = t.lastPrice || existing.price;
        existing.change = Number.isFinite(t.changePct) ? t.changePct : existing.change;
        existing.total_volume = t.quoteVolume || existing.total_volume;
        existing.vol = '$' + ((Number(existing.total_volume) || 0) / 1e9).toFixed(1) + 'B';
        existing.bias = existing.change >= 1 ? 'bullish' : (existing.change <= -1 ? 'bearish' : 'neutral');
        return;
      }

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
        market_cap_rank: null,
        market_cap: null,
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
        minMarketCapUsd: MIN_MARKET_CAP_USD,
        coinGeckoQualified: assets.filter(a => Number(a.market_cap) >= MIN_MARKET_CAP_USD).length,
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
