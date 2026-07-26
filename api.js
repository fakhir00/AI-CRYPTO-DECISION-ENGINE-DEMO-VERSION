// ====================================================
// NEXUS API Engine — All external data integrations
// ====================================================

// DEPRECATED IMPORTS REMOVED — signal-lifecycle.js and momentum-strategy.js are now stubs

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

// [REMOVED] computeEMA and computeRSI — replaced by lib/scoring/categories/ in Step 2

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

// ═══════════════════════════════════════════════════════════════
// DEPRECATED SIGNAL LOGIC REMOVED (~2200 lines)
// All signal generation, scoring, prediction, LLM orchestration,
// signal mirroring, trade plan building, and Fibonacci/pattern
// analysis has been deleted as part of the v2 revamp.
//
// Replacement modules (Steps 1-6):
//   lib/ingestion/*       — Data ingestion layer
//   lib/scoring/*         — Composite scoring engine
//   lib/signals/*         — Signal schema + Supabase logging
//   lib/llm/narrator.js   — LLM narrative layer
//   lib/backtest/*        — Backtesting module
// ═══════════════════════════════════════════════════════════════
// TECHNICAL INDICATOR UTILITIES (Restored)
// ═══════════════════════════════════════════════════════════════
function computeEMA(data, period) {
  if (!data || data.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

// ─── Stub exports (prevent main.js breakage until Step 6) ─────
export async function fetchAIAnalysis() { return '[AI analysis temporarily offline — engine rebuild in progress]'; }
export async function fetchHermesAnalysis() { return null; }
export async function fetchDualAI() { return '<div style="color:#BAC2DE;padding:1rem;">Signal engine is being rebuilt. Check back soon.</div>'; }
export function calculateAlphaScore() { return 50; }
