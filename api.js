// ====================================================
// NEXUS API Engine — All external data integrations
// ====================================================

import { createManagedSignal, formatManagedSignalText, normalizeSignalStopReason } from './lib/signal-lifecycle.js';
import { SIGNAL_HARD_REJECTS } from './lib/momentum-strategy.js';

const KEYS = {
  coingecko: import.meta.env?.VITE_COINGECKO_API_KEY || 'CG-7gTv8kk2qS7r8kj515m2rVQJ',
  cmc: import.meta.env?.VITE_CMC_API_KEY || 'e7080786d0f14b3abfc6c58de5f61adc',
  etherscan: import.meta.env?.VITE_ETHERSCAN_API_KEY || 'CRSWB6SIH2SAAPCPFGBK2NN473EC5JIS9M',
  taapi: import.meta.env?.VITE_TAAPI_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbHVlIjoiNjlmNWJjMTVlZTAzMzMxMWE0ZjJjOGRiIiwiaWF0IjoxNzc3NzEyMTQ5LCJleHAiOjMzMjgyMTc2MTQ5fQ.8Htit-r6kGZC5LZn7_EZLozYC7yOyCu4Z1WzhuPIH34',
  lunarcrush: import.meta.env?.VITE_LUNARCRUSH_KEY || '8a0hxklrnp6i5kfiowg77edxjemoobmyiw0g62whp',
  openai: import.meta.env?.VITE_OPENAI_API_KEY
};

const API_HEALTH = {};

function setApiHealth(name, status = 'unknown', detail = '') {
  API_HEALTH[name] = {
    status,
    detail,
    checkedAt: new Date().toISOString()
  };
}

function markApiOk(name, detail = 'Live data received') {
  setApiHealth(name, 'ok', detail);
}

function markApiDegraded(name, detail = 'Fallback data in use') {
  setApiHealth(name, 'degraded', detail);
}

function markApiFailed(name, detail = 'No data') {
  setApiHealth(name, 'failed', detail);
}

export function getApiHealthSnapshot() {
  return JSON.parse(JSON.stringify(API_HEALTH));
}

export function getApiHealthSummary() {
  const rows = Object.entries(API_HEALTH).map(([name, info]) => ({ name, ...info }));
  const ok = rows.filter(r => r.status === 'ok').length;
  const degraded = rows.filter(r => r.status === 'degraded').length;
  const failed = rows.filter(r => r.status === 'failed').length;
  return {
    total: rows.length,
    ok,
    degraded,
    failed,
    services: rows
  };
}

export function getApiHealthPromptSummary() {
  const rows = Object.entries(API_HEALTH).map(([name, info]) => `${name}: ${info.status}${info.detail ? ` (${info.detail})` : ''}`);
  return rows.length > 0 ? rows.join(' | ') : 'No API health checks have run yet.';
}

export async function fetchRuntimeApiHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`Health API HTTP ${res.status}`);
    const payload = await res.json();
    markApiOk('NEXUS Runtime Health', `${payload?.summary?.ok || 0}/${payload?.summary?.checked || 0} checks ok`);
    return payload;
  } catch (error) {
    markApiDegraded('NEXUS Runtime Health', error.message);
    return null;
  }
}

// ─── 0. AI Conversation Memory Buffer ────────────────────────────────────────
// Maintains a rolling history of the last 10 user+assistant message pairs.
// This gives the AI full conversational context so users don't have to repeat coin names.
const AI_MEMORY = {
  history: [],   
  maxPairs: 10,  

  async add(role, content, userId = 'anonymous') {
    this.history.push({ role, content });
    while (this.history.length > this.maxPairs * 2) {
      this.history.shift();
    }
    
    // ☁️ Sync to Supabase for cross-device consistency
    try {
      const { supabase } = await import('./lib/supabase.js');
      await supabase.from('user_profiles').upsert({
        clerk_id: userId,
        ai_memory: this.history,
        updated_at: new Date().toISOString()
      }, { onConflict: 'clerk_id' });
    } catch (e) {
      console.warn('⚠️ Memory cloud sync failed:', e.message);
    }
    
    try { localStorage.setItem('nexus_ai_memory', JSON.stringify(this.history)); } catch (e) { }
  },

  getMessages() {
    return [...this.history];
  },

  async load(userId = 'anonymous') {
    // 1. Try cloud first
    try {
      const { supabase } = await import('./lib/supabase.js');
      const { data } = await supabase.from('user_profiles').select('ai_memory').eq('clerk_id', userId).single();
      if (data?.ai_memory) {
        this.history = data.ai_memory;
        return;
      }
    } catch (e) { }

    // 2. Fallback to local
    try {
      const saved = localStorage.getItem('nexus_ai_memory');
      if (saved) this.history = JSON.parse(saved);
    } catch (e) { this.history = []; }
  }
};

// Load any persisted memory on startup
AI_MEMORY.load();

// Exported helpers for main.js
export function addToAIMemory(role, content) { AI_MEMORY.add(role, content); }
export function clearAIMemory() { AI_MEMORY.clear(); }
export function getAIMemory() { return AI_MEMORY.getMessages(); }

// ─── 1. Binance-only tradable universe (top 50 + quality filter) ─────────────
export async function fetchMarketData() {
  try {
    const BINANCE_TOP_N = 50;
    const MIN_QUOTE_VOLUME_USD = 5_000_000;
    const MIN_PRICE_USD = 0.001;
    const MAX_ABS_CHANGE_PCT = 20;
    const MAX_INTRADAY_RANGE_PCT = 24;

    // Filter out stablecoins and low-quality/high-chaos pairs.
    const STABLECOINS = new Set([
      'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
      'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
      'U', 'USDUC',
      'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
    ]);
    const isStablecoinLike = (symbol = '', name = '', price = null) => {
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
    };

    const isUnpredictableOrSham = (ticker = {}) => {
      const base = String(ticker.base || '').toUpperCase();
      if (!base) return true;
      if (base.length < 2) return true;
      if (/^(1000|1000000)/.test(base)) return true;
      if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return true;
      if (/(SCAM|FAKE|TEST)/.test(base)) return true;

      const quoteVolume = Number(ticker.quoteVolume) || 0;
      const lastPrice = Number(ticker.lastPrice) || 0;
      const absChange = Math.abs(Number(ticker.changePct) || 0);
      const openPrice = Number(ticker.openPrice) || 0;
      const highPrice = Number(ticker.highPrice) || 0;
      const lowPrice = Number(ticker.lowPrice) || 0;
      const rangePct = openPrice > 0 ? ((highPrice - lowPrice) / openPrice) * 100 : absChange;

      if (lastPrice > 0 && lastPrice < MIN_PRICE_USD) return true;
      if (quoteVolume < MIN_QUOTE_VOLUME_USD) return true;
      if (absChange > MAX_ABS_CHANGE_PCT) return true;
      if (rangePct > MAX_INTRADAY_RANGE_PCT) return true;
      return false;
    };

    const binanceRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    const binanceData = binanceRes.ok ? await binanceRes.json() : [];
    if (binanceRes.ok) {
      markApiOk('Binance 24H Markets', `${Array.isArray(binanceData) ? binanceData.length : 0} pairs`);
    } else {
      markApiDegraded('Binance 24H Markets', `HTTP ${binanceRes.status}`);
    }

    const topTradableBinance = Array.isArray(binanceData)
      ? binanceData
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

    const filteredData = topTradableBinance.map((t, idx) => {
      return {
        id: `${t.base.toLowerCase()}-binance`,
        symbol: t.base,
        name: t.base,
        current_price: t.lastPrice,
        price_change_percentage_24h: t.changePct,
        total_volume: t.quoteVolume,
        market_cap: 0,
        market_cap_rank: idx + 1
      };
    });

    console.log('✅ Binance top tradable universe fetched:', filteredData.length, 'coins');
    markApiOk('Binance Tradable Universe', `${filteredData.length} assets`);
    return filteredData;
  } catch (e) {
    console.warn('⚠️ Binance tradable universe failed:', e.message);
    markApiFailed('Binance Tradable Universe', e.message);
    return null;
  }
}

export async function fetchBinancePatterns() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!res.ok) throw new Error('Binance HTTP ' + res.status);
    const data = await res.json();

    const patterns = {};
    data.forEach(ticker => {
      const o = parseFloat(ticker.openPrice);
      const h = parseFloat(ticker.highPrice);
      const l = parseFloat(ticker.lowPrice);
      const c = parseFloat(ticker.lastPrice);
      const body = Math.abs(c - o);
      const range = h - l;
      const v = parseFloat(ticker.volume);
      const qv = parseFloat(ticker.quoteVolume);

      let pattern = 'Accumulation Zone';
      if (range > 0) {
        if (c > o && body > range * 0.7) pattern = 'Bullish Marubozu';
        else if (c < o && body > range * 0.7) pattern = 'Bearish Marubozu';
        else if (body < range * 0.2 && c > l + range * 0.6) pattern = 'Bullish Hammer';
        else if (body < range * 0.2 && c < h - range * 0.6) pattern = 'Shooting Star';
        else if (body < range * 0.1) pattern = 'Doji Indecision';
        else if (c > o && v > 10000) pattern = 'High-Volume Breakout';
        else if (c < o && v > 10000) pattern = 'Volume Distribution';
        else if (ticker.priceChangePercent > 5) pattern = 'Momentum Expansion';
        else if (ticker.priceChangePercent < -5) pattern = 'Momentum Contraction';
      }

      // Map patterns for all coins in the ticker (only USDT pairs)
      if (ticker.symbol.endsWith('USDT')) {
        let sym = ticker.symbol.replace('USDT', '');
        patterns[sym] = pattern;
      }
    });
    console.log('✅ Binance patterns calculated');
    markApiOk('Binance Patterns', `${Object.keys(patterns).length} symbols`);
    return patterns;
  } catch (e) {
    console.warn('⚠️ Binance pattern detection failed:', e.message);
    markApiFailed('Binance Patterns', e.message);
    return null;
  }
}

// ─── 2. CoinMarketCap: Global market + BTC dominance ─────────────────────────
export async function fetchGlobalMarketData() {
  const buildBinanceGlobalFallback = async (reason = 'CMC unavailable') => {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      if (!res.ok) throw new Error(`Binance fallback HTTP ${res.status}`);
      const rows = await res.json();
      const usdtRows = Array.isArray(rows) ? rows.filter(row => String(row?.symbol || '').endsWith('USDT')) : [];
      const totalVolume24h = usdtRows.reduce((sum, row) => sum + (Number(row.quoteVolume) || 0), 0);
      const btcRow = usdtRows.find(row => row.symbol === 'BTCUSDT');
      const ethRow = usdtRows.find(row => row.symbol === 'ETHUSDT');
      const btcVolume = Number(btcRow?.quoteVolume) || 0;
      const ethVolume = Number(ethRow?.quoteVolume) || 0;
      const btcDominanceProxy = totalVolume24h > 0 ? (btcVolume / totalVolume24h) * 100 : 0;
      const ethDominanceProxy = totalVolume24h > 0 ? (ethVolume / totalVolume24h) * 100 : 0;

      markApiDegraded('CMC Global Metrics', `Binance global fallback: ${reason}`);
      return {
        source: 'binance_global_fallback',
        data: {
          btc_dominance: btcDominanceProxy,
          eth_dominance: ethDominanceProxy,
          total_volume_24h: totalVolume24h,
          quote: {
            USD: {
              total_market_cap: 0,
              total_volume_24h: totalVolume24h,
              altcoin_volume_24h: Math.max(0, totalVolume24h - btcVolume - ethVolume)
            }
          }
        }
      };
    } catch (fallbackError) {
      markApiFailed('CMC Global Metrics', `${reason}; fallback failed: ${fallbackError.message}`);
      return null;
    }
  };

  try {
    const res = await fetch('/api/cmc/v1/global-metrics/quotes/latest', {
      headers: {
        'X-CMC_PRO_API_KEY': KEYS.cmc,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`CMC HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ CMC global data fetched');
    markApiOk('CMC Global Metrics');
    return data;
  } catch (e) {
    console.warn('⚠️ CoinMarketCap failed:', e.message);
    return buildBinanceGlobalFallback(e.message);
  }
}

// ─── 3. Etherscan: Whale transactions > $500k ────────────────────────────────
export async function fetchWhaleActivity() {
  try {
    // Track Wrapped ETH (WETH) instead of stablecoins for true crypto-native whale tracking
    const wethContract = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    const url = `https://api.etherscan.io/api`
      + `?module=account&action=tokentx`
      + `&contractaddress=${wethContract}`
      + `&page=1&offset=100&sort=desc`
      + `&apikey=${KEYS.etherscan}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status === '1' && Array.isArray(data.result)) {
      const parsed = data.result.map(tx => {
        const ethValue = Number(tx.value) / 1e18;
        return {
          hash: tx.hash,
          ethValue: Number.isFinite(ethValue) ? ethValue : 0,
          from: tx.from,
          to: tx.to
        };
      });

      // Prefer institutional-size transfers first, then gracefully widen if market is quiet.
      const institutional = parsed.filter(tx => tx.ethValue >= 80).slice(0, 10);
      const fallbackActive = parsed.filter(tx => tx.ethValue >= 25).slice(0, 10);
      const feed = institutional.length > 0 ? institutional : fallbackActive;

      if (feed.length > 0) {
        const approxEthUsd = 3000;
        console.log('✅ Etherscan ETH whale txs found:', feed.length);
        markApiOk('Etherscan Whale Flow', `${feed.length} live txs`);
        return feed.map(tx => ({
          hash: tx.hash,
          value: tx.ethValue * approxEthUsd,
          token: "ETH",
          from: tx.from,
          to: tx.to
        }));
      }

      // Quiet tape is not an API failure.
      markApiOk('Etherscan Whale Flow', 'No large transfers in latest batch');
      return [];
    }
    throw new Error(data.message || 'No valid Etherscan payload');
  } catch (e) {
    console.warn('⚠️ Etherscan failed, deploying institutional crypto fallback:', e.message);
    markApiDegraded('Etherscan Whale Flow', `Fallback feed: ${e.message}`);
    // Institutional Crypto-Native Fallback (BTC, ETH, SOL, INJ)
    return [
      { hash: "0x123...abc", value: 45.2, token: "BTC", from: "Unknown Whale", to: "Binance Cold Wallet" },
      { hash: "0x456...def", value: 12.8, token: "ETH", from: "Coinbase", to: "Institutional Custody" },
      { hash: "0x789...ghi", value: 8.5, token: "SOL", from: "Unknown Whale", to: "Kraken" },
      { hash: "0xabc...jkl", value: 105.0, token: "ETH", from: "Liquidator", to: "Unknown Whale" },
      { hash: "0xdef...mno", value: 3.4, token: "WBTC", from: "Unknown Whale", to: "Gemini" }
    ];
  }
}

// ─── 4. Social Sentiment: LunarCrush (Primary) & Reddit NLP (Fallback) ────────
export async function fetchSentiment() {
  try {
    // Attempt 1: Institutional-grade LunarCrush Social Data
    const lcRes = await fetch('https://lunarcrush.com/api4/public/coins/bitcoin/v1', {
      headers: { 'Authorization': `Bearer ${KEYS.lunarcrush}` }
    });

    if (lcRes.ok) {
      const lcData = await lcRes.json();
      if (!lcData.error && lcData.data) {
        // Normalize LunarCrush Galaxy Score (usually 1-100) or Social Score
        const score = lcData.data.galaxy_score || lcData.data.alt_rank_score || 75;
        console.log('✅ LunarCrush sentiment fetched:', { score });
        markApiOk('LunarCrush Sentiment', `Score ${score}`);
        return { bullish: 85, bearish: 15, score: score, source: 'LunarCrush AI' };
      }
    }
  } catch (e) {
    console.warn('⚠️ LunarCrush failed or requires plan upgrade:', e.message);
    markApiDegraded('LunarCrush Sentiment', `Switching to Reddit: ${e.message}`);
  }

  // Attempt 2: Fallback to Reddit NLP
  try {
    const res = await fetch('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=50&raw_json=1', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
    const data = await res.json();
    const titles = data.data.children.map(c => c.data.title.toLowerCase());

    let bullish = 0, bearish = 0;
    titles.forEach(t => {
      if (/buy|moon|bull|pump|rally|breakout|surge|accumulate|ath/.test(t)) bullish++;
      if (/sell|dump|bear|crash|drop|rug|correction|fear|liquidate/.test(t)) bearish++;
    });

    const total = bullish + bearish || 1;
    const score = Math.round((bullish / total) * 100);
    console.log('✅ Reddit sentiment:', { bullish, bearish, score });
    markApiOk('Reddit Sentiment', `Score ${score}`);
    return { bullish, bearish, score, source: 'Reddit NLP' };
  } catch (e) {
    console.warn('⚠️ Reddit failed:', e.message);
    // Browser CORS / rate limits are common here. Fall back to BTC momentum proxy.
    try {
      const btcRes = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      if (btcRes.ok) {
        const btc = await btcRes.json();
        const change = Number(btc.priceChangePercent) || 0;
        const score = Math.min(95, Math.max(5, Math.round(50 + (change * 3.2))));
        markApiDegraded('Reddit Sentiment', `Fallback to BTC momentum (${change.toFixed(2)}%)`);
        return { bullish: score, bearish: 100 - score, score, source: 'Momentum Proxy' };
      }
    } catch (fallbackErr) {
      console.warn('⚠️ Sentiment momentum fallback failed:', fallbackErr.message);
    }

    markApiDegraded('Reddit Sentiment', `Fallback neutral: ${e.message}`);
    return { bullish: 50, bearish: 50, score: 50, source: 'Fallback Neutral' };
  }
}

// ─── 4A. CoinMarketCap: Official Fear & Greed Index ──────────────────────────
export async function fetchFearAndGreed() {
  try {
    const res = await fetch('/api/cmc/v3/fear-and-greed/latest', {
      headers: {
        'X-CMC_PRO_API_KEY': KEYS.cmc,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`CMC F&G HTTP ${res.status}`);
    const data = await res.json();
    if (data.data && data.data.value !== undefined) {
      console.log('✅ CMC Fear & Greed Index fetched:', data.data.value);
      markApiOk('CMC Fear & Greed', `Value ${data.data.value}`);
      return {
        value: parseInt(data.data.value),
        label: data.data.value_classification
      };
    }
    markApiDegraded('CMC Fear & Greed', 'Missing value in CMC payload');
    return { value: 50, label: 'Neutral' };
  } catch (e) {
    console.warn('⚠️ CMC Fear & Greed failed, falling back to alternative.me:', e.message);
    markApiDegraded('CMC Fear & Greed', `Fallback to alternative.me: ${e.message}`);
    // Fallback to alternative.me if CMC key doesn't have access or fails
    try {
      const fallback = await fetch('https://api.alternative.me/fng/');
      const fData = await fallback.json();
      markApiOk('Alternative.me Fear & Greed', `Value ${fData.data?.[0]?.value ?? 'N/A'}`);
      return {
        value: parseInt(fData.data[0].value),
        label: fData.data[0].value_classification
      };
    } catch (err) {
      markApiFailed('Alternative.me Fear & Greed', err.message);
      return { value: 50, label: 'Neutral' };
    }
  }
}
export async function fetchDefiPools() {
  try {
    const res = await fetch('https://yields.llama.fi/pools');
    if (!res.ok) throw new Error(`DefiLlama HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ DefiLlama pools fetched');
    // Get top 10 highest TVL pools
    const topPools = data.data
      .filter(p => p.tvlUsd > 10000000) // minimum 10M TVL to filter junk
      .sort((a, b) => b.tvlUsd - a.tvlUsd)
      .slice(0, 10);
    markApiOk('DefiLlama Pools', `${topPools.length} pools`);
    return topPools;
  } catch (e) {
    console.warn('⚠️ DefiLlama failed:', e.message);
    markApiFailed('DefiLlama Pools', e.message);
    return null;
  }
}

// ─── 4B. Live News Feed (Optimized for Rate Limits) ────────────────────────────
export async function fetchNews() {
  const feed = 'https://cointelegraph.com/rss';
  try {
    // Using a single reliable feed to prevent 429 Too Many Requests from the free proxy
    const res = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`);
    if (!res.ok) throw new Error('RSS Proxy Error');
    const data = await res.json();
    if (!data.items || data.items.length === 0) throw new Error('No items in RSS');

    console.log(`✅ Fetched ${data.items.length} live news items`);
    markApiOk('RSS2JSON News', `${data.items.length} items`);
    return data.items.slice(0, 15);
  } catch (e) {
    console.warn('⚠️ Live News fetch failed, using realistic fallback:', e.message);
    markApiDegraded('RSS2JSON News', `Fallback headlines: ${e.message}`);
    // Fallback to prevent blank UI on proxy failure
    return [
      { title: "Institutional Inflows Increase Across Top Layer-1 Protocols", pubDate: new Date().toISOString() },
      { title: "Bitcoin Market Dominance Holds Steady Amid Global Macro Uncertainty", pubDate: new Date(Date.now() - 3600000).toISOString() },
      { title: "DeFi TVL Reaches New Quarterly Highs as Yields Stabilize", pubDate: new Date(Date.now() - 7200000).toISOString() },
      { title: "Central Banks Hint at Policy Shifts Favoring Alternative Assets", pubDate: new Date(Date.now() - 14400000).toISOString() }
    ];
  }
}

// ─── 4B-2. CoinGecko Trending Narratives ───────────────────────────────────────
export async function fetchTrendingNarratives() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending');
    if (!res.ok) throw new Error('CoinGecko Trending HTTP ' + res.status);
    const data = await res.json();

    // Extract top categories (Narratives) and top coins
    const narratives = data.categories.slice(0, 6).map(c => ({
      name: c.name,
      marketCap: c.data.market_cap ? `$${(c.data.market_cap / 1e9).toFixed(1)}B` : 'N/A',
      change: c.data.market_cap_change_percentage_24h ? (c.data.market_cap_change_percentage_24h.usd || c.data.market_cap_change_percentage_24h.btc || 0) : 0
    }));

    const trendingCoins = data.coins.slice(0, 5).map(c => ({
      symbol: c.item.symbol,
      name: c.item.name,
      thumb: c.item.thumb
    }));

    console.log('✅ Trending Narratives fetched');
    markApiOk('CoinGecko Trending', `${narratives.length} narratives`);
    return { narratives, trendingCoins };
  } catch (e) {
    console.warn('⚠️ Trending Narratives failed, deploying fallback data:', e.message);
    markApiDegraded('CoinGecko Trending', `Fallback narrative set: ${e.message}`);
    // Bulletproof Fallback to prevent blank Sentiment UI
    return {
      narratives: [
        { name: "Artificial Intelligence (AI)", marketCap: "$42.1B", change: 8.5 },
        { name: "Real World Assets (RWA)", marketCap: "$12.4B", change: 12.1 },
        { name: "Layer 1s", marketCap: "$805.2B", change: 2.3 },
        { name: "DeFi 2.0", marketCap: "$38.9B", change: -1.2 },
        { name: "Gaming (GameFi)", marketCap: "$18.5B", change: 4.5 },
        { name: "Meme Coins", marketCap: "$55.1B", change: -5.4 }
      ],
      trendingCoins: []
    };
  }
}

// ─── 4C. Binance & TAAPI: Technical Signals ──────────────────────────────────
export async function fetchTechnicalSignals(symbols = []) {
  if (symbols.length === 0) {
    markApiDegraded('Technical Signals', 'No symbols provided');
    return null;
  }
  try {
    // 1. Fetch 24h ticker data from Binance for volume/price action
    const binancePromises = symbols.map(sym =>
      fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}USDT`)
        .then(r => r.json())
        .catch(() => null)
    );
    const binanceData = await Promise.all(binancePromises);

    // 2. Fetch 4H klines for multi-timeframe confluence (last 50 candles = ~8 days)
    const klinePromises = symbols.map(sym =>
      fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=4h&limit=50`)
        .then(r => r.json())
        .catch(() => null)
    );
    const klineData = await Promise.all(klinePromises);

    // 3. Compute EMA-9 and EMA-21 from 4H klines for each symbol
    const emaData = {};
    symbols.forEach((sym, idx) => {
      const klines = klineData[idx];
      if (klines && klines.length >= 21) {
        const closes = klines.map(k => parseFloat(k[4]));
        const highs = klines.map(k => parseFloat(k[2]));
        const lows = klines.map(k => parseFloat(k[3]));

        const ema9 = computeEMA(closes, 9);
        const ema21 = computeEMA(closes, 21);

        // Mathematically correct ATR: True Range = max(H-L, abs(H-PrevC), abs(L-PrevC))
        let trSum = 0;
        const period = 14;
        const startIdx = Math.max(1, closes.length - period); // ensure we have a previous close
        let actualPeriod = 0;
        for (let i = startIdx; i < closes.length; i++) {
          const hl = highs[i] - lows[i];
          const hpc = Math.abs(highs[i] - closes[i - 1]);
          const lpc = Math.abs(lows[i] - closes[i - 1]);
          trSum += Math.max(hl, hpc, lpc);
          actualPeriod++;
        }
        const atr = actualPeriod > 0 ? trSum / actualPeriod : 0;
        emaData[sym] = { ema9, ema21, atr, lastClose: closes[closes.length - 1] };
      }
    });

    // 4. Fetch RSI for BTC from TAAPI (Free tier = 1 call per 15s)
    let btcRsi = null;
    const computeFallbackBtcRsi = async (reason = 'TAAPI unavailable') => {
      try {
        const rsiRes = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=120');
        if (!rsiRes.ok) throw new Error(`Binance RSI fallback HTTP ${rsiRes.status}`);
        const rsiRaw = await rsiRes.json();
        const closes = Array.isArray(rsiRaw) ? rsiRaw.map(k => parseFloat(k[4])).filter(Number.isFinite) : [];
        const localRsi = computeRSI(closes, 14);
        if (Number.isFinite(localRsi)) {
          btcRsi = localRsi;
          markApiDegraded('TAAPI RSI', `Fallback RSI ${localRsi.toFixed(1)} (${reason})`);
          return true;
        }
      } catch (fallbackErr) {
        console.warn('⚠️ Local RSI fallback failed:', fallbackErr.message);
      }
      return false;
    };

    try {
      const taapiRes = await fetch(`https://api.taapi.io/rsi?secret=${KEYS.taapi}&exchange=binance&symbol=BTC/USDT&interval=1h`);
      if (taapiRes.ok) {
        const taapiJson = await taapiRes.json();
        btcRsi = Number(taapiJson.value);
        if (Number.isFinite(btcRsi)) {
          console.log('✅ TAAPI RSI fetched:', btcRsi);
          markApiOk('TAAPI RSI', `BTC RSI ${btcRsi.toFixed(1)}`);
        } else {
          await computeFallbackBtcRsi('TAAPI payload');
        }
      } else {
        const hadFallback = await computeFallbackBtcRsi(`HTTP ${taapiRes.status}`);
        if (!hadFallback) markApiDegraded('TAAPI RSI', `HTTP ${taapiRes.status}`);
      }
    } catch (err) {
      console.warn('⚠️ TAAPI rate limit or error:', err.message);
      const hadFallback = await computeFallbackBtcRsi(err.message);
      if (!hadFallback) markApiDegraded('TAAPI RSI', err.message);
    }

    console.log('✅ Multi-indicator technical data fetched for', symbols.length, 'assets');
    markApiOk('Technical Signals', `${Object.keys(emaData).length}/${symbols.length} EMA sets`);
    return { binance: binanceData, rsi: btcRsi, ema: emaData };
  } catch (e) {
    console.warn('⚠️ Binance/TAAPI failed:', e.message);
    markApiFailed('Technical Signals', e.message);
    return null;
  }
}

// ─── 4C-2. Binance Futures: Funding Rates (FREE, NO KEY) ─────────────────────
export async function fetchFundingRates(symbols = []) {
  if (symbols.length === 0) {
    markApiDegraded('Binance Funding Rates', 'No symbols provided');
    return [];
  }
  try {
    const promises = symbols.map(sym =>
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}USDT&limit=1`)
        .then(r => r.json())
        .then(data => ({ symbol: sym, rate: data[0] ? parseFloat(data[0].fundingRate) : 0 }))
        .catch(() => ({ symbol: sym, rate: 0 }))
    );
    const results = await Promise.all(promises);
    console.log('✅ Binance Funding Rates fetched for', results.length, 'assets');
    markApiOk('Binance Funding Rates', `${results.length} symbols`);
    return results;
  } catch (e) {
    console.warn('⚠️ Funding Rates failed:', e.message);
    markApiFailed('Binance Funding Rates', e.message);
    return [];
  }
}

// ─── 4C-3. Binance Futures: Open Interest (FREE, NO KEY) ─────────────────────
export async function fetchOpenInterest(symbols = []) {
  if (symbols.length === 0) {
    markApiDegraded('Binance Open Interest', 'No symbols provided');
    return [];
  }
  try {
    const promises = symbols.map(sym =>
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`)
        .then(r => r.json())
        .then(data => ({ symbol: sym, oi: parseFloat(data.openInterest || 0) }))
        .catch(() => ({ symbol: sym, oi: 0 }))
    );
    const results = await Promise.all(promises);
    console.log('✅ Binance Open Interest fetched for', results.length, 'assets');
    markApiOk('Binance Open Interest', `${results.length} symbols`);
    return results;
  } catch (e) {
    console.warn('⚠️ Open Interest failed:', e.message);
    markApiFailed('Binance Open Interest', e.message);
    return [];
  }
}

// ─── 4C-4. Binance: Order Book Depth (FREE, NO KEY) ──────────────────────────
export async function fetchOrderBookDepth(symbol = 'BTC') {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}USDT&limit=500`);
    if (!res.ok) throw new Error(`Depth HTTP ${res.status}`);
    const data = await res.json();

    // Calculate bid wall (support) and ask wall (resistance)
    const bidTotal = data.bids.reduce((sum, [price, qty]) => sum + parseFloat(price) * parseFloat(qty), 0);
    const askTotal = data.asks.reduce((sum, [price, qty]) => sum + parseFloat(price) * parseFloat(qty), 0);

    const strongestBid = data.bids.reduce((max, [p, q]) => parseFloat(q) > max.qty ? { price: parseFloat(p), qty: parseFloat(q) } : max, { price: 0, qty: 0 });
    const strongestAsk = data.asks.reduce((max, [p, q]) => parseFloat(q) > max.qty ? { price: parseFloat(p), qty: parseFloat(q) } : max, { price: 0, qty: 0 });

    const buyPressure = bidTotal / (bidTotal + askTotal) * 100;

    console.log(`✅ Order book depth fetched for ${symbol}: Buy pressure ${buyPressure.toFixed(1)}%`);
    markApiOk('Binance Order Book', `${symbol} buy pressure ${buyPressure.toFixed(1)}%`);
    return {
      symbol,
      bidTotal,
      askTotal,
      buyPressure: buyPressure.toFixed(1),
      support: strongestBid.price,
      resistance: strongestAsk.price
    };
  } catch (e) {
    console.warn('⚠️ Order Book failed:', e.message);
    markApiFailed('Binance Order Book', e.message);
    return null;
  }
}

// ─── 4C-5. Blockchain.com: BTC Network Health (FREE, NO KEY) ─────────────────
export async function fetchBtcOnChain() {
  try {
    const [hashRate, unconfirmed, difficulty] = await Promise.all([
      fetch('https://blockchain.info/q/hashrate').then(r => r.text()).catch(() => '0'),
      fetch('https://blockchain.info/q/unconfirmedcount').then(r => r.text()).catch(() => '0'),
      fetch('https://blockchain.info/q/getdifficulty').then(r => r.text()).catch(() => '0')
    ]);

    console.log('✅ BTC on-chain stats fetched');
    markApiOk('Blockchain.info BTC', `Hashrate ${hashRate}`);
    return {
      hashRate: (parseFloat(hashRate) / 1e9).toFixed(2), // GH/s → EH/s
      unconfirmedTx: parseInt(unconfirmed),
      difficulty: (parseFloat(difficulty) / 1e12).toFixed(2) // → T
    };
  } catch (e) {
    console.warn('⚠️ Blockchain.com failed:', e.message);
    markApiFailed('Blockchain.info BTC', e.message);
    return null;
  }
}

// ─── 4C-6. Dune: Cross-Chain Macro Flow Pulse (Serverless Proxy) ────────────
export async function fetchDuneMarketPulse() {
  try {
    const res = await fetch('/api/dune');
    if (!res.ok) throw new Error(`Dune Proxy HTTP ${res.status}`);
    const payload = await res.json();
    if (!payload || !payload.data) throw new Error('Invalid Dune payload');

    const data = payload.data;
    const signalScore = Number(data.signalScore);
    const volumeGrowthPct = Number(data.volumeGrowthPct);
    const btcTxGrowthPct = Number(data.btcTxGrowthPct);
    const uniqueTraders24h = Number(data.uniqueTraders24h);
    const bias = String(data.bias || 'neutral');

    if (!Number.isFinite(signalScore)) throw new Error('Missing Dune signal score');

    markApiOk(
      'Dune Market Pulse',
      `Score ${signalScore.toFixed(1)} (${bias}), VolΔ ${Number.isFinite(volumeGrowthPct) ? volumeGrowthPct.toFixed(1) : '0.0'}%`
    );

    return {
      signalScore: Math.max(0, Math.min(100, signalScore)),
      bias,
      volume24h: Number(data.volume24h) || 0,
      volumePrev24h: Number(data.volumePrev24h) || 0,
      volumeGrowthPct: Number.isFinite(volumeGrowthPct) ? volumeGrowthPct : 0,
      trades24h: Number(data.trades24h) || 0,
      uniqueTraders24h: Number.isFinite(uniqueTraders24h) ? uniqueTraders24h : 0,
      btcTx24h: Number(data.btcTx24h) || 0,
      btcTxPrev24h: Number(data.btcTxPrev24h) || 0,
      btcTxGrowthPct: Number.isFinite(btcTxGrowthPct) ? btcTxGrowthPct : 0,
      source: String(payload.source || 'dune_sql'),
      asOf: payload.asOf || null
    };
  } catch (e) {
    console.warn('⚠️ Dune Market Pulse failed:', e.message);
    markApiDegraded('Dune Market Pulse', `Fallback disabled: ${e.message}`);
    return null;
  }
}

// Helper: Compute Exponential Moving Average
function computeEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// Helper: Compute RSI from close-price series
function computeRSI(closes = [], period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ─── 4D. CoinGecko Categories: Narratives & Sectors ──────────────────────────
export async function fetchNarratives() {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/categories?x_cg_demo_api_key=${KEYS.coingecko}`);
    if (!res.ok) throw new Error(`CoinGecko Categories HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ Narratives fetched');
    // Filter out categories with null market cap and sort
    const validData = data.filter(c => c.market_cap !== null && c.volume_24h !== null);
    markApiOk('CoinGecko Categories', `${validData.length} categories`);
    return validData.slice(0, 10);
  } catch (e) {
    console.warn('⚠️ Narratives fetch failed:', e.message);
    markApiFailed('CoinGecko Categories', e.message);
    return null;
  }
}

// ─── 4E. Binance Klines: Real Chart Data ─────────────────────────────────────
export async function fetchChartData(symbol = 'BTC', interval = '1h', limit = 48) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol.replace('USDT', '')}USDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance Klines HTTP ${res.status}`);
    const data = await res.json();
    // Binance returns [OpenTime, Open, High, Low, Close, Volume, ...]
    const closePrices = data.map(candle => parseFloat(candle[4]));
    console.log(`✅ ${interval} Chart data fetched for ${symbol}`);
    markApiOk('Binance Klines', `${symbol} ${interval} (${closePrices.length})`);
    return closePrices;
  } catch (e) {
    console.warn(`⚠️ Chart data fetch failed for ${symbol}:`, e.message);
    markApiFailed('Binance Klines', `${symbol} ${interval}: ${e.message}`);
    return null;
  }
}

// ─── 5. Candlestick Pattern Fetcher ─────────────────────────────────────────
export async function fetchCandlePatterns(symbol, interval = '4h') {
  try {
    const ticker = symbol.replace('/', '').replace('-', '').toUpperCase();
    const cleanTicker = ticker.endsWith('USDT') ? ticker : `${ticker}USDT`;
    const res = await fetch(`/api/candles?symbol=${cleanTicker}&interval=${interval}`);
    if (!res.ok) throw new Error(`Candle API HTTP ${res.status}`);
    const data = await res.json();
    const source = String(data?.source || 'fresh');
    const sourceLower = source.toLowerCase();
    const patternCount = data.patterns?.length ?? 0;
    const candleCount = Number(data?.candleCount) || 0;
    const hasUsableSeries = candleCount > 0 && Number(data?.currentPrice) > 0;
    const isHardFallback = sourceLower.includes('fallback_empty') || sourceLower.includes('error');
    const isSymbolFallback = sourceLower.includes('fallback_symbol');
    console.log(`✅ Candle patterns fetched for ${cleanTicker} (${interval}):`, patternCount, 'patterns');
    if (isHardFallback || isSymbolFallback || !hasUsableSeries) {
      markApiDegraded('NEXUS Candle API', `${cleanTicker} ${interval} fallback (${source})`);
    } else {
      markApiOk('NEXUS Candle API', `${cleanTicker} ${interval} (${patternCount} patterns, source=${source})`);
    }
    return data;
  } catch (e) {
    console.warn('⚠️ Candle pattern fetch failed:', e.message);
    markApiDegraded('NEXUS Candle API', `Fallback: ${e.message}`);
    return {
      source: 'fallback_empty',
      symbol: (() => {
        const base = String(symbol || 'BTC').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return base.endsWith('USDT') ? base : `${base}USDT`;
      })(),
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
    };
  }
}

async function fetchBinanceReferencePrice(symbol = 'BTC') {
  try {
    const ticker = String(symbol || 'BTC').replace('/', '').replace('-', '').toUpperCase();
    const cleanTicker = ticker.endsWith('USDT') ? ticker : `${ticker}USDT`;
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanTicker}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = toNumber(data?.price);
    return price && price > 0 ? price : null;
  } catch {
    return null;
  }
}

const MIRROR_SIGNAL_TTL_MS = 90 * 1000; // 90 seconds for scalp freshness
const SIGNAL_MIRROR_SCHEMA_VERSION = 'v2_price_order';
const SIGNAL_QUERY_RE = /\b(signal|trade\s*setup|entry|entries|stop\s*loss|targets?|take[-\s]?profit|leverage|long|short)\b/i;
const PAIR_ONLY_SIGNAL_RE = /^\s*#?\s*[A-Z0-9]{2,10}\s*(?:\/\s*USDT|USDT)\s*$/i;
const SYMBOL_STOP_WORDS = new Set([
  'THE', 'FOR', 'AND', 'BUT', 'NOT', 'CAN', 'ARE', 'YOU', 'HIS', 'HER', 'GET', 'SET', 'USE', 'HOW', 'WHY', 'WHAT',
  'GIVE', 'LONG', 'SHORT', 'SELL', 'BUY', 'TRADE', 'SETUP', 'ANALYSIS', 'PLEASE', 'WITH', 'THIS', 'THAT', 'THEN',
  'TARGET', 'TARGETS', 'STOP', 'LOSS', 'ENTRY', 'ZONE', 'PRICE', 'MARKET', 'NEXUS', 'DUAL', 'ENGINE', 'GPT', 'HERMES',
  'CURRENT', 'CONTEXT', 'LATEST', 'LIVE', 'DATA', 'USER', 'QUERY', 'USDT',
  'HIGHEST', 'CONVICTION', 'ASSET', 'ASSETS', 'RIGHT', 'NOW', 'INCLUDE', 'PROFIT', 'RATIO'
]);

function isSignalRequest(text = '') {
  const q = String(text || '');
  return SIGNAL_QUERY_RE.test(q) || PAIR_ONLY_SIGNAL_RE.test(q);
}

function escapeRegExp(text = '') {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSymbolsFromAssetContext(assetContext = '') {
  const symbols = new Set();
  const upper = String(assetContext || '').toUpperCase();
  const re = /\b([A-Z0-9]{2,10})\s*:\s*(?:CURRENT_PRICE=)?\$/g;
  let match;
  while ((match = re.exec(upper)) !== null) {
    symbols.add(match[1]);
  }
  return symbols;
}

function extractPrimarySymbol(userQuery = '', assetContext = '') {
  const q = String(userQuery || '').toUpperCase();
  const knownSymbols = parseSymbolsFromAssetContext(assetContext);

  // Prefer explicit pair declarations first: SUI/USDT or SUIUSDT
  const pairMatch = q.match(/\b([A-Z0-9]{2,10})\s*\/\s*USDT\b/);
  if (pairMatch) return pairMatch[1];

  const compactPairMatch = q.match(/\b([A-Z0-9]{2,10})USDT\b/);
  if (compactPairMatch) return compactPairMatch[1];

  // Then #SYMBOL tags
  const hashMatch = q.match(/#([A-Z0-9]{2,10})\b/);
  if (hashMatch) return hashMatch[1];

  // Then scan known symbols from live context
  if (knownSymbols.size > 0) {
    const ranked = [...knownSymbols].sort((a, b) => b.length - a.length);
    for (const sym of ranked) {
      const symRe = new RegExp(`\\b${escapeRegExp(sym)}\\b`, 'i');
      if (symRe.test(q)) return sym;
    }
  }

  // Last fallback: first non-stopword token
  const tokens = q.match(/[A-Z0-9]{2,10}/g) || [];
  for (const token of tokens) {
    if (knownSymbols.has(token)) return token;
  }

  // If we have a known live universe from context, prefer it over guessing random words.
  if (knownSymbols.size > 0) {
    return [...knownSymbols][0] || null;
  }

  for (const token of tokens) {
    if (!SYMBOL_STOP_WORDS.has(token)) return token;
  }

  return null;
}

function getSignalMirrorCacheKey(symbol, interval = '4h') {
  return `mirror_signal_${SIGNAL_MIRROR_SCHEMA_VERSION}_${symbol}_${interval}`;
}

function stripLegacyApiStatusBanner(html = '') {
  return String(html)
    .replace(/<div[^>]*>\s*API status:[\s\S]*?<\/div>\s*/i, '')
    .replace(/<div[^>]*>\s*Candle Pattern Feed\s*\([^)]+\)\s*:[\s\S]*?<\/div>\s*/i, '');
}

async function readMirroredSignal(symbol, interval = '4h', liveReferencePrice = null) {
  if (!symbol) return null;
  try {
    const { supabase } = await import('./lib/supabase.js');
    const cacheKey = getSignalMirrorCacheKey(symbol, interval);
    const { data, error } = await supabase
      .from('global_market_cache')
      .select('data, updated_at')
      .eq('id', cacheKey)
      .single();

    if (error || !data?.data?.html || !data?.updated_at) return null;
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > MIRROR_SIGNAL_TTL_MS) return null;
    const rawHtml = String(data.data.html || '');
    const hasPlaceholderTargets = /Take-?Profit Targets:[\s\S]*?1\)\s*1[\s\S]*?2\)\s*2[\s\S]*?3\)\s*3[\s\S]*?4\)\s*4/i.test(rawHtml);
    const hasPlaceholderStop = /Stop Targets:[\s\S]*?1\)\s*1/i.test(rawHtml);
    const hasUnavailableFeed = /Candle Pattern Feed\s*\([^)]+\)\s*:\s*Candle feed temporarily unavailable\./i.test(rawHtml);
    const hasHardPatternClaim = /\b(High-Volume Breakout|Bear Flag Breakdown|Bull Flag Breakout|Ascending Triangle|Cup\s*&\s*Handle|Descending Channel|Shooting Star|Bullish Hammer|Bearish Marubozu)\b/i.test(rawHtml);
    const missingLeverage = !/\bLeverage\s*:/i.test(rawHtml);
    if (hasPlaceholderTargets && hasPlaceholderStop) {
      // Reject low-quality mirrored payloads so they don't persist for the full TTL.
      return null;
    }
    if (hasUnavailableFeed && hasHardPatternClaim) {
      // Reject contradictory mirrored payloads: feed unavailable but rationale still claims specific patterns.
      return null;
    }
    if (missingLeverage) return null;
    const mirroredRefPrice = toNumber(data?.data?.referencePrice);
    const liveRef = toNumber(liveReferencePrice);
    if (mirroredRefPrice && liveRef) {
      const driftPct = Math.abs(mirroredRefPrice - liveRef) / liveRef;
      if (driftPct > 0.008) {
        // Reject stale mirrored signal when live price drift exceeds 0.8%.
        return null;
      }
    }
    return stripLegacyApiStatusBanner(rawHtml);
  } catch (e) {
    console.warn('⚠️ Mirror cache read failed:', e.message);
    return null;
  }
}

async function writeMirroredSignal(symbol, interval = '4h', html, meta = {}) {
  if (!symbol || !html) return;
  try {
    const { supabase } = await import('./lib/supabase.js');
    const cacheKey = getSignalMirrorCacheKey(symbol, interval);
    await supabase.from('global_market_cache').upsert({
      id: cacheKey,
      data: {
        html,
        symbol,
        interval,
        ...meta
      },
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn('⚠️ Mirror cache write failed:', e.message);
  }
}

function extractPriceTokens(text = '') {
  return [...String(text).matchAll(/\$?\d[\d,]*(?:\.\d+)?/g)]
    .map(m => (m[0] || '').replace(/\$/g, '').replace(/,/g, '').trim())
    .filter(Boolean);
}

function toNumber(value) {
  const n = parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function formatPercentValue(value) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function extractFirstPrice(text = '') {
  const cleaned = String(text).replace(/^\s*\d+\)\s*/, '').replace(/^\s*Target\s*\d+\s*:\s*/i, '').trim();
  const prices = extractPriceTokens(cleaned);
  return prices.length > 0 ? prices[0] : null;
}

function stripForbiddenSignalAnnotations(text = '') {
  return String(text)
    .replace(/⚡\s*NEXUS\s*Pro\s*Autotrade\s*Signals/gi, '')
    .replace(/\s*\(1:\s*\d+(?:\.\d+)?\s*R:R\)\s*/gi, '')
    .replace(/\s*\(1\.5\s*ATR\)\s*/gi, '')
    .replace(/📪\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSignalDirection(text = '') {
  const signalTypeMatch = String(text).match(/Signal Type:\s*Regular\s*\((Long|Short)\)/i);
  if (signalTypeMatch) return signalTypeMatch[1].toUpperCase();

  const directionMatch = String(text).match(/Direction:\s*\[?\s*(LONG|SHORT)\s*\]?/i);
  if (directionMatch) return directionMatch[1].toUpperCase();

  return 'LONG';
}

function normalizeTradeConfidence(value = null) {
  const raw = toNumber(value);
  if (raw === null) return 0.5;
  if (raw > 20) return Math.max(0, Math.min(1, raw / 100));
  if (raw > 1) return Math.max(0, Math.min(1, raw / 5));
  return Math.max(0, Math.min(1, raw));
}

function clampBetween(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const MIN_ASSISTANT_PRICE = 0.0000001;

function assistantPriceOrderGap(referencePrice = 1, candleData = null) {
  const ref = Math.max(toNumber(referencePrice) || toNumber(candleData?.currentPrice) || 1, MIN_ASSISTANT_PRICE);
  const atr = toNumber(candleData?.atr);
  const atrPct = atr && ref ? (atr / ref) * 100 : 0.55;
  const gapPct = clampBetween(Math.max(atrPct * 0.12, 0.05), 0.05, 0.20);
  return Math.max(ref * (gapPct / 100), MIN_ASSISTANT_PRICE);
}

function validateAssistantPriceOrder(direction = 'LONG', entries = [], targets = [], stop = null) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const entryNums = (entries || []).map(toNumber).filter(n => n !== null && n > 0);
  const targetNums = (targets || []).map(toNumber).filter(n => n !== null && n > 0);
  const stopNum = toNumber(stop);

  if (entryNums.length !== 3 || targetNums.length !== 4 || !(stopNum > 0)) return false;

  const minEntry = Math.min(...entryNums);
  const maxEntry = Math.max(...entryNums);

  if (side === 'LONG') {
    const targetsAscending = targetNums.every((target, index) => index === 0 || target > targetNums[index - 1]);
    return stopNum < minEntry && maxEntry < Math.min(...targetNums) && targetsAscending;
  }

  const targetsDescending = targetNums.every((target, index) => index === 0 || target < targetNums[index - 1]);
  return Math.max(...targetNums) < minEntry && maxEntry < stopNum && targetsDescending;
}

function normalizeAssistantTradePlan(direction = 'LONG', entries = [], targets = [], stop = null, referencePrice = null, options = {}) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const ref = Math.max(toNumber(referencePrice) || toNumber(options.candleData?.currentPrice) || 1, MIN_ASSISTANT_PRICE);
  const gap = assistantPriceOrderGap(ref, options.candleData);
  const parsedEntries = (entries || []).map(toNumber).filter(n => n !== null && n > 0);
  const base = parsedEntries[0] || ref;
  const stepPct = clampBetween(((toNumber(options.candleData?.atr) && ref) ? ((toNumber(options.candleData?.atr) / ref) * 100) * 0.16 : 0.12), 0.07, 0.24);
  const step = base * (stepPct / 100);

  let entryNums = parsedEntries.length >= 3
    ? parsedEntries.slice(0, 3)
    : (side === 'SHORT'
      ? [base, base + step, base + (step * 2)]
      : [base, Math.max(MIN_ASSISTANT_PRICE, base - step), Math.max(MIN_ASSISTANT_PRICE, base - (step * 2))]);

  entryNums = entryNums
    .map(n => Math.max(MIN_ASSISTANT_PRICE, n))
    .sort((a, b) => side === 'SHORT' ? a - b : b - a);

  const minEntry = Math.min(...entryNums);
  const maxEntry = Math.max(...entryNums);
  const avgEntry = entryNums.reduce((sum, n) => sum + n, 0) / entryNums.length;

  let stopNum = toNumber(stop);
  if (!(stopNum > 0)) {
    stopNum = side === 'SHORT'
      ? maxEntry + Math.max(gap * 2, avgEntry * 0.005)
      : Math.max(MIN_ASSISTANT_PRICE, minEntry - Math.max(gap * 2, avgEntry * 0.005));
  }
  if (side === 'LONG' && stopNum >= minEntry) stopNum = Math.max(MIN_ASSISTANT_PRICE, minEntry - gap);
  if (side === 'SHORT' && stopNum <= maxEntry) stopNum = maxEntry + gap;

  const risk = Math.max(Math.abs(avgEntry - stopNum), avgEntry * 0.001);
  let targetNums = (targets || []).map(toNumber).filter(n => n !== null && n > 0).slice(0, 4);
  if (targetNums.length < 4) {
    const generated = [1.15, 1.9, 2.7, 3.5].map(mult => side === 'SHORT'
      ? Math.max(MIN_ASSISTANT_PRICE, avgEntry - (risk * mult))
      : avgEntry + (risk * mult));
    targetNums = [...targetNums, ...generated].slice(0, 4);
  }

  targetNums = targetNums.sort((a, b) => side === 'SHORT' ? b - a : a - b);
  const finalTargets = [];
  if (side === 'LONG') {
    let floor = maxEntry + gap;
    for (const target of targetNums) {
      const finalTarget = Math.max(target, floor);
      finalTargets.push(finalTarget);
      floor = finalTarget + gap;
    }
  } else {
    let ceiling = minEntry - gap;
    for (const target of targetNums) {
      const finalTarget = Math.max(MIN_ASSISTANT_PRICE, Math.min(target, ceiling));
      finalTargets.push(finalTarget);
      ceiling = finalTarget - gap;
    }
  }

  return {
    direction: side,
    entries: entryNums,
    targets: finalTargets,
    stop: stopNum,
    avgEntry,
    riskPct: (Math.abs(avgEntry - stopNum) / Math.max(avgEntry, MIN_ASSISTANT_PRICE)) * 100,
    valid: validateAssistantPriceOrder(side, entryNums, finalTargets, stopNum)
  };
}

function getScalpRiskEnvelope(candleData = null, confidenceValue = null) {
  const current = toNumber(candleData?.currentPrice);
  const atr = toNumber(candleData?.atr);
  const atrPct = (current && atr) ? (atr / current) * 100 : null;
  const confidence = normalizeTradeConfidence(confidenceValue);

  let minRiskPct = 0.35;
  let maxRiskPct = 0.50;

  if (atrPct !== null) {
    if (atrPct >= 4.2) {
      minRiskPct = 0.44;
      maxRiskPct = 0.50;
    } else if (atrPct >= 3.0) {
      minRiskPct = 0.41;
      maxRiskPct = 0.48;
    } else if (atrPct >= 2.0) {
      minRiskPct = 0.38;
      maxRiskPct = 0.46;
    } else if (atrPct <= 0.9) {
      minRiskPct = 0.35;
      maxRiskPct = 0.42;
    }
  }

  if (confidence >= 0.75) {
    minRiskPct -= 0.02;
    maxRiskPct -= 0.02;
  } else if (confidence <= 0.35) {
    minRiskPct += 0.02;
    maxRiskPct += 0.02;
  }

  const boundedMin = clampBetween(minRiskPct, 0.35, 0.50);
  const boundedMax = clampBetween(Math.max(maxRiskPct, boundedMin + 0.03), 0.38, 0.50);

  return {
    atrPct,
    minRiskPct: boundedMin,
    maxRiskPct: boundedMax
  };
}

function getScalpTargetMultipliers(confidenceValue = null, atrPct = null) {
  const confidence = normalizeTradeConfidence(confidenceValue);
  let mults = [1.50, 2.10, 2.80, 3.60];

  if (confidence >= 0.75) mults = [1.65, 2.30, 3.00, 3.85];
  else if (confidence <= 0.35) mults = [1.50, 2.00, 2.60, 3.30];

  if (atrPct !== null && atrPct >= 3.5) {
    mults = mults.map((m, i) => m + [0.05, 0.10, 0.15, 0.20][i]);
  } else if (atrPct !== null && atrPct <= 1.0) {
    mults = mults.map((m, i) => Math.max(i === 0 ? 1.50 : 1.85, m - [0.00, 0.08, 0.12, 0.16][i]));
  }

  mults[0] = Math.max(mults[0], 1.50);
  return mults;
}

function getDirectionalStructureLevels(direction = 'LONG', entryPrice = null, candleData = null) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = toNumber(entryPrice);
  if (!(entry > 0)) return [];

  const localRes = Array.isArray(candleData?.localResistances) ? candleData.localResistances : [];
  const localSup = Array.isArray(candleData?.localSupports) ? candleData.localSupports : [];
  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);

  const rawLevels = side === 'LONG'
    ? [...localRes, swingHigh]
    : [...localSup, swingLow];

  const candidates = rawLevels
    .map(toNumber)
    .filter(v => v !== null && v > 0)
    .filter(v => (side === 'LONG' ? v > entry : v < entry))
    .sort((a, b) => side === 'LONG' ? a - b : b - a);

  const deduped = [];
  for (const level of candidates) {
    if (deduped.length === 0) {
      deduped.push(level);
      continue;
    }
    const prev = deduped[deduped.length - 1];
    const gapPct = prev > 0 ? (Math.abs(level - prev) / prev) * 100 : 0;
    if (gapPct >= 0.10) deduped.push(level);
  }
  return deduped;
}

function buildScalpTargetsFromStructure(direction = 'LONG', entryPrice = null, riskDistance = null, candleData = null, confidenceValue = null) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const entry = toNumber(entryPrice);
  if (!(entry > 0)) return [];

  const envelope = getScalpRiskEnvelope(candleData, confidenceValue);
  const atr = toNumber(candleData?.atr) ?? Math.max(entry * 0.004, 0.0000001);
  const minStep = Math.max(atr * 0.12, entry * 0.0012);
  const safeRisk = Math.max(toNumber(riskDistance) || 0, entry * (envelope.minRiskPct / 100));
  const minTp1Distance = safeRisk * 1.50;
  const multipliers = getScalpTargetMultipliers(confidenceValue, envelope.atrPct);
  const maxTravel = Math.max(safeRisk * (multipliers[3] + 0.20), entry * 0.0095);

  const directionalLevels = getDirectionalStructureLevels(side, entry, candleData);
  let levels = directionalLevels.filter(level => {
    const d = Math.abs(level - entry);
    return d >= Math.max(minStep * 0.75, minTp1Distance) && d <= (maxTravel * 1.25);
  });

  if (levels.length === 0 && directionalLevels.length > 0) {
    const nearestLevel = directionalLevels[0];
    const nearestDist = Math.abs(nearestLevel - entry);
    const projectedDist = Math.max(minTp1Distance, Math.min(nearestDist, maxTravel));
    const factors = [1.50, 2.10, 2.80, 3.60];
    levels = factors.map(f => side === 'LONG'
      ? entry + (projectedDist * f)
      : Math.max(0.0000001, entry - (projectedDist * f)));
  }

  const targets = [];
  for (const level of levels) {
    if (targets.length === 4) break;
    const prev = targets.length ? targets[targets.length - 1] : entry;
    if (side === 'LONG' && level <= prev) continue;
    if (side === 'SHORT' && level >= prev) continue;
    targets.push(level);
  }

  for (let i = 0; targets.length < 4 && i < multipliers.length; i++) {
    const raw = side === 'LONG'
      ? entry + (safeRisk * multipliers[i])
      : entry - (safeRisk * multipliers[i]);
    let candidate = raw;
    if (side === 'LONG') {
      candidate = Math.min(entry + maxTravel, candidate);
    } else {
      candidate = Math.max(0.0000001, Math.max(entry - maxTravel, candidate));
    }

    const prev = targets.length ? targets[targets.length - 1] : entry;
    if (side === 'LONG' && candidate <= prev) candidate = prev + minStep;
    if (side === 'SHORT' && candidate >= prev) candidate = Math.max(0.0000001, prev - minStep);
    targets.push(candidate);
  }

  return targets.slice(0, 4);
}

function deriveScalpLeverageLabel(candleData = null, confidenceValue = null) {
  const current = toNumber(candleData?.currentPrice);
  const atr = toNumber(candleData?.atr);
  const atrPct = (current && atr) ? (atr / current) * 100 : null;
  const confidence = normalizeTradeConfidence(confidenceValue);

  let lev = 8;
  if (atrPct !== null) {
    if (atrPct >= 4) lev = 4;
    else if (atrPct >= 3) lev = 5;
    else if (atrPct >= 2.2) lev = 6;
    else if (atrPct >= 1.6) lev = 7;
    else if (atrPct >= 1.1) lev = 9;
    else lev = 11;
  }

  if (confidence >= 0.75 && (atrPct === null || atrPct < 2.8)) lev += 1;
  if (confidence <= 0.35) lev -= 1;

  lev = Math.max(4, Math.min(12, Math.round(lev)));
  return `Cross (${lev}X)`;
}

function getPatternBiasScore(candleData = null) {
  const patterns = Array.isArray(candleData?.patterns) ? candleData.patterns : [];
  const weights = [1.0, 0.8, 0.6, 0.45, 0.35];
  let bull = 0;
  let bear = 0;

  patterns.slice(0, 5).forEach((p, idx) => {
    const w = weights[idx] || 0.25;
    if (p?.type === 'bullish') bull += w;
    if (p?.type === 'bearish') bear += w;
  });

  return bull - bear;
}

function isCandleFeedUnavailable(candleData = null) {
  if (!candleData) return true;
  const source = String(candleData?.source || '').toLowerCase();
  if (source.includes('fallback_empty') || source.includes('error')) return true;
  const summary = String(candleData?.summary || '').toLowerCase();
  if (summary.includes('temporarily unavailable')) return true;
  return false;
}

function hasDetectedCandlePatterns(candleData = null) {
  if (isCandleFeedUnavailable(candleData)) return false;
  return Array.isArray(candleData?.patterns) && candleData.patterns.length > 0;
}

function getDynamicTrailingConfig(direction = 'LONG', entryPrice = null, stopPrice = null, candleData = null, options = {}) {
  const currentPrice = toNumber(candleData?.currentPrice) ?? toNumber(entryPrice);
  const stop = toNumber(stopPrice);
  const atr = toNumber(candleData?.atr);

  const atrPct = (currentPrice && atr) ? (atr / currentPrice) * 100 : null;
  const riskPct = (currentPrice && stop) ? (Math.abs(currentPrice - stop) / currentPrice) * 100 : null;

  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const confidence = normalizeTradeConfidence(options.confidence);
  const changePct = toNumber(options.changePct) ?? toNumber(candleData?.changePct) ?? 0;
  const patternBias = toNumber(options.patternBias) ?? getPatternBiasScore(candleData);

  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);
  const range = (swingHigh !== null && swingLow !== null && swingHigh > swingLow) ? (swingHigh - swingLow) : 0;
  const position = (range > 0 && currentPrice !== null) ? (currentPrice - swingLow) / range : 0.5;

  const volHigh = (atrPct !== null && atrPct >= 5) || (riskPct !== null && riskPct >= 7);
  const volMedium = !volHigh && (((atrPct !== null && atrPct >= 3.2) || (riskPct !== null && riskPct >= 5)));
  const volLow = (atrPct !== null && atrPct <= 1.8) && (riskPct !== null && riskPct <= 2.8);

  let trendScore = 0;
  let counterScore = 0;

  if (side === 'LONG') {
    if (changePct >= 1) trendScore += 1;
    if (changePct <= -1) counterScore += 1;
    if (patternBias >= 0.6) trendScore += 1;
    if (patternBias <= -0.6) counterScore += 1;
    if (position <= 0.55) trendScore += 0.5;
    if (position >= 0.72) counterScore += 0.5;
  } else {
    if (changePct <= -1) trendScore += 1;
    if (changePct >= 1) counterScore += 1;
    if (patternBias <= -0.6) trendScore += 1;
    if (patternBias >= 0.6) counterScore += 1;
    if (position >= 0.45) trendScore += 0.5;
    if (position <= 0.28) counterScore += 0.5;
  }

  if (confidence >= 0.65) trendScore += 0.5;
  if (confidence <= 0.35) counterScore += 0.5;

  const mode = (trendScore - counterScore >= 0.8)
    ? 'trend'
    : (counterScore - trendScore >= 0.8 ? 'counter' : 'chop');

  // Scalp-first defaults: protect downside quickly while allowing controlled extension.
  let trailPct = 1.05;
  let breakevenPct = 0.75;

  if (volHigh) {
    trailPct = 1.55;
    breakevenPct = 1.05;
  } else if (volMedium) {
    trailPct = 1.25;
    breakevenPct = 0.85;
  } else if (volLow) {
    trailPct = 0.78;
    breakevenPct = 0.45;
  }

  if (mode === 'trend') {
    trailPct -= 0.18;
    breakevenPct -= 0.12;
  } else if (mode === 'counter') {
    trailPct += 0.22;
    breakevenPct += 0.18;
  } else {
    trailPct += 0.12;
    breakevenPct += 0.10;
  }

  if (confidence >= 0.75) {
    trailPct -= 0.10;
    breakevenPct -= 0.08;
  } else if (confidence <= 0.35) {
    trailPct += 0.14;
    breakevenPct += 0.12;
  }

  trailPct = Math.max(0.55, Math.min(2.40, trailPct));
  breakevenPct = Math.max(0.25, Math.min(1.60, breakevenPct));

  let startCushion = 0.20;
  if (mode === 'trend' && confidence >= 0.7 && !volHigh) startCushion = 0;
  else if (volHigh && mode === 'counter') startCushion = 0.55;
  else if (volHigh) startCushion = 0.40;
  else if (mode === 'chop') startCushion = 0.30;
  else if (volLow) startCushion = 0.08;

  const startRule = startCushion <= 0.05
    ? 'Trail activates immediately after entry confirmation.'
    : `Trail activates after +${formatPercentValue(startCushion)}% profit cushion.`;

  let regimeHint = 'Scalp defense profile active.';
  if (mode === 'trend') regimeHint = `${side} trend continuation detected; fast lock-in to preserve momentum gains.`;
  else if (mode === 'counter') regimeHint = `${side} counter-trend risk detected; wider leash to reduce premature stop-outs.`;
  else if (volHigh) regimeHint = 'High volatility regime; staged trailing helps avoid noise whipsaws.';

  if (volLow && mode === 'trend') {
    regimeHint = `${side} low-volatility trend; aggressive protection is enabled for scalp retention.`;
  }

  return {
    stopMode: side === 'SHORT' ? 'Percent Above Lowest' : 'Percent Below Highest',
    trailPct: formatPercentValue(trailPct),
    breakevenPct: formatPercentValue(breakevenPct),
    startRule,
    regimeHint
  };
}

function buildTrailingConfigurationBlock(config) {
  return `Trailing Configuration:
Stop: ${config.stopMode} (${config.trailPct}%)
  - ${config.startRule}
  - ${config.regimeHint}
Breakeven: Trigger at +${config.breakevenPct}% profit
  - Stop moves to entry after +${config.breakevenPct}%.`;
}

function formatSignalPrice(value, reference = 1) {
  const n = toNumber(value);
  if (n === null) return '0';
  const ref = Math.abs(toNumber(reference) ?? Math.abs(n));

  let decimals = 2;
  if (ref < 0.000001) decimals = 12;
  else if (ref < 0.0001) decimals = 10;
  else if (ref < 0.001) decimals = 8;
  else if (ref < 0.01) decimals = 7;
  else if (ref < 0.1) decimals = 6;
  else if (ref < 1) decimals = 5;
  else if (ref < 10) decimals = 4;
  else if (ref < 1000) decimals = 2;
  else decimals = 1;

  return n.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function deriveAdaptiveStartFromCandle(direction = 'LONG', currentPrice = null, atr = null, candleData = null) {
  const current = toNumber(currentPrice);
  if (current === null) return null;

  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const atrNum = toNumber(atr);
  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);
  const range = (swingHigh !== null && swingLow !== null) ? Math.max(0, swingHigh - swingLow) : 0;
  const position = range > 0 ? (current - swingLow) / range : 0.5;

  let offsetAtr = side === 'SHORT' ? 0.15 : -0.15;
  if (side === 'LONG') {
    if (position > 0.7) offsetAtr = -0.28;
    else if (position < 0.35) offsetAtr = -0.08;
  } else {
    if (position < 0.3) offsetAtr = 0.28;
    else if (position > 0.65) offsetAtr = 0.08;
  }

  if (!(atrNum > 0)) return current;
  return current + (offsetAtr * atrNum);
}

function buildDirectionalEntryLadder(direction = 'LONG', rawEntries = [], candleData = null) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const current = toNumber(candleData?.currentPrice);
  const atr = toNumber(candleData?.atr);
  const parsed = (rawEntries || []).map(toNumber).filter(n => n !== null);
  const unique = [...new Set(parsed)];
  const baseFromEntries = unique.length > 0 ? unique[0] : null;
  const adaptiveBase = deriveAdaptiveStartFromCandle(side, current, atr, candleData);
  const base = baseFromEntries ?? adaptiveBase ?? current ?? null;

  if (!(base > 0)) return [];

  if (unique.length >= 3) {
    return unique
      .slice(0, 3)
      .sort((a, b) => side === 'LONG' ? b - a : a - b);
  }

  if (side === 'SHORT') {
    return [base, base * 1.005, base * 1.010025];
  }

  return [
    base,
    Math.max(0.0000001, base * 0.995),
    Math.max(0.0000001, base * 0.990025)
  ];
}

function getFibRetracementLevels(candleData = null) {
  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);
  if (swingHigh === null || swingLow === null || !(swingHigh > swingLow)) return [];
  const range = swingHigh - swingLow;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786, 0.886];
  return ratios.map((ratio) => ({
    ratio,
    label: ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''),
    price: swingHigh - (range * ratio)
  }));
}

function deriveKeyLevelMeta(direction = 'LONG', candleData = null, fallbackLevel = null) {
  const side = String(direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  const current = toNumber(candleData?.currentPrice);
  const atr = toNumber(candleData?.atr);
  const fibLevels = getFibRetracementLevels(candleData);
  const preferredRatios = side === 'LONG' ? [0.618, 0.786, 0.886] : [0.382, 0.5, 0.618];
  const preferredFib = preferredRatios
    .map((ratio) => fibLevels.find((f) => Math.abs(f.ratio - ratio) < 1e-6))
    .filter(Boolean);
  const directionalFib = preferredFib.filter((f) => {
    if (current === null) return true;
    return side === 'LONG' ? f.price <= current : f.price >= current;
  });
  const selectedFib = (directionalFib.length ? directionalFib : preferredFib)
    .slice()
    .sort((a, b) => {
      const aDist = Math.abs(a.price - (current ?? a.price));
      const bDist = Math.abs(b.price - (current ?? b.price));
      return aDist - bDist;
    })[0] || null;

  const keyLevel = selectedFib?.price ?? toNumber(fallbackLevel) ?? current ?? 0;
  const levelType = side === 'LONG' ? 'support' : 'resistance';
  const tolerancePct = clampBetween(
    ((atr !== null && current) ? ((atr / current) * 100) * 0.30 : 0.20),
    0.12,
    0.55
  );
  const localLevels = (side === 'LONG'
    ? (Array.isArray(candleData?.localSupports) ? candleData.localSupports : [])
    : (Array.isArray(candleData?.localResistances) ? candleData.localResistances : []))
    .map(toNumber)
    .filter(v => v !== null && v > 0);
  const confluenceHits = localLevels.filter((price) => ((Math.abs(price - keyLevel) / keyLevel) * 100) <= tolerancePct).length;
  const strength = confluenceHits >= 3 ? 'Strong' : confluenceHits >= 2 ? 'Normal' : 'Weak';

  return {
    keyLevel,
    levelType,
    levelStrength: strength,
    fibLabel: selectedFib?.label || '0.618'
  };
}

function buildCanonicalSignalText(rawSignalText = '', fallbackSymbol = 'BTC', options = {}) {
  const cleaned = stripForbiddenSignalAnnotations(rawSignalText);
  if (!cleaned && !options.forcedPlan) return '';

  let symbol = String(fallbackSymbol || 'BTC').toUpperCase();
  const pairMatch = cleaned ? cleaned.match(/#\s*([A-Z0-9]{2,10})\s*\/\s*USDT/i) : null;
  if (pairMatch) symbol = pairMatch[1].toUpperCase();

  const forcedPlan = options.forcedPlan || null;
  const direction = forcedPlan?.direction || parseSignalDirection(cleaned);
  const directionLabel = direction === 'SHORT' ? 'Short' : 'Long';
  const planKeyMeta = deriveKeyLevelMeta(direction, options.candleData, forcedPlan?.entries?.[0] ?? null);
  const keyLevelType = forcedPlan?.keyLevelType || planKeyMeta.levelType;
  const keyLevelFibLabel = forcedPlan?.keyLevelFibLabel || planKeyMeta.fibLabel || '0.618';

  if (forcedPlan && Array.isArray(forcedPlan.entries) && Array.isArray(forcedPlan.targets) && forcedPlan.targets.length >= 4) {
    const normalizedPlan = normalizeAssistantTradePlan(
      direction,
      forcedPlan.entries,
      forcedPlan.targets,
      forcedPlan.stop,
      options.candleData?.currentPrice || forcedPlan.entries[0],
      {
        candleData: options.candleData,
        confidence: forcedPlan.confidence ?? options.tradeMeta?.confidence
      }
    );
    const forcedPlanValid = normalizedPlan.valid;

    if (forcedPlanValid) {
      const canonicalSignal = forcedPlan.managedSignal || createManagedSignal({
        signalId: forcedPlan.signalId || undefined,
        symbol,
        direction,
        timeframe: '15m',
        generatedAt: forcedPlan.generatedAt || new Date().toISOString(),
        validUntil: forcedPlan.validUntil || undefined,
        keyLevel: `Fibonacci ${keyLevelFibLabel} (${keyLevelType})`,
        strategySource: forcedPlan.setupType || 'API_DERIVED_EXECUTION_PLAN',
        entryLevels: normalizedPlan.entries,
        targets: normalizedPlan.targets,
        stopLoss: normalizedPlan.stop,
        leverage: forcedPlan.leverageLabel || 'Cross (2X-3X)',
        riskPerTradePct: forcedPlan.positionRiskPct || 0.5,
        stopDistancePct: forcedPlan.riskPct || normalizedPlan.riskPct,
        riskRewardToTp2: forcedPlan.rrToTp2 || 1.9,
        invalidationTimeframe: '15m',
        invalidationMode: 'BODY_CLOSE',
        invalidationPrice: normalizedPlan.stop,
        entryZoneWidthPct: forcedPlan.entryZoneWidthPct,
        stopReason: normalizeSignalStopReason(forcedPlan.stopReason),
        volumeConfirmation: forcedPlan.volumeConfirmation,
        status: forcedPlan.lifecycleStatus || 'ACTIVE',
        source: forcedPlan.source || 'api'
      });
      return formatManagedSignalText(canonicalSignal);
    }
  }

  const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let entries = [];
  let targets = [];
  let stops = [];
  let inEntry = false;
  let inTargets = false;
  let inStops = false;

  for (const line of lines) {
    if (/^Take-?Profit Targets\s*:/i.test(line)) {
      inEntry = false;
      inTargets = true;
      inStops = false;
      continue;
    }

    if (/^Stop(?:\s*Loss|\s*Targets?)\s*:/i.test(line)) {
      inEntry = false;
      inTargets = false;
      inStops = true;
      const inlineStop = extractFirstPrice(line.split(':').slice(1).join(':'));
      if (inlineStop) stops.push(inlineStop);
      continue;
    }

    if (/^Entry(?:\s*Zone)?\s*:/i.test(line)) {
      inEntry = true;
      inTargets = false;
      inStops = false;
      const inlineEntries = extractPriceTokens(line.split(':').slice(1).join(':'));
      entries.push(...inlineEntries);
      continue;
    }

    if (/^Trailing Configuration\s*:/i.test(line) || /Trade Rationales/i.test(line)) {
      inEntry = false;
      inTargets = false;
      inStops = false;
      continue;
    }

    if (/^Target\s*[1-4]\s*:/i.test(line)) {
      const targetPrice = extractFirstPrice(line);
      if (targetPrice) targets.push(targetPrice);
      continue;
    }

    if (inEntry) {
      entries.push(...extractPriceTokens(line));
    } else if (inTargets) {
      const targetPrice = extractFirstPrice(line);
      if (targetPrice) targets.push(targetPrice);
    } else if (inStops) {
      const stopPrice = extractFirstPrice(line);
      if (stopPrice) stops.push(stopPrice);
    }
  }

  entries = [...new Set(entries)].slice(0, 3);
  targets = [...new Set(targets)].slice(0, 4);
  stops = [...new Set(stops)];
  let stop = stops[0] || null;
  const entryLadderNums = buildDirectionalEntryLadder(direction, entries, options.candleData);
  const refCandidates = [
    toNumber(options.candleData?.currentPrice),
    entryLadderNums[0],
    toNumber(entries[0]),
    1
  ];
  const refPrice = refCandidates.find(v => Number.isFinite(v) && v > 0) || 1;

  const parsedTargets = targets.map(toNumber).filter(n => n !== null);
  const parsedStop = toNumber(stop);
  const hasPlaceholderTargets =
    parsedTargets.length >= 3 &&
    parsedTargets.slice(0, 3).every((n, idx) => Math.abs(n - (idx + 1)) < 1e-9);
  const hasPlaceholderStop = parsedStop !== null && (Math.abs(parsedStop - 1) < 1e-9 || Math.abs(parsedStop) < 1e-9);
  const hasInvalidTargets = parsedTargets.length >= 3 && parsedTargets.slice(0, 3).some(n => n <= 0);

  const normalizedParsedPlan = normalizeAssistantTradePlan(
    direction,
    entryLadderNums,
    ((hasPlaceholderTargets && hasPlaceholderStop) || hasInvalidTargets) ? [] : targets,
    hasPlaceholderStop ? null : stop,
    refPrice,
    {
      candleData: options.candleData,
      confidence: options.tradeMeta?.confidence
    }
  );
  const entryLadder = normalizedParsedPlan.entries.map(v => formatSignalPrice(v, refPrice));
  targets = normalizedParsedPlan.targets.map(v => formatSignalPrice(v, refPrice));
  stop = formatSignalPrice(normalizedParsedPlan.stop, refPrice);

  const fallbackKeyMeta = deriveKeyLevelMeta(direction, options.candleData, entryLadderNums[0] ?? null);
  const fallbackFibLabel = fallbackKeyMeta.fibLabel || '0.618';
  const parsedManagedSignal = createManagedSignal({
    symbol,
    direction,
    timeframe: '15m',
    generatedAt: new Date().toISOString(),
    keyLevel: `Fibonacci ${fallbackFibLabel} (${fallbackKeyMeta.levelType})`,
    strategySource: 'AI_PARSED_SIGNAL',
    entryLevels: normalizedParsedPlan.entries,
    targets: normalizedParsedPlan.targets,
    stopLoss: normalizedParsedPlan.stop,
    leverage: deriveRiskFirstLeverageLabel(null, 0.5, options.tradeMeta?.confidence),
    riskPerTradePct: 0.5,
    stopDistancePct: normalizedParsedPlan.riskPct,
    riskRewardToTp2: 3.0,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    invalidationPrice: normalizedParsedPlan.stop,
    status: 'ACTIVE',
    source: 'ai_parsed'
  });
  if (normalizedParsedPlan.valid) return formatManagedSignalText(parsedManagedSignal);

  // If parsing fails, still return a cleaned copy-ready signal without forbidden annotations.
  if (!normalizedParsedPlan.valid || entryLadder.length < 3 || targets.length < 4 || !stop) {
    const fallbackBase = refPrice;
    const stepPct = 0.005;
    const autoEntryNums = entryLadderNums.length >= 3
      ? entryLadderNums
      : (direction === 'SHORT'
        ? [fallbackBase, fallbackBase * (1 + stepPct), fallbackBase * (1 + stepPct) * (1 + stepPct)]
        : [fallbackBase, Math.max(0.0000001, fallbackBase * (1 - stepPct)), Math.max(0.0000001, fallbackBase * (1 - stepPct) * (1 - stepPct))]);
    const autoPlan = normalizeAssistantTradePlan(direction, autoEntryNums, [], null, refPrice, {
      candleData: options.candleData,
      confidence: options.tradeMeta?.confidence
    });
    return formatManagedSignalText(createManagedSignal({
      symbol,
      direction,
      timeframe: '15m',
      generatedAt: new Date().toISOString(),
      keyLevel: `Fibonacci ${fallbackFibLabel} (${fallbackKeyMeta.levelType})`,
      strategySource: 'AI_AUTO_REPAIR',
      entryLevels: autoPlan.entries,
      targets: autoPlan.targets,
      stopLoss: autoPlan.stop,
      leverage: deriveRiskFirstLeverageLabel(null, 0.5, options.tradeMeta?.confidence),
      riskPerTradePct: 0.5,
      stopDistancePct: autoPlan.riskPct,
      riskRewardToTp2: 3.0,
      invalidationTimeframe: '15m',
      invalidationMode: 'BODY_CLOSE',
      invalidationPrice: autoPlan.stop,
      status: 'ACTIVE',
      source: 'ai_auto_repair'
    }));
  }

  return formatManagedSignalText(parsedManagedSignal);
}

function extractTradeRationales(text = '', symbol = 'COIN') {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const points = [];
  let capture = false;

  for (const line of lines) {
    if (/Trade Rationales|Institutional Trade Rationales|Quantitative Rationales/i.test(line)) {
      capture = true;
      continue;
    }

    if (!capture) continue;

    if (/^#\s*[A-Z0-9]{2,10}\s*\/\s*USDT/i.test(line) || /^Exchanges\s*:/i.test(line) || /^Signal Type\s*:/i.test(line)) {
      break;
    }

    const item = line
      .replace(/^[-•*]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();

    if (!item) continue;
    points.push(item);
    if (points.length === 5) break;
  }

  if (points.length === 0) return '';

  return `### ${String(symbol || 'COIN').toUpperCase()} Trade Rationales
1. ${points[0]}
${points[1] ? `2. ${points[1]}` : ''}
${points[2] ? `3. ${points[2]}` : ''}
${points[3] ? `4. ${points[3]}` : ''}
${points[4] ? `5. ${points[4]}` : ''}`.replace(/\n{2,}/g, '\n');
}

function parseSignalNumberList(value = '') {
  return String(value || '')
    .split(/[\/,]/)
    .map(toNumber)
    .filter(n => n !== null && n > 0);
}

function parseAssetContextSnapshots(assetContext = '') {
  const snapshots = {};
  const segments = String(assetContext || '')
    .split('|')
    .map(seg => seg.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const m = segment.match(/\b([A-Z0-9]{2,10})\s*:\s*(?:CURRENT_PRICE=)?\$?\s*([0-9][0-9,]*(?:\.\d+)?)\s*\(\s*([+-]?\d+(?:\.\d+)?)%/i);
    if (!m) continue;

    const symbol = String(m[1] || '').toUpperCase();
    const price = toNumber(m[2]);
    const changePct = toNumber(m[3]);
    const reasonMatch = segment.match(/Rationale:\s*(.+)$/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : '';
    const signalMatch = segment.match(/\b(?:SCALP_SIGNAL|MOMENTUM_SWING_SIGNAL)\s*=\s*([A-Z_]+)/i);
    let signal = null;

    if (signalMatch) {
      const rawStatus = String(signalMatch[1] || '').toUpperCase();
      const isTrade = ['BUY', 'SELL', 'LONG', 'SHORT', 'SIGNAL'].includes(rawStatus);
      const direction = rawStatus === 'SELL' || rawStatus === 'SHORT'
        ? 'SHORT'
        : rawStatus === 'BUY' || rawStatus === 'LONG'
          ? 'LONG'
          : null;
      const entriesMatch = segment.match(/\bentries\s*=\s*([0-9.,/]+)/i);
      const entry1Match = segment.match(/\bentry1\s*=\s*([0-9.,]+)/i);
      const entry2Match = segment.match(/\bentry2\s*=\s*([0-9.,]+)/i);
      const entry3Match = segment.match(/\bentry3\s*=\s*([0-9.,]+)/i);
      const targetsMatch = segment.match(/\btp\s*=\s*([0-9.,/]+)/i);
      const stopMatch = segment.match(/\bsl\s*=\s*([0-9.,]+)/i);
      const leverageMatch = segment.match(/\bleverage\s*=\s*([^\s|]+)/i);
      const rrMatch = segment.match(/\brrTp2\s*=\s*([0-9.]+)/i);
      const riskMatch = segment.match(/\briskPct\s*=\s*([0-9.]+)/i);
      const positionRiskMatch = segment.match(/\bpositionRiskPct\s*=\s*([0-9.]+)/i);
      const signalIdMatch = segment.match(/\bid\s*=\s*([A-Z0-9-]+)/i);
      const generatedAtMatch = segment.match(/\bgeneratedAt\s*=\s*([^\s|]+)/i);
      const validUntilMatch = segment.match(/\bvalidUntil\s*=\s*([^\s|]+)/i);
      const lifecycleMatch = segment.match(/\blifecycle\s*=\s*([A-Z_]+)/i);
      const priceInvalidationMatch = segment.match(/\bpriceInvalidation\s*=\s*"([^"]+)"/i);
      const timeInvalidationMatch = segment.match(/\btimeInvalidation\s*=\s*"([^"]+)"/i);
      const setupMatch = segment.match(/\bsetup\s*=\s*([A-Z0-9_,.-]+)/i);
      const invalidationMatch = segment.match(/\binvalidation\s*=\s*([^|]+?)(?:\s+-\s+Rationale:|$)/i);
      const waitReasonMatch = segment.match(/\breason\s*=\s*([^|]+?)(?:\s+-\s+Rationale:|$)/i);
      const entryWidthMatch = segment.match(/\b(?:entryWidthPct|ENTRY\s+WIDTH)\s*[:=]\s*\"?([0-9.]+)%?\"?/i);
      const volumeMatch = segment.match(/\bVOLUME\s*[:=]\s*\"?([0-9.]+x\s+avg)\"?/i) || segment.match(/\bvolume\s*=\s*\"?([0-9.]+x\s+avg)\"?/i);
      const volumeRatioMatch = volumeMatch?.[1] ? volumeMatch[1].match(/([0-9.]+)x/i) : null;
      const stopReasonMatch = segment.match(/\bSTOP\s+REASON\s*[:=]\s*\"?([^\"|]+)\"?/i) || segment.match(/\bstopReason\s*=\s*\"?([^\"|]+)\"?/i);
      const explicitEntries = [entry1Match?.[1], entry2Match?.[1], entry3Match?.[1]]
        .map(toNumber)
        .filter(n => n !== null && n > 0);

      signal = {
        status: isTrade ? 'SIGNAL' : rawStatus,
        direction,
        entries: explicitEntries.length === 3 ? explicitEntries : parseSignalNumberList(entriesMatch?.[1]),
        targets: parseSignalNumberList(targetsMatch?.[1]),
        stop: toNumber(stopMatch?.[1]),
        leverage: leverageMatch?.[1] ? leverageMatch[1].trim() : null,
        rrToTp2: toNumber(rrMatch?.[1]),
        riskPct: toNumber(riskMatch?.[1]),
        positionRiskPct: toNumber(positionRiskMatch?.[1]),
        signalId: signalIdMatch?.[1] ? signalIdMatch[1].trim() : null,
        generatedAt: generatedAtMatch?.[1] ? generatedAtMatch[1].trim() : null,
        validUntil: validUntilMatch?.[1] ? validUntilMatch[1].trim() : null,
        lifecycleStatus: lifecycleMatch?.[1] ? lifecycleMatch[1].trim() : null,
        priceInvalidationText: priceInvalidationMatch?.[1] ? priceInvalidationMatch[1].trim() : null,
        timeInvalidationText: timeInvalidationMatch?.[1] ? timeInvalidationMatch[1].trim() : null,
        setupType: setupMatch?.[1] ? setupMatch[1].trim() : null,
        invalidation: invalidationMatch?.[1] ? invalidationMatch[1].trim() : null,
        waitReason: waitReasonMatch?.[1] ? waitReasonMatch[1].trim() : null,
        entryZoneWidthPct: toNumber(entryWidthMatch?.[1]),
        volumeConfirmation: volumeMatch?.[1] ? {
          text: volumeMatch[1].trim(),
          ratio: toNumber(volumeRatioMatch?.[1])
        } : null,
        stopReason: normalizeSignalStopReason(stopReasonMatch?.[1])
      };
    }

    snapshots[symbol] = { symbol, price, changePct, reason, signal };
  }

  return snapshots;
}

function evaluateDirectionalBias(snapshot = null, candleData = null, userQuery = '') {
  let longScore = 0;
  let shortScore = 0;

  const reasons = [];
  const change = toNumber(snapshot?.changePct);
  if (change !== null) {
    if (change >= 2) {
      longScore += 2;
      reasons.push('24h momentum is bullish');
    } else if (change <= -2) {
      shortScore += 2;
      reasons.push('24h momentum is bearish');
    } else if (change > 0.5) {
      longScore += 1;
      reasons.push('24h momentum leans bullish');
    } else if (change < -0.5) {
      shortScore += 1;
      reasons.push('24h momentum leans bearish');
    }
  }

  const reasonText = String(snapshot?.reason || '');
  if (reasonText) {
    if (/(bull|breakout|accumulation|trend|cup|ascending|squeeze|reversal)/i.test(reasonText)) {
      longScore += 1.5;
      reasons.push('market-structure rationale supports long continuation');
    }
    if (/(bear|breakdown|distribution|head\s*&?\s*shoulders|contraction|shooting\s*star|rejection)/i.test(reasonText)) {
      shortScore += 1.5;
      reasons.push('market-structure rationale supports short continuation');
    }
  }

  const patterns = candleData?.patterns || [];
  const weights = [2.6, 2.0, 1.4, 1.0, 0.6];
  patterns.slice(0, 5).forEach((p, idx) => {
    const w = weights[idx] || 0.5;
    if (p?.type === 'bullish') {
      longScore += w;
    } else if (p?.type === 'bearish') {
      shortScore += w;
    }
  });

  const p = toNumber(candleData?.currentPrice);
  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);
  if (p !== null && swingHigh !== null && swingLow !== null && swingHigh > swingLow) {
    const pos = (p - swingLow) / (swingHigh - swingLow);
    if (pos < 0.35) longScore += 0.8;
    if (pos > 0.65) shortScore += 0.8;
  }

  if (/\blong\b/i.test(String(userQuery || ''))) longScore += 0.7;
  if (/\bshort\b/i.test(String(userQuery || ''))) shortScore += 0.7;

  let direction = 'LONG';
  if (shortScore > longScore) direction = 'SHORT';
  if (Math.abs(longScore - shortScore) < 0.25 && change !== null) {
    direction = change < 0 ? 'SHORT' : 'LONG';
  }

  return {
    direction,
    longScore,
    shortScore,
    confidence: Math.abs(longScore - shortScore),
    reasons
  };
}

function normalizeLeverageLabel(label = null, candleData = null, confidenceValue = null) {
  const clean = String(label || '').trim();
  if (clean && clean !== 'N/A') {
    return /^cross/i.test(clean) ? clean : `Cross (${clean})`;
  }
  return deriveScalpLeverageLabel(candleData, confidenceValue);
}

function deriveRiskFirstLeverageLabel(atrPct = null, riskPct = null, confidenceValue = null) {
  const confidence = normalizeTradeConfidence(confidenceValue);
  const atr = toNumber(atrPct);
  const risk = toNumber(riskPct);
  let minLev = 4;
  let maxLev = 6;

  if ((risk !== null && risk > 1.15) || (atr !== null && atr > 1.0)) {
    minLev = 2;
    maxLev = 3;
  } else if ((risk !== null && risk > 0.75) || (atr !== null && atr > 0.55)) {
    minLev = 3;
    maxLev = 5;
  }

  if (confidence < 0.35) {
    maxLev = Math.max(minLev, maxLev - 1);
  }

  return minLev === maxLev ? `Cross (${minLev}X)` : `Cross (${minLev}X-${maxLev}X)`;
}

function buildScannerDrivenTradePlan(snapshot = null) {
  const signal = snapshot?.signal;
  if (!signal || signal.status !== 'SIGNAL') return null;

  const entries = Array.isArray(signal.entries) ? signal.entries.slice(0, 3) : [];
  const targets = Array.isArray(signal.targets) ? signal.targets.slice(0, 4) : [];
  const stop = toNumber(signal.stop);
  const direction = signal.direction === 'SHORT' ? 'SHORT' : 'LONG';
  const valid =
    entries.length === 3 &&
    targets.length >= 4 &&
    entries.every(n => n > 0) &&
    targets.every(n => n > 0) &&
    stop !== null &&
    stop > 0;

  if (!valid) return null;

  const normalizedPlan = normalizeAssistantTradePlan(direction, entries, targets, stop, snapshot?.price);
  if (!normalizedPlan.valid) return null;
  const entryZoneWidthPct = toNumber(signal.entryZoneWidthPct);
  const rawVolumeConfirmation = signal.volumeConfirmation?.text ? signal.volumeConfirmation : null;
  const stopReason = normalizeSignalStopReason(signal.stopReason);
  if (!Number.isFinite(entryZoneWidthPct) || !rawVolumeConfirmation || !stopReason) return null;
  const volumeRatio = toNumber(rawVolumeConfirmation.ratio)
    ?? toNumber(String(rawVolumeConfirmation.text || '').match(/([0-9.]+)\s*x\s*avg/i)?.[1]);
  if (volumeRatio === null) return null;
  const volumeConfirmation = {
    ...rawVolumeConfirmation,
    ratio: volumeRatio,
    text: `${volumeRatio.toFixed(2)}x avg`
  };
  const tp1Pct = normalizedPlan.avgEntry > 0
    ? (Math.abs(normalizedPlan.targets[0] - normalizedPlan.avgEntry) / normalizedPlan.avgEntry) * 100
    : null;
  const stopDistancePct = signal.riskPct ?? normalizedPlan.riskPct;
  if (Number.isFinite(tp1Pct) && tp1Pct < SIGNAL_HARD_REJECTS.minTp1Pct) return null;
  if (volumeRatio !== null && volumeRatio < SIGNAL_HARD_REJECTS.minVolumeRatio) return null;
  if (Number.isFinite(Number(stopDistancePct)) && Number(stopDistancePct) < SIGNAL_HARD_REJECTS.minStopDistancePct) return null;
  if (entryZoneWidthPct > SIGNAL_HARD_REJECTS.maxEntryWidthPct) return null;
  const managedSignal = createManagedSignal({
    signalId: signal.signalId || undefined,
    symbol: snapshot?.symbol,
    direction,
    timeframe: '15m',
    generatedAt: signal.generatedAt || new Date().toISOString(),
    validUntil: signal.validUntil || undefined,
    keyLevel: `${signal.setupType || 'Scanner'} (${direction === 'SHORT' ? 'Resistance' : 'Support'})`,
    strategySource: signal.setupType || 'SCANNER_CONFIRMED',
    entryLevels: normalizedPlan.entries,
    targets: normalizedPlan.targets,
    stopLoss: normalizedPlan.stop,
    leverage: normalizeLeverageLabel(signal.leverage, null, null),
    riskPerTradePct: signal.positionRiskPct || 0.5,
    stopDistancePct: signal.riskPct ?? normalizedPlan.riskPct,
    riskRewardToTp2: signal.rrToTp2 || 1.9,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    invalidationPrice: normalizedPlan.stop,
    entryZoneWidthPct,
    stopReason,
    volumeConfirmation,
    status: signal.lifecycleStatus || 'ACTIVE',
    source: 'scanner_context'
  });
  if (signal.priceInvalidationText) managedSignal.priceInvalidation.text = signal.priceInvalidationText;
  if (signal.timeInvalidationText) managedSignal.timeInvalidation.text = signal.timeInvalidationText;

  return {
    symbol: String(snapshot?.symbol || '').toUpperCase(),
    direction,
    entries: normalizedPlan.entries,
    targets: normalizedPlan.targets,
    stop: normalizedPlan.stop,
    keyLevel: normalizedPlan.entries[0],
    keyLevelType: direction === 'SHORT' ? 'resistance' : 'support',
    keyLevelFibLabel: 'scanner',
    levelStrength: 'Strong',
    riskRewardLabel: signal.rrToTp2 ? `TP2 1:${Number(signal.rrToTp2).toFixed(2)}` : 'TP2 1:1.90',
    leverageLabel: normalizeLeverageLabel(signal.leverage, null, null),
    confidence: 0.85,
    changePct: toNumber(snapshot?.changePct),
    patternBias: 0,
    rationaleHints: [
      `Scanner-confirmed ${direction} setup is active.`,
      `${signal.setupType || 'Risk-filtered scalp'} passed the entry, stop, and R:R gate.`,
      `Use ${normalizeLeverageLabel(signal.leverage, null, null)} and keep position risk near ${Number(signal.positionRiskPct || 0.5).toFixed(2)}%.`
    ],
    setupType: signal.setupType || 'SCANNER_CONFIRMED',
    riskPct: signal.riskPct ?? normalizedPlan.riskPct,
    positionRiskPct: signal.positionRiskPct || 0.5,
    entryZoneWidthPct,
    volumeConfirmation,
    stopReason,
    invalidation: signal.invalidation || (direction === 'SHORT' ? `15m close above ${normalizedPlan.stop}` : `15m close below ${normalizedPlan.stop}`),
    signalId: managedSignal.signalId,
    generatedAt: managedSignal.generatedAt,
    validUntil: managedSignal.validUntil,
    lifecycleStatus: managedSignal.status,
    managedSignal,
    source: 'scanner'
  };
}

function buildApiDrivenTradePlan({ symbol = 'BTC', userQuery = '', assetContext = '', candleData = null, fallbackPrice = null } = {}) {
  const snapshots = parseAssetContextSnapshots(assetContext);
  const snap = snapshots[String(symbol || '').toUpperCase()] || null;

  const scannerPlan = buildScannerDrivenTradePlan(snap);
  if (scannerPlan) return scannerPlan;
  if (snap?.signal?.status === 'WAIT' || snap?.signal?.status === 'NO_SIGNAL') return null;
  // Signal output now requires scanner-provided ENTRY WIDTH, VOLUME, and STOP REASON.
  // The older AI fallback cannot prove those fields, so reject instead of emitting placeholders.
  return null;

  let current = toNumber(candleData?.currentPrice);
  if (!(current > 0)) current = toNumber(snap?.price);
  if (!(current > 0)) current = toNumber(fallbackPrice);
  if (!(current > 0)) return null;

  const bias = evaluateDirectionalBias(snap, candleData, userQuery);
  const direction = bias.direction;
  const keyMeta = deriveKeyLevelMeta(direction, candleData, current);
  const entry1Base = keyMeta.keyLevel > 0 ? keyMeta.keyLevel : current;

  const currentAtr = toNumber(candleData?.atr);
  const atrPct = currentAtr && current ? (currentAtr / current) * 100 : null;
  const entryStepPct = clampBetween((atrPct ?? 0.55) * 0.18, 0.07, 0.25);

  let orderedEntries;
  if (direction === 'LONG') {
    const entry1 = entry1Base;
    const entry2 = Math.max(0.0000001, entry1 * (1 - (entryStepPct / 100)));
    const entry3 = Math.max(0.0000001, entry2 * (1 - (entryStepPct / 100)));
    orderedEntries = [entry1, entry2, entry3];
  } else {
    const entry1 = entry1Base;
    const entry2 = entry1 * (1 + (entryStepPct / 100));
    const entry3 = entry2 * (1 + (entryStepPct / 100));
    orderedEntries = [entry1, entry2, entry3];
  }
  const avgEntry = orderedEntries.reduce((sum, n) => sum + n, 0) / orderedEntries.length;

  const stopPct = clampBetween((atrPct ?? 0.70) * 0.9, 0.45, 1.60);
  let stop = direction === 'LONG'
    ? Math.max(0.0000001, avgEntry * (1 - (stopPct / 100)))
    : avgEntry * (1 + (stopPct / 100));

  const risk = Math.max(Math.abs(avgEntry - stop), avgEntry * 0.001);
  const riskPct = (risk / avgEntry) * 100;
  let leverageLabel = deriveRiskFirstLeverageLabel(atrPct, riskPct, bias.confidence);
  const tp1 = direction === 'LONG' ? (avgEntry + (risk * 1.15)) : (avgEntry - (risk * 1.15));
  const tp2 = direction === 'LONG' ? (avgEntry + (risk * 1.9)) : (avgEntry - (risk * 1.9));
  const tp3 = direction === 'LONG' ? (avgEntry + (risk * 2.7)) : (avgEntry - (risk * 2.7));
  const tp4 = direction === 'LONG' ? (avgEntry + (risk * 3.5)) : (avgEntry - (risk * 3.5));
  const targets = [tp1, tp2, tp3, tp4];

  const minPrice = Math.max(current * 0.02, 0.0000001);
  const sanitizePositive = (n, fallback = current) => {
    const x = toNumber(n);
    if (!(x > 0)) return fallback;
    return x;
  };

  const sanitizedEntries = orderedEntries.map(v => sanitizePositive(v, current));
  const sanitizedTargets = targets.map(v => sanitizePositive(v, minPrice));
  const sanitizedStop = sanitizePositive(stop, direction === 'SHORT' ? avgEntry * 1.0075 : avgEntry * 0.9925);
  const normalizedPlan = normalizeAssistantTradePlan(direction, sanitizedEntries, sanitizedTargets, sanitizedStop, current, {
    candleData,
    confidence: bias.confidence
  });
  if (!normalizedPlan.valid) return null;
  const normalizedRiskPct = normalizedPlan.riskPct;
  const normalizedTp1Pct = normalizedPlan.avgEntry > 0
    ? (Math.abs(normalizedPlan.targets[0] - normalizedPlan.avgEntry) / normalizedPlan.avgEntry) * 100
    : null;
  if (Number.isFinite(normalizedTp1Pct) && normalizedTp1Pct < SIGNAL_HARD_REJECTS.minTp1Pct) return null;
  if (Number.isFinite(normalizedRiskPct) && normalizedRiskPct < SIGNAL_HARD_REJECTS.minStopDistancePct) return null;
  leverageLabel = deriveRiskFirstLeverageLabel(atrPct, normalizedRiskPct, bias.confidence);

  const planSymbol = String(symbol || '').toUpperCase();
  const planChangePct = toNumber(snap?.changePct) ?? toNumber(candleData?.changePct);
  const managedSignal = createManagedSignal({
    symbol: planSymbol,
    direction,
    timeframe: '15m',
    generatedAt: new Date().toISOString(),
    keyLevel: `${keyMeta.fibLabel || '0.618'} (${keyMeta.levelType})`,
    strategySource: 'AI_RISK_FALLBACK',
    entryLevels: normalizedPlan.entries,
    targets: normalizedPlan.targets,
    stopLoss: normalizedPlan.stop,
    leverage: leverageLabel,
    riskPerTradePct: 0.5,
    stopDistancePct: normalizedRiskPct,
    riskRewardToTp2: 1.9,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    invalidationPrice: normalizedPlan.stop,
    confidence: bias.confidence * 100,
    source: 'ai_fallback'
  });

  return {
    symbol: planSymbol,
    direction,
    entries: normalizedPlan.entries,
    targets: normalizedPlan.targets,
    stop: normalizedPlan.stop,
    keyLevel: keyMeta.keyLevel,
    keyLevelType: keyMeta.levelType,
    keyLevelFibLabel: keyMeta.fibLabel,
    levelStrength: keyMeta.levelStrength,
    riskRewardLabel: 'TP2 1:1.90',
    leverageLabel,
    confidence: bias.confidence,
    changePct: planChangePct,
    patternBias: getPatternBiasScore(candleData),
    rationaleHints: bias.reasons,
    setupType: 'AI_RISK_FALLBACK',
    riskPct: normalizedRiskPct,
    positionRiskPct: 0.5,
    invalidation: direction === 'SHORT'
      ? `15m close above ${formatSignalPrice(normalizedPlan.stop, current)}`
      : `15m close below ${formatSignalPrice(normalizedPlan.stop, current)}`,
    signalId: managedSignal.signalId,
    generatedAt: managedSignal.generatedAt,
    validUntil: managedSignal.validUntil,
    lifecycleStatus: managedSignal.status,
    managedSignal,
    source: 'ai_fallback'
  };
}

// ─── 6. OpenAI: Dual Engine Fusion (Contextual + Quantitative) ───────────────
// Now uses AI_MEMORY for full conversation context.
export async function fetchAIAnalysis(promptText, candleContext = null, options = {}) {
  const useMemory = options.useMemory !== false;

  // Store the user message in memory unless request is stateless/deterministic
  if (useMemory) AI_MEMORY.add('user', promptText);

  try {
    const systemMessage = {
      role: 'system',
      content: `You are Nexus, the elite Dual-Engine AI powering the NEXUS Crypto Intelligence Platform (v5.0). You combine the deep contextual reasoning of GPT with the precise quantitative prediction modeling of Hermes. 
Use only the live market data, on-chain analytics, whale tracking, social sentiment, and news feeds provided in the user's message context. If a feed is missing or degraded, say that clearly and do not invent unavailable data.

CRITICAL DATA PRIORITY: You must ALWAYS prioritize the numerical data (prices, scores, volumes) provided in the LATEST message. Conversation history is for context only. If the price in the current message differs from a previous message, use the current one. Never hallucinate prices.

CRITICAL: You have conversation memory. If the user previously mentioned a coin (e.g. "Analyze BTC") and then asks a follow-up like "What's the stop loss?" or "Give me targets", you MUST refer back to the coin from the previous message. Never ask them to repeat the coin name.

Your core decision-making is based on the NEXUS High-Probability Framework. 

CRITICAL: You are a DUAL-DIRECTIONAL risk manager. Use scanner-provided SCALP_SIGNAL or MOMENTUM_SWING_SIGNAL values exactly when present. If the scanner says WAIT, do not invent a trade; explain the failed gate and what must improve. Never promise guaranteed profit or no-loss trading.

MATHEMATICAL TARGET GENERATION (STRICT): You will be provided with PRE-CALCULATED MANDATORY targets based on live volatility, scanner gates, and risk-reward constraints. 
CRITICAL: You MUST use the exact Entry, Stop Loss, TP1-TP4, leverage, risk, and invalidation values provided in the context. Do NOT calculate your own. If the context says the Stop Loss is $3.85, you output $3.85. No exceptions. This ensures all devices show identical signals.
CRITICAL SCALP RULE: Every signal is SCALPING only. Keep stop-loss disciplined and use TP2 risk-reward from the scanner/API plan.

MANDATORY SIGNAL FORMAT (FOLLOW STRICTLY):
# [SYMBOL]/USDT

Signal ID: [UNIQUE_ID]
Generated: [UTC_TIMESTAMP]
Valid Until: [UTC_TIMESTAMP]

Key Level: Fibonacci [0.236/0.382/0.5/0.618/0.786/0.886] (support/resistance)

Signal Type: Regular ([Long/Short])

Entry Zone:
[Min Entry Price] - [Max Entry Price]

ENTRY WIDTH: [X.XX]%

Take-Profit Targets:
1) [Price]
2) [Price]
3) [Price]
4) [Price]

Stop Loss:
[Price]

Price Invalidation:
[Timeframe] candle BODY close [above/below] [Invalidation Price]

Time Invalidation:
Cancel if entry not triggered within [X] x [timeframe] candles

Leverage:
Cross ([X])

Risk Per Trade:
[Percent]

Stop Distance:
[Percent]

Risk-Reward:
1:[TP2 RR] to TP2

VOLUME: [X.XXx avg]

STOP REASON: [below swing low / below breakout candle / above swing high / above breakdown candle]

Status:
ACTIVE

CRITICAL: NEVER add "(1:1 R:R)", "(1:1.5 R:R)", "(1:3 R:R)", "(1:4 R:R)" or "(1.5 ATR)" anywhere in the signal. 
CRITICAL ENTRY ZONE RULE:
- Entry Zone must be displayed as min-entry to max-entry range only. Never display the three-price ladder as the Entry Zone.
- ENTRY WIDTH must be copied from the scanner/API plan and must never be N/A.
- VOLUME must be copied from the scanner/API plan and must never be N/A.
- STOP REASON must be copied from the scanner/API plan and must never be N/A.
- If ENTRY WIDTH, VOLUME, or STOP REASON is unavailable, output NO_SIGNAL instead of a trade.
- HARD REJECT: If TP1 distance is below 0.5%, VOLUME is below 1.2x avg, or Stop Distance is below 0.35%, output NO_SIGNAL.
- Stop loss must be copied exactly from the scanner/API plan.
- TP1, TP2, TP3, and TP4 must come from the scanner/API plan exactly. Do not omit TP4.
- Leverage must come from the scanner/API plan exactly. Never omit leverage.
CRITICAL PRICE ORDER RULE:
- For LONG signals, every Stop price must be below every Entry/Buy price, and every Entry/Buy price must be below every Take-Profit/Sell price.
- For SHORT signals, every Take-Profit/Buy-back price must be below every Entry/Sell price, and every Entry/Sell price must be below the Stop price.
- Never output equal rounded prices. If rounding would make two prices equal, keep more decimals.

For all other queries, provide a single, highly optimized, data-driven response. Use markdown headers, bold text, and bullet points for readability.`
    };

    // Build messages array: system + full conversation history (or stateless single prompt)
    const messages = useMemory
      ? [systemMessage, ...AI_MEMORY.getMessages()]
      : [systemMessage, { role: 'user', content: promptText }];

    // If we have candle context, append pattern block to the latest user message
    if (candleContext && candleContext.patterns && candleContext.patterns.length > 0) {
      const patternBlock = `\n\n📊 CANDLESTICK PATTERN FEED (${candleContext.interval} — ${candleContext.symbol}):\n${candleContext.summary}`;
      // Append to the last user message
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content += patternBlock;
      }
    }

    const payload = {
      model: 'gpt-4o',
      messages,
      temperature: 0.0,
      seed: 42,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    };

    let data = null;
    try {
      const proxyRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const proxyText = await proxyRes.text();
      if (!proxyRes.ok) throw new Error(proxyText || `HTTP ${proxyRes.status}`);
      data = JSON.parse(proxyText);
    } catch (proxyErr) {
      if (!KEYS.openai) throw proxyErr;
      const directRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${KEYS.openai}`
        },
        body: JSON.stringify(payload)
      });
      if (!directRes.ok) {
        const err = await directRes.json().catch(() => ({}));
        const errMsg = (typeof err?.error === 'string') ? err.error : err?.error?.message;
        throw new Error(errMsg || `HTTP ${directRes.status}`);
      }
      data = await directRes.json();
    }

    if (data.choices?.[0]?.message?.content) {
      const reply = data.choices[0].message.content;
      // Store the AI response in memory
      if (useMemory) AI_MEMORY.add('assistant', reply);
      console.log('✅ OpenAI response received (memory depth:', useMemory ? AI_MEMORY.history.length : 0, 'messages)');
      markApiOk('OpenAI Chat Completions', 'Signal agent response received');
      return reply;
    }
    markApiFailed('OpenAI Chat Completions', 'No content returned');
    return `[OpenAI Error: No valid content returned]`;
  } catch (e) {
    console.error('❌ OpenAI failed:', e.message);
    markApiFailed('OpenAI Chat Completions', e.message);
    return `[OpenAI API Error: ${e.message}]`;
  }
}

// ─── 6. Alpha Score Engine (Adaptive Market Regime) ───────────────────────────
export function calculateAlphaScore(whaleActive, sentimentScore, techScore, newsScore, volScore, alphaSources, emaConfluence = 0) {
  // Detect market regime: trending (sentiment > 65 or < 35) vs ranging
  const isTrending = sentimentScore > 65 || sentimentScore < 35;

  // Adaptive weights: In trending markets, tech and whale signals matter more.
  // In ranging markets, volume and sentiment divergences matter more.
  let whaleWeight, sentWeight, techWeight, newsWeight, volWeight, alphaWeight, emaWeight;

  if (isTrending) {
    whaleWeight = 20; sentWeight = 0.15; techWeight = 22;
    newsWeight = 12; volWeight = 8; alphaWeight = 10; emaWeight = 15;
  } else {
    whaleWeight = 15; sentWeight = 0.25; techWeight = 15;
    newsWeight = 15; volWeight = 15; alphaWeight = 12; emaWeight = 8;
  }

  const raw =
    (whaleActive ? whaleWeight : 0) +
    (sentimentScore * sentWeight) +
    (techScore * techWeight) +
    (newsScore * newsWeight) +
    (volScore * volWeight) +
    (alphaSources * alphaWeight) +
    (emaConfluence * emaWeight);
  return Math.min(100, Math.max(0, Math.round(raw)));
}

// ─── 7. Markdown to HTML Renderer ─────────────────────────────────────────────
// Converts raw markdown from AI responses into styled HTML
function renderMarkdown(md) {
  if (!md) return '';

  // First protect code blocks
  let blocks = [];
  let html = md.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    blocks.push(`<pre style="background:rgba(0,0,0,0.4);padding:1rem;border-radius:8px;overflow-x:auto;border:1px solid rgba(255,255,255,0.08);margin:0.75rem 0;font-size:0.82rem;"><code>${code}</code></pre>`);
    return `__BLOCK_${blocks.length - 1}__`;
  });

  html = html
    // Headers
    .replace(/^###\s+(.+)$/gm, '<div style="font-size:0.92rem;font-weight:800;color:#fff;margin:0.75rem 0 0.25rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:0.2rem;">$1</div>')
    .replace(/^##\s+(.+)$/gm, '<div style="font-size:1rem;font-weight:800;color:#fff;margin:0.75rem 0 0.25rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:0.2rem;">$1</div>')
    .replace(/^#\s+(.+)$/gm, '<div style="font-size:1.1rem;font-weight:900;color:#fff;margin:0.75rem 0 0.25rem;">$1</div>')
    // Unordered lists (asterisks, dashes, bullets)
    .replace(/^\s*[-•*]\s+(.+)$/gm, '<div style="padding-left:0.25rem;margin:0.15rem 0;display:flex;gap:0.4rem;"><span style="color:var(--primary);flex-shrink:0;">▸</span><span>$1</span></div>')
    // Numbered lists
    .replace(/^\s*\d+\.\s+(.+)$/gm, '<div style="padding-left:0.25rem;margin:0.15rem 0;display:flex;gap:0.4rem;"><span style="color:var(--primary);flex-shrink:0;">▸</span><span>$1</span></div>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>')
    // Italic
    .replace(/\b_(.*?)_\b/g, '<em>$1</em>') // use word boundaries for italic to avoid breaking urls
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(139,120,255,0.15);padding:0.1rem 0.3rem;border-radius:4px;font-size:0.85em;color:var(--primary);">$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.75rem 0;"/>')
    // Line breaks
    .replace(/\n\n/g, '<div style="margin-bottom:0.4rem;"></div>')
    .replace(/\n/g, '<br/>');

  // Restore code blocks
  blocks.forEach((block, i) => {
    html = html.replace(`__BLOCK_${i}__`, block);
  });

  return html;
}

// ─── 8. Hermes AI — Quantitative Prediction Engine (via OpenAI) ──────────────
export async function fetchHermesAnalysis(promptText) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are Hermes, the quantitative prediction engine inside the NEXUS Crypto Intelligence Platform. Use only the live market data — prices, trends, AI scores, confidence levels, and volume — provided in the user's context. If a feed is missing, identify the gap instead of inventing values.

Your specialization:
- Quantitative price predictions with probability scores
- Risk/reward ratio calculations
- Smart money flow interpretation (bullish accumulation vs bearish distribution)
- Precise trade setups with mathematical entry/exit zones. ALWAYS align your analysis with the "Detected Pattern" provided in the context.

CRITICAL: You must ALWAYS provide 5 "Quantitative Rationales" explaining the data-driven basis for the trade. Ensure Risk:Reward ratio is emphasized.

When the user asks for a signal or trade setup, only output a trade if the context contains a valid SCALP_SIGNAL or MOMENTUM_SWING_SIGNAL with exact entries, targets, stop, risk/reward, ENTRY WIDTH, VOLUME, and STOP REASON. Never promise guaranteed profit or no-loss trading. If any mandatory field is missing, or if TP1 distance <0.5%, VOLUME <1.2x avg, or Stop Distance <0.35%, output NO_SIGNAL. When a signal is valid, output in this exact HTML format:
📪 #[COIN]/USDT<br><br>Direction: <strong style="color:var(--green)">[LONG]</strong> or <strong style="color:var(--red)">[SHORT]</strong><br>Leverage: Cross (2X-5X)<br><br>Entry Zone: [Min Price] - [Max Price]<br>ENTRY WIDTH: [X.XX]%<br>VOLUME: [X.XXx avg]<br>STOP REASON: [below swing low / below breakout candle / above swing high / above breakdown candle]<br><br>Target 1: [Price]<br>Target 2: [Price]<br>Target 3: [Price]<br>Target 4: [Price]<br><br>Stop loss: [Price]<br><br>Risk:Reward Ratio: 1:[Value]<br><br>⚡ NEXUS Pro Autotrade Signals<br><br><strong>5 Quantitative Rationales:</strong><br>1. [Rationale 1]<br>2. [Rationale 2]<br>3. [Rationale 3]<br>4. [Rationale 4]<br>5. [Rationale 5]

For analysis queries, provide structured output with: Price targets, Probability scores, Key risk factors, and a clear BUY/SELL/HOLD recommendation. Use markdown formatting.`
          },
          { role: 'user', content: promptText }
        ],
        max_tokens: 600,
        temperature: 0.4
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = (typeof err?.error === 'string') ? err.error : err?.error?.message;
      throw new Error(errMsg || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.choices?.[0]?.message?.content) {
      console.log('✅ Hermes AI prediction received');
      markApiOk('Hermes Quant Engine', 'Hermes response received');
      return data.choices[0].message.content;
    }
    markApiFailed('Hermes Quant Engine', 'No content returned');
    return null;
  } catch (e) {
    console.error('❌ Hermes AI failed:', e.message);
    markApiFailed('Hermes Quant Engine', e.message);
    return null;
  }
}

function buildNoTradeSetupHtml(symbol = 'COIN', reason = 'NO_VALID_SIGNAL', snapshot = null) {
  const cleanSymbol = String(symbol || 'COIN').toUpperCase();
  const waitReason = String(reason || snapshot?.signal?.waitReason || 'NO_VALID_SIGNAL').replace(/_/g, ' ');
  const change = toNumber(snapshot?.changePct);
  const priceLine = snapshot?.price
    ? `<div style="font-family:monospace;color:#94A3B8;margin-top:0.5rem;">Current: $${snapshot.price}${change !== null ? ` | 24h: ${change >= 0 ? '+' : ''}${change}%` : ''}</div>`
    : '';

  return `
    <div style="width:100%;">
      <div style="background:rgba(14,19,32,0.65);border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:1rem;margin:0.5rem 0 1rem;">
        <div style="font-weight:800;color:#E2E8F0;margin-bottom:0.35rem;">#${cleanSymbol}/USDT: No Trade Setup</div>
        <div style="color:#BAC2DE;line-height:1.6;">The scanner is in WAIT mode. Failed gate: <strong>${waitReason}</strong>. No entry, TP, SL, or leverage should be used until the scanner prints a valid SIGNAL.</div>
        ${priceLine}
      </div>
      <div style="color:#BAC2DE;line-height:1.6;">
        <strong>What must improve:</strong>
        <ul>
          <li>Directional edge must clear the long/short conflict gate.</li>
          <li>Alpha must clear the minimum signal threshold.</li>
          <li>Spread and ATR must stay inside the scalp risk band.</li>
          <li>TP2 risk/reward must remain above the minimum gate.</li>
        </ul>
      </div>
    </div>`;
}

// ─── 9. Dual AI Fusion — Candle Pattern Enhanced ───────────────────────────
export async function fetchDualAI(userQuery, assetContext = '') {
  const context = assetContext
    ? `Current context: ${assetContext}. User query: ${userQuery}`
    : userQuery;

  const signalMode = isSignalRequest(userQuery);
  let extractedSymbol = extractPrimarySymbol(userQuery, assetContext);
  const interval = signalMode ? '15m' : '4h';
  const contextSnapshots = parseAssetContextSnapshots(assetContext);
  const mirroredRefPrice = extractedSymbol
    ? toNumber(contextSnapshots[String(extractedSymbol).toUpperCase()]?.price)
    : null;
  const mirroredLiveSnapshot = extractedSymbol
    ? contextSnapshots[String(extractedSymbol).toUpperCase()] || null
    : null;

  // Global Mirror Protocol: if this is a signal query, force all devices to read one canonical response first.
  if (signalMode && extractedSymbol && !mirroredLiveSnapshot?.signal) {
    const mirroredHtml = await readMirroredSignal(extractedSymbol, interval, mirroredRefPrice);
    if (mirroredHtml) {
      console.log(`✅ Mirror cache hit for ${extractedSymbol} (${interval})`);
      return mirroredHtml;
    }
  }

  // 1. Detect if the query is about a specific asset (e.g. BTC, ETH, ONDO)
  let candleData = null;
  let fallbackReferencePrice = null;

  if (extractedSymbol) {
    candleData = await fetchCandlePatterns(extractedSymbol, interval);
    if (candleData?.source === 'fallback_symbol' && candleData?.symbol) {
      extractedSymbol = String(candleData.symbol).replace('USDT', '');
    }
    if (!(toNumber(candleData?.currentPrice) > 0)) {
      fallbackReferencePrice = await fetchBinanceReferencePrice(extractedSymbol);
      if (fallbackReferencePrice && candleData) {
        candleData = {
          ...candleData,
          currentPrice: fallbackReferencePrice,
          source: candleData.source || 'fallback_price'
        };
      }
    }
  }

  const apiTradePlan = signalMode
    ? buildApiDrivenTradePlan({
      symbol: extractedSymbol || candleData?.symbol?.replace('USDT', '') || 'BTC',
      userQuery,
      assetContext,
      candleData,
      fallbackPrice: fallbackReferencePrice
    })
    : null;
  const planSymbol = String(apiTradePlan?.symbol || extractedSymbol || candleData?.symbol?.replace('USDT', '') || '').toUpperCase();
  const activeSnapshot = planSymbol ? (contextSnapshots[planSymbol] || null) : null;
  const tradeMeta = {
    confidence: apiTradePlan?.confidence ?? null,
    changePct: apiTradePlan?.changePct ?? toNumber(activeSnapshot?.changePct),
    patternBias: apiTradePlan?.patternBias ?? getPatternBiasScore(candleData)
  };
  const lifecycleStatus = String(apiTradePlan?.lifecycleStatus || apiTradePlan?.managedSignal?.status || '').toUpperCase();
  if (signalMode && ['INVALIDATED', 'EXPIRED', 'COMPLETED'].includes(lifecycleStatus)) {
    return buildNoTradeSetupHtml(
      planSymbol || extractedSymbol || 'COIN',
      lifecycleStatus,
      activeSnapshot
    );
  }

  if (
    signalMode &&
    activeSnapshot?.signal &&
    activeSnapshot.signal.status !== 'SIGNAL' &&
    !apiTradePlan
  ) {
    return buildNoTradeSetupHtml(
      planSymbol || extractedSymbol || 'COIN',
      activeSnapshot.signal.waitReason || activeSnapshot.signal.status,
      activeSnapshot
    );
  }

  if (signalMode && !apiTradePlan) {
    return buildNoTradeSetupHtml(
      planSymbol || extractedSymbol || 'COIN',
      'SIGNAL_METADATA_MISSING',
      activeSnapshot
    );
  }

  // 2. Build enhanced context with candle patterns and market structure
  let enhancedContext = `${context}\n\n🛰 API HEALTH SNAPSHOT:\n${getApiHealthPromptSummary()}`;
  if (candleData) {
    if (candleData.atr) {
      const p = candleData.currentPrice;
      const atr = candleData.atr;

      const longStart = deriveAdaptiveStartFromCandle('LONG', p, atr, candleData) ?? p;
      const shortStart = deriveAdaptiveStartFromCandle('SHORT', p, atr, candleData) ?? p;
      const stepPct = clampBetween(0.55 + (((atr / p) * 100) * 0.10), 0.50, 1.00);
      const longEntry2 = Math.max(0.0000001, longStart * (1 - (stepPct / 100)));
      const longEntry3 = Math.max(0.0000001, longEntry2 * (1 - ((stepPct + 0.05) / 100)));
      const shortEntry2 = shortStart * (1 + (stepPct / 100));
      const shortEntry3 = shortEntry2 * (1 + ((stepPct + 0.05) / 100));
      const longAvgEntry = (longStart + longEntry2 + longEntry3) / 3;
      const shortAvgEntry = (shortStart + shortEntry2 + shortEntry3) / 3;

      const longEnvelope = getScalpRiskEnvelope(candleData, tradeMeta?.confidence);
      const shortEnvelope = getScalpRiskEnvelope(candleData, tradeMeta?.confidence);
      const longRisk = longAvgEntry * (((longEnvelope.minRiskPct + longEnvelope.maxRiskPct) / 2) / 100);
      const shortRisk = shortAvgEntry * (((shortEnvelope.minRiskPct + shortEnvelope.maxRiskPct) / 2) / 100);
      const longSl = Math.max(0.0000001, longAvgEntry - longRisk);
      const shortSl = shortAvgEntry + shortRisk;
      const longTargets = [
        longAvgEntry + (longRisk * 1.15),
        longAvgEntry + (longRisk * 1.9),
        longAvgEntry + (longRisk * 2.7),
        longAvgEntry + (longRisk * 3.5)
      ];
      const shortTargets = [
        shortAvgEntry - (shortRisk * 1.15),
        shortAvgEntry - (shortRisk * 1.9),
        shortAvgEntry - (shortRisk * 2.7),
        shortAvgEntry - (shortRisk * 3.5)
      ];

      // Formatting helper to keep tiny-cap prices distinct after rounding.
      const fmt = (n) => formatSignalPrice(n, p);
      const resistancePreview = (Array.isArray(candleData?.localResistances) ? candleData.localResistances : [])
        .map(toNumber)
        .filter(v => v !== null && v > p)
        .sort((a, b) => a - b)
        .slice(0, 4)
        .map(v => `$${fmt(v)}`);
      const supportPreview = (Array.isArray(candleData?.localSupports) ? candleData.localSupports : [])
        .map(toNumber)
        .filter(v => v !== null && v < p)
        .sort((a, b) => b - a)
        .slice(0, 4)
        .map(v => `$${fmt(v)}`);
      const resistanceLine = resistancePreview.length ? resistancePreview.join(', ') : 'Unavailable';
      const supportLine = supportPreview.length ? supportPreview.join(', ') : 'Unavailable';

      enhancedContext += `\n\n📈 MARKET STRUCTURE (${candleData.symbol} ${candleData.interval}):
- Current Price: $${p}
- Volatility (ATR): $${atr.toFixed(4)}
- Resistance (Swing High): $${candleData.swingHigh}
- Support (Swing Low): $${candleData.swingLow}
- Local Resistances Above Price: ${resistanceLine}
- Local Supports Below Price: ${supportLine}

📌 LONG STRUCTURE REFERENCE (not a valid signal unless API-derived execution plan is present)
- Entry Zone Reference: $${fmt(Math.min(longStart, longEntry2, longEntry3))} - $${fmt(Math.max(longStart, longEntry2, longEntry3))}
- Stop Loss: $${fmt(longSl)}
- TP1: $${fmt(longTargets[0] ?? (longAvgEntry + longRisk * 2))}
- TP2: $${fmt(longTargets[1] ?? (longAvgEntry + longRisk * 3))}
- TP3: $${fmt(longTargets[2] ?? (longAvgEntry + longRisk * 4))}
- TP4: $${fmt(longTargets[3] ?? (longAvgEntry + longRisk * 3.5))}
- Leverage: ${apiTradePlan?.leverageLabel || deriveRiskFirstLeverageLabel((atr / p) * 100, (longRisk / longAvgEntry) * 100, tradeMeta?.confidence)}

📌 SHORT STRUCTURE REFERENCE (not a valid signal unless API-derived execution plan is present)
- Entry Zone Reference: $${fmt(Math.min(shortStart, shortEntry2, shortEntry3))} - $${fmt(Math.max(shortStart, shortEntry2, shortEntry3))}
- Stop Loss: $${fmt(shortSl)}
- TP1: $${fmt(shortTargets[0] ?? (shortAvgEntry - shortRisk * 2))}
- TP2: $${fmt(shortTargets[1] ?? (shortAvgEntry - shortRisk * 3))}
- TP3: $${fmt(shortTargets[2] ?? (shortAvgEntry - shortRisk * 4))}
- TP4: $${fmt(shortTargets[3] ?? (shortAvgEntry - shortRisk * 3.5))}
- Leverage: ${apiTradePlan?.leverageLabel || deriveRiskFirstLeverageLabel((atr / p) * 100, (shortRisk / shortAvgEntry) * 100, tradeMeta?.confidence)}
`;
    }
    if (hasDetectedCandlePatterns(candleData)) {
      enhancedContext += `\n\n📊 LIVE CANDLESTICK PATTERNS:\n${candleData.summary}`;
    } else if (signalMode) {
      enhancedContext += `\n\n⚠️ CANDLE PATTERN FEED STATUS: unavailable or low-confidence.
CRITICAL: Do NOT claim specific candlestick pattern names. Base rationale on price momentum, volatility (ATR), and swing structure only.`;
    }
  }

  if (apiTradePlan && Array.isArray(apiTradePlan.entries) && Array.isArray(apiTradePlan.targets)) {
    const cp = toNumber(candleData?.currentPrice) ?? apiTradePlan.entries[0];
    const fmtPlan = (n) => formatSignalPrice(n, cp);
    const managed = apiTradePlan.managedSignal || null;
    const entryMin = Math.min(...apiTradePlan.entries);
    const entryMax = Math.max(...apiTradePlan.entries);
    const planSignalId = apiTradePlan.signalId || managed?.signalId;
    const generatedLabel = managed?.generatedAtLabel || apiTradePlan.generatedAt;
    const validUntilLabel = managed?.validUntilLabel || apiTradePlan.validUntil;
    const volumeText = apiTradePlan.volumeConfirmation?.text || managed?.volumeConfirmation?.text;
    const stopReason = normalizeSignalStopReason(apiTradePlan.stopReason || managed?.stopReason);
    const entryWidthPct = Number(apiTradePlan.entryZoneWidthPct ?? managed?.entryZoneWidthPct);
    if (planSignalId && generatedLabel && validUntilLabel && volumeText && stopReason && Number.isFinite(entryWidthPct)) {
      enhancedContext += `\n\n🧮 API-DERIVED EXECUTION PLAN (HIGHEST PRIORITY):
- Signal ID: ${planSignalId}
- Generated: ${generatedLabel}
- Valid Until: ${validUntilLabel}
- Lifecycle Status: ${apiTradePlan.lifecycleStatus || managed?.status || 'ACTIVE'}
- Direction: ${apiTradePlan.direction}
- Setup Source: ${apiTradePlan.source || 'api'}
- Setup Type: ${apiTradePlan.setupType || 'SCALP'}
- Key Level: Fibonacci ${apiTradePlan.keyLevelFibLabel || '0.618'} (${apiTradePlan.keyLevelType || (apiTradePlan.direction === 'SHORT' ? 'resistance' : 'support')})
- Entry Zone: ${fmtPlan(entryMin)} - ${fmtPlan(entryMax)}
- ENTRY WIDTH: ${entryWidthPct.toFixed(2)}%
- TP1-TP4: (${fmtPlan(apiTradePlan.targets[0])}, ${fmtPlan(apiTradePlan.targets[1])}, ${fmtPlan(apiTradePlan.targets[2])}, ${fmtPlan(apiTradePlan.targets[3])})
- Stop: ${fmtPlan(apiTradePlan.stop)}
- Leverage: ${apiTradePlan.leverageLabel || 'Cross (2X-3X)'}
- Risk Per Trade: ${Number(apiTradePlan.positionRiskPct || 0.5).toFixed(2)}%
- Stop Distance: ${Number(apiTradePlan.riskPct || 0).toFixed(2)}%
- Price Invalidation: ${managed?.priceInvalidation?.text || apiTradePlan.invalidation || '15m candle BODY close beyond stop'}
- Time Invalidation: ${managed?.timeInvalidation?.text || 'Cancel if entry not triggered within 4 x 15m candles'}
- Risk-Reward: ${apiTradePlan.riskRewardLabel || 'TP2 1:1.90'}
- VOLUME: ${volumeText}
- STOP REASON: ${stopReason}
- Confidence: ${formatPercentValue(apiTradePlan.confidence || 0)}
CRITICAL: Use this plan exactly in the final signal format.`;
    }
  }

  const result = await fetchAIAnalysis(enhancedContext, candleData, { useMemory: !signalMode });

  if (!result && !apiTradePlan) return null;

  // Split the response into Preamble, Signal, and Rationales
  let preamble = "";
  let signalText = "";
  let rationalesText = "";

  let signalStart = -1;
  if (result) {
    const strictSignalHeader = result.match(/(?:^|\n)\s*(?:📪\s*)?#\s*[A-Z0-9]{2,10}\s*\/\s*USDT\b/i);
    if (strictSignalHeader && Number.isInteger(strictSignalHeader.index)) {
      signalStart = strictSignalHeader.index;
    } else {
      signalStart = result.search(/(?:^|\n)\s*(?:📪\s*)?(?:Exchanges|Signal Type)\s*:/i);
    }
  }
  if (signalStart !== -1) {
    preamble = result.substring(0, signalStart).trim();

    const rationalesStart = result.search(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:[A-Z0-9]{2,10}\s+)?Trade Rationales(?:\*\*)?:?/i);
    if (rationalesStart !== -1 && rationalesStart > signalStart) {
      signalText = result.substring(signalStart, rationalesStart).trim();
      rationalesText = result.substring(rationalesStart).trim();
    } else {
      signalText = result.substring(signalStart).trim();
    }
  } else {
    rationalesText = result;
  }

  const fallbackSymbol = extractedSymbol || (candleData?.symbol ? candleData.symbol.replace('USDT', '') : 'COIN');
  signalText = buildCanonicalSignalText(signalText, fallbackSymbol, {
    candleData,
    forcedPlan: signalMode ? apiTradePlan : null,
    tradeMeta
  });
  const extractedRationales = extractTradeRationales(`${preamble}\n${rationalesText}\n${result || ''}`, fallbackSymbol);
  const fallbackHints = apiTradePlan?.rationaleHints?.filter(Boolean) || [];
  const feedUnavailable = isCandleFeedUnavailable(candleData);
  const fallbackRationalePoints = [
    fallbackHints[0] || 'Price action and volatility support the selected direction.',
    fallbackHints[1] || (feedUnavailable
      ? 'Candlestick feed is temporarily unavailable, so this setup uses live momentum + structure fallback logic.'
      : 'Directional bias is validated by the latest momentum and structure context.'),
    fallbackHints[2] || 'Entry ladder is volatility-adjusted to improve fill quality.',
    'Targets are anchored to nearby local resistance/support levels with scalp-safe progression.',
    'Stop placement is structure-aware and sized for disciplined risk control.'
  ];
  const apiRationaleFallback = `### ${String(fallbackSymbol || 'COIN').toUpperCase()} Trade Rationales
1. ${fallbackRationalePoints[0]}
2. ${fallbackRationalePoints[1]}
3. ${fallbackRationalePoints[2]}
4. ${fallbackRationalePoints[3]}
5. ${fallbackRationalePoints[4]}`.replace(/\n{2,}/g, '\n');
  const renderedRationales = (signalMode && feedUnavailable)
    ? apiRationaleFallback
    : (extractedRationales || apiRationaleFallback);

  // Escape the signal text for the clipboard copy command
  const escapedSignal = signalText.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '\\n');

  const signalHtml = `
    <div style="background: rgba(14, 19, 32, 0.6); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 2.5rem 1rem 1rem 1rem; margin-top: 0.5rem; margin-bottom: 1rem; position: relative;">
      <button onclick="navigator.clipboard.writeText('${escapedSignal}').then(() => { this.innerText = 'Copied!'; setTimeout(() => this.innerText = 'Copy Signal', 2000); })" 
              style="position: absolute; top: 0.5rem; right: 0.5rem; background: var(--primary); color: #fff; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; cursor: pointer; transition: 0.2s; z-index: 10;">
        📋 Copy Signal
      </button>
      <div style="font-family: monospace; white-space: pre-wrap; font-size: 0.9rem; color: #E2E8F0; line-height: 1.6;">${signalText}</div>
    </div>
  `;

  // Build pattern badge if patterns were detected
  const patternBadge = hasDetectedCandlePatterns(candleData)
    ? `<div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.5rem;">
        ${candleData.patterns.map(p => `
          <span style="font-size:0.6rem;font-weight:700;padding:0.2rem 0.5rem;border-radius:4px;letter-spacing:0.05em;
            background:${p.type === 'bullish' ? 'rgba(52,199,89,0.15)' : p.type === 'bearish' ? 'rgba(255,69,58,0.15)' : 'rgba(255,255,255,0.08)'};
            color:${p.type === 'bullish' ? '#34C759' : p.type === 'bearish' ? '#FF453A' : '#aaa'};
            border:1px solid ${p.type === 'bullish' ? 'rgba(52,199,89,0.3)' : p.type === 'bearish' ? 'rgba(255,69,58,0.3)' : 'rgba(255,255,255,0.1)'};">
            ${p.type === 'bullish' ? '▲' : p.type === 'bearish' ? '▼' : '◆'} ${p.name}
          </span>`).join('')}
      </div>`
    : '';
  const finalHtml = `
    <div style="width:100%;">
      ${patternBadge}
      ${preamble ? `<div style="color:#BAC2DE;line-height:1.6;margin-bottom:0.5rem;">${renderMarkdown(preamble)}</div>` : ''}
      ${renderedRationales ? `<div style="color:#BAC2DE;line-height:1.6;margin-bottom:0.75rem;">${renderMarkdown(renderedRationales)}</div>` : ''}
      ${signalText ? signalHtml : ''}
    </div>`;

  // Save canonical mirrored signal so every device receives identical output.
  const mirrorSymbol = extractedSymbol || apiTradePlan?.symbol || fallbackSymbol;
  if (signalMode && mirrorSymbol && signalText) {
    await writeMirroredSignal(mirrorSymbol, interval, finalHtml, {
      userQuery,
      generatedAt: new Date().toISOString(),
      referencePrice: toNumber(candleData?.currentPrice) ?? toNumber(activeSnapshot?.price) ?? null
    });
  }

  return finalHtml;
}
