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
    const url = `https://api.coingecko.com/api/v3/coins/markets`
      + `?vs_currency=usd&order=market_cap_desc&per_page=50&page=1`
      + `&x_cg_demo_api_key=${COINGECKO_KEY}&sparkline=false`;

    const [cgRes, binanceRes] = await Promise.all([
      fetch(url, { cache: 'no-store' }),
      fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    ]);

    if (!cgRes.ok) throw new Error(`CoinGecko HTTP ${cgRes.status}`);
    const coins = await cgRes.json();
    
    let binanceBtcPrice = null;
    if (binanceRes.ok) {
      const bData = await binanceRes.json();
      binanceBtcPrice = parseFloat(bData.price);
    }

    // Compute scores server-side (deterministic, same for every client)
    const assets = coins
      .filter(coin => !isStablecoinLike(coin.symbol, coin.name, coin.current_price))
      .map(coin => {
      const symbol = coin.symbol.toUpperCase();
      let price = coin.current_price;

      // Overwrite BTC with real-time Binance price for absolute accuracy
      if (symbol === 'BTC' && binanceBtcPrice) {
        price = binanceBtcPrice;
      }
      const alpha = computeAlphaScore(coin);
      const change = coin.price_change_percentage_24h || 0;
      
      return {
        symbol,
        name: coin.name,
        price,
        change,
        score: alpha,
        bias: change >= 1 ? 'bullish' : (change <= -1 ? 'bearish' : 'neutral'),
        confidence: Math.min(99, alpha),
        vol: '$' + (coin.total_volume / 1e9).toFixed(1) + 'B',
        market_cap_rank: coin.market_cap_rank,
        market_cap: coin.market_cap,
        total_volume: coin.total_volume
      };
    });

    // Sort by alpha score (highest first)
    assets.sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol));

    cachedData = assets;
    cacheTimestamp = Date.now();

    return res.status(200).json({
      source: 'fresh',
      age: 0,
      data: assets
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
