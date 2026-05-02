// ═══════════════════════════════════════════════════════════════
// NEXUS Server-Side Market Data — Single Source of Truth
// ═══════════════════════════════════════════════════════════════
// This Vercel serverless function fetches CoinGecko data ONCE,
// computes deterministic Alpha Scores, and caches the result
// for 5 minutes. Every device reads from this single endpoint,
// guaranteeing 100% identical data across all clients.

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const COINGECKO_KEY = 'CG-7gTv8kk2qS7r8kj515m2rVQJ';
const COINS = [
  'bitcoin', 'ethereum', 'solana', 'injective-protocol',
  'ondo-finance', 'avalanche-2', 'arbitrum'
];

function computeAlphaScore(coin) {
  const change24h = coin.price_change_percentage_24h || 0;
  const volRatio = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) : 0;
  const mcapRank = coin.market_cap_rank || 50;
  
  const momentumRaw = Math.min(35, Math.max(0, 17.5 + (change24h * 2.5)));
  const volConviction = Math.min(25, volRatio * 250);
  const mcapTier = Math.min(20, Math.max(5, 20 - (mcapRank * 0.3)));
  const absChange = Math.abs(change24h);
  const stability = absChange < 1 ? 10 : (absChange < 5 ? 18 : (absChange < 10 ? 15 : 8));
  
  return Math.round(Math.min(100, Math.max(0, momentumRaw + volConviction + mcapTier + stability)));
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
      + `?vs_currency=usd&ids=${COINS.join(',')}`
      + `&x_cg_demo_api_key=${COINGECKO_KEY}&sparkline=false`;

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
    const coins = await response.json();

    // Compute scores server-side (deterministic, same for every client)
    const assets = coins.map(coin => {
      const symbol = coin.symbol.toUpperCase();
      const alpha = computeAlphaScore(coin);
      const change = coin.price_change_percentage_24h || 0;
      
      return {
        symbol,
        name: coin.name,
        price: coin.current_price,
        change,
        score: alpha,
        bias: alpha > 75 ? 'bullish' : (alpha < 50 ? 'bearish' : 'neutral'),
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
