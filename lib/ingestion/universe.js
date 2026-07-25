// ═══════════════════════════════════════════════════════
// Universe Selection — Dynamic Asset Filtering
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { cachedFetch } from './cache.js';

const MIN_VOL_USD = 10_000_000;
const MIN_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 12 months

async function fetchBinanceUniverse() {
  console.log('[universe] Building dynamic symbol universe from Binance...');
  
  // 0. Dynamically fetch stablecoins from CoinGecko to harden exclusions
  const cgStables = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=stablecoins');
  const stablecoinSet = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDD', 'BUSD', 'USDP', 'PYUSD']);
  if (cgStables && Array.isArray(cgStables)) {
    cgStables.forEach(c => stablecoinSet.add(c.symbol.toUpperCase()));
  }

  // 1. Fetch 24h ticker data for volume + price filtering
  const tickers = await fetchJson('https://api.binance.com/api/v3/ticker/24hr');
  if (!tickers) return [];

  // 2. Fetch exchange info to ensure trading is active
  const info = await fetchJson('https://api.binance.com/api/v3/exchangeInfo');
  if (!info) return [];
  const validSymbols = new Set(
    info.symbols.filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT').map(s => s.symbol)
  );

  let candidates = [];
  
  // 3. Filter raw tickers
  for (const t of tickers) {
    if (!t.symbol.endsWith('USDT') || !validSymbols.has(t.symbol)) continue;
    
    const base = t.symbol.replace('USDT', '');
    
    // Stablecoin/fiat/synthetic filter (catch things like USD1, EUR, etc)
    if (stablecoinSet.has(base) || /^(USD|EUR|GBP|JPY|AUD|CAD|CHF|CNY|TRY|BRL|RUB)[0-9]*$/.test(base)) continue;
    
    // Leveraged token filter (UP/DOWN, BULL/BEAR)
    if (/UP$|DOWN$|BULL$|BEAR$|HALF$/.test(base)) continue;

    // Volume filter
    const quoteVol = parseFloat(t.quoteVolume);
    if (quoteVol < MIN_VOL_USD) continue;

    candidates.push({ base, symbol: t.symbol, vol: quoteVol });
  }

  // Sort by volume descending and take the top 50 to test for age
  candidates.sort((a, b) => b.vol - a.vol);
  candidates = candidates.slice(0, 50);

  const finalUniverse = [];
  const now = Date.now();

  // 4. Check listing age sequentially with delay to respect rate limits
  for (const c of candidates) {
    if (finalUniverse.length >= 25) break;

    const kline = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${c.symbol}&interval=1M&limit=1&startTime=0`);
    if (!kline || kline.length === 0) {
      await new Promise(r => setTimeout(r, 200)); // Sleep on fail
      continue;
    }

    const firstCandleTime = kline[0][0];
    const age = now - firstCandleTime;

    if (age >= MIN_AGE_MS) {
      finalUniverse.push(c.base);
    }
    
    // Small delay to prevent Binance IP ban/truncation
    await new Promise(r => setTimeout(r, 100)); 
  }

  console.log(`[universe] Selected ${finalUniverse.length} assets for universe:`, finalUniverse.join(', '));
  return finalUniverse;
}

export async function getUniverse() {
  // Cache the universe list for 24 hours (86,400,000 ms)
  const symbols = await cachedFetch('dynamic_universe', fetchBinanceUniverse, 86_400_000);
  return symbols && symbols.length > 0 ? symbols : ['BTC', 'ETH', 'SOL']; // Fallback
}
