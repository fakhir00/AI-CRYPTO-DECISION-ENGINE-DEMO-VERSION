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

function computeAlphaScore(coin) {
  const change24h = coin.price_change_percentage_24h || 0;
  const volRatio = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) : 0;
  const mcapRank = coin.market_cap_rank || 50;
  
  // Primary Trend Direction (50% Weight)
  const momentumRaw = Math.min(50, Math.max(0, 25 + (change24h * 4.0))); 
  
  // Volume & Tier (Supporting Context)
  const volConviction = Math.min(20, volRatio * 200);
  const mcapTier = Math.min(15, Math.max(5, 15 - (mcapRank * 0.2)));
  const absChange = Math.abs(change24h);
  const stability = absChange < 1 ? 15 : (absChange < 5 ? 10 : 5);
  
  const score = Math.round(Math.min(100, Math.max(0, momentumRaw + volConviction + mcapTier + stability)));
  return score;
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
    const STABLECOINS = ['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD', 'GUSD', 'LUSD', 'EURC', 'FRAX'];
    const assets = coins
      .filter(coin => !STABLECOINS.includes(coin.symbol.toUpperCase()))
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
        bias: alpha >= 65 ? 'bullish' : (alpha <= 45 ? 'bearish' : 'neutral'),
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
