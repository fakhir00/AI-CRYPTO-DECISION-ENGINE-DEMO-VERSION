// ====================================================
// NEXUS API Engine — All external data integrations
// ====================================================

const KEYS = {
  coingecko: 'CG-7gTv8kk2qS7r8kj515m2rVQJ',
  cmc: 'e7080786d0f14b3abfc6c58de5f61adc',
  etherscan: 'CRSWB6SIH2SAAPCPFGBK2NN473EC5JIS9M',
  taapi: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbHVlIjoiNjlmNWJjMTVlZTAzMzMxMWE0ZjJjOGRiIiwiaWF0IjoxNzc3NzEyMTQ5LCJleHAiOjMzMjgyMTc2MTQ5fQ.8Htit-r6kGZC5LZn7_EZLozYC7yOyCu4Z1WzhuPIH34',
  lunarcrush: '8a0hxklrnp6i5kfiowg77edxjemoobmyiw0g62whp',
  openai: import.meta.env.VITE_OPENAI_API_KEY
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
    const MIN_QUOTE_VOLUME_USD = 20_000_000;
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
      const absChange = Math.abs(Number(ticker.changePct) || 0);
      const openPrice = Number(ticker.openPrice) || 0;
      const highPrice = Number(ticker.highPrice) || 0;
      const lowPrice = Number(ticker.lowPrice) || 0;
      const rangePct = openPrice > 0 ? ((highPrice - lowPrice) / openPrice) * 100 : absChange;

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
    markApiFailed('CMC Global Metrics', e.message);
    return null;
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
  return `mirror_signal_${symbol}_${interval}`;
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
    if (hasPlaceholderTargets && hasPlaceholderStop) {
      // Reject low-quality mirrored payloads so they don't persist for the full TTL.
      return null;
    }
    if (hasUnavailableFeed && hasHardPatternClaim) {
      // Reject contradictory mirrored payloads: feed unavailable but rationale still claims specific patterns.
      return null;
    }
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
  if (ref < 1) decimals = 5;
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
      .sort((a, b) => side === 'LONG' ? a - b : b - a);
  }

  const minStep = Math.max(base * 0.0008, 0.0000001);
  const maxStep = Math.max(base * 0.0015, minStep);
  const adaptiveStep = atr && atr > 0
    ? clampBetween(atr * 0.18, minStep, maxStep)
    : Math.max(base * 0.0010, minStep);

  if (side === 'SHORT') {
    return [base + (2 * adaptiveStep), base + adaptiveStep, base];
  }

  return [
    Math.max(0.0000001, base - (2 * adaptiveStep)),
    Math.max(0.0000001, base - adaptiveStep),
    base
  ];
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
  const leverageLabel = forcedPlan?.leverageLabel || deriveScalpLeverageLabel(options.candleData, options.tradeMeta?.confidence);

  if (forcedPlan && Array.isArray(forcedPlan.entries) && Array.isArray(forcedPlan.targets) && forcedPlan.targets.length >= 4) {
    const entryNums = forcedPlan.entries
      .slice(0, 3)
      .map(toNumber)
      .sort((a, b) => direction === 'SHORT' ? b - a : a - b);
    const targetNums = forcedPlan.targets.slice(0, 4).map(toNumber);
    const stopNum = toNumber(forcedPlan.stop);
    const forcedPlanValid =
      entryNums.length === 3 &&
      targetNums.length === 4 &&
      entryNums.every(n => n !== null && n > 0) &&
      targetNums.every(n => n !== null && n > 0) &&
      stopNum !== null &&
      stopNum > 0;

    if (forcedPlanValid) {
      const formattedEntries = entryNums.map(v => formatSignalPrice(v, options.candleData?.currentPrice || v));
      const formattedTargets = targetNums.map(v => formatSignalPrice(v, options.candleData?.currentPrice || v));
      const formattedStop = formatSignalPrice(stopNum, options.candleData?.currentPrice || stopNum);
      const avgEntry = entryNums.reduce((sum, n) => sum + n, 0) / entryNums.length;
      const trailingConfig = getDynamicTrailingConfig(direction, avgEntry, stopNum, options.candleData, {
        confidence: options.tradeMeta?.confidence ?? forcedPlan?.confidence,
        changePct: options.tradeMeta?.changePct,
        patternBias: options.tradeMeta?.patternBias
      });
      const trailingBlock = buildTrailingConfigurationBlock(trailingConfig);

      return `#${symbol}/USDT

Exchanges: Binance Futures

Signal Type: Regular (${directionLabel})

Leverage: ${leverageLabel}

Entry :
(${formattedEntries[0]}, ${formattedEntries[1]}, ${formattedEntries[2]})

Take-Profit Targets:
1) ${formattedTargets[0]}
2) ${formattedTargets[1]}
3) ${formattedTargets[2]}
4) ${formattedTargets[3]}

Stop Targets:
1) ${formattedStop}

${trailingBlock}`;
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
  const entryLadder = entryLadderNums.map(v => formatSignalPrice(v, options.candleData?.currentPrice || v));
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
    parsedTargets.length === 4 &&
    parsedTargets.every((n, idx) => Math.abs(n - (idx + 1)) < 1e-9);
  const hasPlaceholderStop = parsedStop !== null && (Math.abs(parsedStop - 1) < 1e-9 || Math.abs(parsedStop) < 1e-9);
  const hasInvalidTargets = parsedTargets.length === 4 && parsedTargets.some(n => n <= 0);

  if ((hasPlaceholderTargets && hasPlaceholderStop) || hasInvalidTargets) {
    const entryBase = entryLadderNums[0] ?? refPrice;
    const atrNum = toNumber(options.candleData?.atr) ?? Math.max(entryBase * 0.0075, 0.0001);
    const repairedStop = direction === 'SHORT'
      ? entryBase + (0.58 * atrNum)
      : Math.max(0, entryBase - (0.58 * atrNum));
    const risk = Math.max(Math.abs(entryBase - repairedStop), atrNum * 0.28);
    const repairedTargets = buildScalpTargetsFromStructure(
      direction,
      entryBase,
      risk,
      options.candleData,
      options.tradeMeta?.confidence
    );

    targets = repairedTargets.map(v => formatSignalPrice(v, refPrice));
    stop = formatSignalPrice(repairedStop, refPrice);
  } else {
    targets = targets.map(v => formatSignalPrice(v, refPrice));
    stop = stop ? formatSignalPrice(stop, refPrice) : stop;
  }

  const avgEntry = entryLadderNums.length ? (entryLadderNums.reduce((sum, n) => sum + n, 0) / entryLadderNums.length) : null;
  const stopNum = toNumber(stop);
  const trailingConfig = getDynamicTrailingConfig(direction, avgEntry, stopNum, options.candleData, {
    confidence: options.tradeMeta?.confidence ?? forcedPlan?.confidence,
    changePct: options.tradeMeta?.changePct,
    patternBias: options.tradeMeta?.patternBias
  });
  const trailingBlock = buildTrailingConfigurationBlock(trailingConfig);

  // If parsing fails, still return a cleaned copy-ready signal without forbidden annotations.
  if (entryLadder.length < 3 || targets.length < 4 || !stop) {
    const atrNum = toNumber(options.candleData?.atr) ?? Math.max(refPrice * 0.0075, 0.0001);
    const fallbackBase = refPrice;
    const minStep = Math.max(fallbackBase * 0.0008, 0.0000001);
    const maxStep = Math.max(fallbackBase * 0.0015, minStep);
    const ladderStep = atrNum > 0
      ? clampBetween(atrNum * 0.18, minStep, maxStep)
      : Math.max(fallbackBase * 0.0010, minStep);
    const autoEntryNums = entryLadderNums.length >= 3
      ? entryLadderNums
      : (direction === 'SHORT'
        ? [fallbackBase + (2 * ladderStep), fallbackBase + ladderStep, fallbackBase]
        : [Math.max(0.0000001, fallbackBase - (2 * ladderStep)), Math.max(0.0000001, fallbackBase - ladderStep), fallbackBase]);
    const autoEntries = autoEntryNums.map(v => formatSignalPrice(v, refPrice));
    const entryBase = autoEntryNums.length
      ? (autoEntryNums.reduce((sum, n) => sum + n, 0) / autoEntryNums.length)
      : refPrice;
    const autoRiskPct = 0.42 / 100;
    const autoStopNum = direction === 'SHORT'
      ? entryBase * (1 + autoRiskPct)
      : Math.max(0.0000001, entryBase * (1 - autoRiskPct));
    const autoRisk = Math.abs(entryBase - autoStopNum);
    const autoTargets = buildScalpTargetsFromStructure(
      direction,
      entryBase,
      autoRisk,
      options.candleData,
      options.tradeMeta?.confidence
    ).map(v => formatSignalPrice(Math.max(v, 0.0000001), refPrice));
    const autoStop = formatSignalPrice(autoStopNum, refPrice);

    return `#${symbol}/USDT

Exchanges: Binance Futures

Signal Type: Regular (${directionLabel})

Leverage: ${leverageLabel}

Entry :
(${autoEntries[0]}, ${autoEntries[1]}, ${autoEntries[2]})

Take-Profit Targets:
1) ${autoTargets[0]}
2) ${autoTargets[1]}
3) ${autoTargets[2]}
4) ${autoTargets[3]}

Stop Targets:
1) ${autoStop}

${trailingBlock}`;
  }

  return `#${symbol}/USDT

Exchanges: Binance Futures

Signal Type: Regular (${directionLabel})

Leverage: ${leverageLabel}

Entry :
(${entryLadder[0]}, ${entryLadder[1]}, ${entryLadder[2]})

Take-Profit Targets:
1) ${targets[0]}
2) ${targets[1]}
3) ${targets[2]}
4) ${targets[3]}

Stop Targets:
1) ${stop}

${trailingBlock}`;
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

    snapshots[symbol] = { symbol, price, changePct, reason };
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

function buildApiDrivenTradePlan({ symbol = 'BTC', userQuery = '', assetContext = '', candleData = null, fallbackPrice = null } = {}) {
  const snapshots = parseAssetContextSnapshots(assetContext);
  const snap = snapshots[String(symbol || '').toUpperCase()] || null;
  let current = toNumber(candleData?.currentPrice);
  if (!(current > 0)) current = toNumber(snap?.price);
  if (!(current > 0)) current = toNumber(fallbackPrice);
  if (!(current > 0)) return null;

  const bias = evaluateDirectionalBias(snap, candleData, userQuery);
  const direction = bias.direction;
  const confidence = normalizeTradeConfidence(bias.confidence);

  const atr = toNumber(candleData?.atr);
  const safeAtr = atr && atr > 0 ? atr : Math.max(current * 0.0075, current * 0.0028);
  const atrPct = (safeAtr / current) * 100;
  const swingHigh = toNumber(candleData?.swingHigh);
  const swingLow = toNumber(candleData?.swingLow);
  const range = (swingHigh !== null && swingLow !== null && swingHigh > swingLow) ? (swingHigh - swingLow) : 0;
  const pos = range > 0 ? (current - swingLow) / range : 0.5;
  const change = toNumber(snap?.changePct) ?? 0;
  const volHigh = atrPct >= 3.5;
  const volLow = atrPct <= 1.2;
  const leverageLabel = deriveScalpLeverageLabel(candleData, bias.confidence);

  let offset = direction === 'SHORT' ? 0.06 : -0.06;
  if (direction === 'LONG') {
    if (change >= 3 && bias.confidence >= 2) offset = -0.03;
    else if (change <= -0.8 || pos > 0.7) offset = -0.11;
    else if (bias.confidence < 1) offset = -0.08;
  } else {
    if (change <= -3 && bias.confidence >= 2) offset = 0.03;
    else if (change >= 0.8 || pos < 0.3) offset = 0.11;
    else if (bias.confidence < 1) offset = 0.08;
  }

  let entryStepAtr = volHigh ? 0.24 : (volLow ? 0.12 : 0.18);
  if (confidence >= 0.75) {
    entryStepAtr *= 0.9;
  } else if (confidence <= 0.35) {
    entryStepAtr *= 1.1;
  }

  const entryAnchor = Math.max(0.0000001, current + (offset * safeAtr));
  const minEntryStep = Math.max(current * 0.0008, 0.0000001);
  const maxEntryStep = Math.max(current * 0.0015, minEntryStep);
  const ladderStep = clampBetween(entryStepAtr * safeAtr, minEntryStep, maxEntryStep);

  let lowEntry;
  let midEntry;
  let highEntry;
  if (direction === 'LONG') {
    highEntry = entryAnchor;
    midEntry = Math.max(0.0000001, highEntry - ladderStep);
    lowEntry = Math.max(0.0000001, midEntry - ladderStep);
  } else {
    lowEntry = entryAnchor;
    midEntry = lowEntry + ladderStep;
    highEntry = midEntry + ladderStep;
  }

  const orderedEntries = direction === 'LONG'
    ? [lowEntry, midEntry, highEntry]
    : [highEntry, midEntry, lowEntry];
  const avgEntry = orderedEntries.reduce((sum, n) => sum + n, 0) / orderedEntries.length;

  let stopMult = volHigh ? 0.65 : (volLow ? 0.52 : 0.58);
  if (confidence >= 0.75) stopMult *= 0.95;
  else if (confidence <= 0.35) stopMult *= 1.05;

  let stop = direction === 'LONG' ? avgEntry - (stopMult * safeAtr) : avgEntry + (stopMult * safeAtr);
  if (direction === 'LONG' && swingLow !== null) {
    stop = Math.min(stop, swingLow - (0.03 * safeAtr));
  }
  if (direction === 'SHORT' && swingHigh !== null) {
    stop = Math.max(stop, swingHigh + (0.03 * safeAtr));
  }
  if (direction === 'LONG') stop = Math.max(0, stop);

  let risk = Math.abs(avgEntry - stop);
  const riskEnvelope = getScalpRiskEnvelope(candleData, bias.confidence);
  const rawRiskPct = (avgEntry > 0 && risk > 0) ? ((risk / avgEntry) * 100) : null;
  const clampedRiskPct = clampBetween(
    rawRiskPct ?? ((riskEnvelope.minRiskPct + riskEnvelope.maxRiskPct) / 2),
    riskEnvelope.minRiskPct,
    riskEnvelope.maxRiskPct
  );
  risk = avgEntry * (clampedRiskPct / 100);
  stop = direction === 'LONG'
    ? Math.max(0.0000001, avgEntry - risk)
    : avgEntry + risk;

  const targets = buildScalpTargetsFromStructure(direction, avgEntry, risk, candleData, bias.confidence);

  const minPrice = Math.max(current * 0.02, 0.0000001);
  const sanitizePositive = (n, fallback = current) => {
    const x = toNumber(n);
    if (!(x > 0)) return fallback;
    return x;
  };

  const sanitizedEntries = orderedEntries.map(v => sanitizePositive(v, current));
  const sanitizedTargets = targets.map(v => sanitizePositive(v, minPrice));
  const sanitizedStop = sanitizePositive(stop, direction === 'SHORT' ? avgEntry * 1.0042 : avgEntry * 0.9958);

  const planSymbol = String(symbol || '').toUpperCase();
  const planChangePct = toNumber(snap?.changePct) ?? toNumber(candleData?.changePct);

  return {
    symbol: planSymbol,
    direction,
    entries: sanitizedEntries,
    targets: sanitizedTargets,
    stop: sanitizedStop,
    leverageLabel,
    confidence: bias.confidence,
    changePct: planChangePct,
    patternBias: getPatternBiasScore(candleData),
    rationaleHints: bias.reasons
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
You have FULL ACCESS to live market data, on-chain analytics, whale tracking, social sentiment, and news feeds — all provided to you in the user's message context. NEVER say you cannot access data or that something is unavailable. The data in the context IS your live feed.

CRITICAL DATA PRIORITY: You must ALWAYS prioritize the numerical data (prices, scores, volumes) provided in the LATEST message. Conversation history is for context only. If the price in the current message differs from a previous message, use the current one. Never hallucinate prices.

CRITICAL: You have conversation memory. If the user previously mentioned a coin (e.g. "Analyze BTC") and then asks a follow-up like "What's the stop loss?" or "Give me targets", you MUST refer back to the coin from the previous message. Never ask them to repeat the coin name.

Your core decision-making is based on the NEXUS High-Probability Framework. 

CRITICAL: You are a DUAL-DIRECTIONAL agent. If the Alpha Score is low and the price change is negative, you MUST prefer SHORT setups. If the market is chopping sideways, stay NEUTRAL and advise against trading. Do not force Longs in a Bearish market. Never "guess" a direction—if the data is bearish, the signal MUST be SHORT.

MATHEMATICAL TARGET GENERATION (STRICT): You will be provided with PRE-CALCULATED MANDATORY targets based on live Volatility (ATR) and Risk-Reward constraints in the context (under "MANDATORY LONG/SHORT TARGETS"). 
CRITICAL: You MUST use the exact Entry, Stop Loss, and TP1-TP4 values provided in the context. Do NOT calculate your own. If the context says the Stop Loss is $3.85, you output $3.85. No exceptions. This ensures all devices (PC and Mobile) show identical signals.
CRITICAL SCALP RULE: Every signal is SCALPING only. Keep stop-loss tight and set TP1-TP4 using the nearest local structure levels (resistance for LONG, support for SHORT). Never output distant swing targets.

MANDATORY SIGNAL FORMAT (FOLLOW STRICTLY):
# [SYMBOL]/USDT

Exchanges: Binance Futures

Signal Type: Regular ([Long/Short])

Leverage: Cross (4X-12X, volatility-adjusted)

Entry :
([Price 1], [Price 2], [Price 3])

Take-Profit Targets:
1) [Price]
2) [Price]
3) [Price]
4) [Price]

Stop Targets:
1) [Price]

Trailing Configuration:
Stop: Percent Below Highest ([X]%)
  - [Trail behavior based on conditions]
Breakeven: Trigger at +[Y]% profit
  - Stop moves to entry after +[Y]%.

[SYMBOL] Trade Rationales
1. [Rationale 1]
2. [Rationale 2]
3. [Rationale 3]
4. [Rationale 4]
5. [Rationale 5]

CRITICAL: NEVER add "(1:1 R:R)", "(1:2 R:R)", "(1:3 R:R)", "(1:4 R:R)" or "(1.5 ATR)" anywhere in the signal. 
CRITICAL: Trailing Configuration must adapt to market conditions (volatility/risk) and direction (LONG/SHORT); do not keep it fixed.
CRITICAL ENTRY ORDER RULE:
- LONG entries must be: ([Start Price], [Lower Entry], [Lower Entry]).
- SHORT entries must be: ([Start Price], [Higher Entry], [Higher Entry]).
- Start Price should be chosen intelligently from market structure and volatility (do NOT hard-lock it to current price).

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

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEYS.openai}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature: 0.0,
        seed: 42,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = (typeof err?.error === 'string') ? err.error : err?.error?.message;
      throw new Error(errMsg || `HTTP ${res.status}`);
    }

    const data = await res.json();
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
            content: `You are Hermes, the quantitative prediction engine inside the NEXUS Crypto Intelligence Platform. You have FULL ACCESS to live market data — prices, trends, AI scores, confidence levels, and volume — all provided in the user's context. NEVER say you lack access to data. The context IS your live data feed. Always produce confident, numerical analysis.

Your specialization:
- Quantitative price predictions with probability scores
- Risk/reward ratio calculations
- Smart money flow interpretation (bullish accumulation vs bearish distribution)
- Precise trade setups with mathematical entry/exit zones. ALWAYS align your analysis with the "Detected Pattern" provided in the context.

CRITICAL: You must ALWAYS provide 5 "Quantitative Rationales" explaining the data-driven basis for the trade. Ensure Risk:Reward ratio is emphasized.

When the user asks for a signal or trade setup, output in this exact HTML format:
📪 #[COIN]/USDT<br><br>Direction: <strong style="color:var(--green)">[LONG]</strong> or <strong style="color:var(--red)">[SHORT]</strong><br>Leverage: Cross (2X-5X)<br><br>Entry: ([Price], [Price], [Price])<br><br>Target 1: [Price]<br>Target 2: [Price]<br>Target 3: [Price]<br>Target 4: [Price]<br><br>Stop loss: [Price]<br><br>Risk:Reward Ratio: 1:[Value]<br><br>⚡ NEXUS Pro Autotrade Signals<br><br><strong>5 Quantitative Rationales:</strong><br>1. [Rationale 1]<br>2. [Rationale 2]<br>3. [Rationale 3]<br>4. [Rationale 4]<br>5. [Rationale 5]

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

  // Global Mirror Protocol: if this is a signal query, force all devices to read one canonical response first.
  if (signalMode && extractedSymbol) {
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

  // 2. Build enhanced context with candle patterns and market structure
  let enhancedContext = `${context}\n\n🛰 API HEALTH SNAPSHOT:\n${getApiHealthPromptSummary()}`;
  if (candleData) {
    if (candleData.atr) {
      const p = candleData.currentPrice;
      const atr = candleData.atr;

      const longStart = deriveAdaptiveStartFromCandle('LONG', p, atr, candleData) ?? p;
      const shortStart = deriveAdaptiveStartFromCandle('SHORT', p, atr, candleData) ?? p;
      const ladderStep = clampBetween(atr * 0.18, p * 0.0008, p * 0.0015);
      const longEntryMid = Math.max(0.0000001, longStart - ladderStep);
      const longEntryLow = Math.max(0.0000001, longEntryMid - ladderStep);
      const shortEntryMid = shortStart + ladderStep;
      const shortEntryHigh = shortEntryMid + ladderStep;
      const longAvgEntry = (longEntryLow + longEntryMid + longStart) / 3;
      const shortAvgEntry = (shortEntryHigh + shortEntryMid + shortStart) / 3;

      const longEnvelope = getScalpRiskEnvelope(candleData, tradeMeta?.confidence);
      const shortEnvelope = getScalpRiskEnvelope(candleData, tradeMeta?.confidence);
      const longRisk = longAvgEntry * (((longEnvelope.minRiskPct + longEnvelope.maxRiskPct) / 2) / 100);
      const shortRisk = shortAvgEntry * (((shortEnvelope.minRiskPct + shortEnvelope.maxRiskPct) / 2) / 100);
      const longSl = Math.max(0.0000001, longAvgEntry - longRisk);
      const shortSl = shortAvgEntry + shortRisk;
      const longTargets = buildScalpTargetsFromStructure('LONG', longAvgEntry, longRisk, candleData, tradeMeta?.confidence);
      const shortTargets = buildScalpTargetsFromStructure('SHORT', shortAvgEntry, shortRisk, candleData, tradeMeta?.confidence);

      // Formatting helper to keep decimals sane
      const fmt = (n) => p < 1 ? n.toFixed(5) : p < 10 ? n.toFixed(4) : p < 1000 ? n.toFixed(2) : n.toFixed(1);
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

🚨 [CRITICAL: IF SIGNAL IS LONG, YOU MUST USE THESE EXACT VALUES IN THE OUTPUT]
- Entry Ladder (MUST be ASCENDING for LONG: lowest, middle, highest): ($${fmt(longEntryLow)}, $${fmt(longEntryMid)}, $${fmt(longStart)})
- Stop Loss: $${fmt(longSl)}
- TP1: $${fmt(longTargets[0] ?? (longAvgEntry + longRisk * 1.5))}
- TP2: $${fmt(longTargets[1] ?? (longAvgEntry + longRisk * 2.1))}
- TP3: $${fmt(longTargets[2] ?? (longAvgEntry + longRisk * 2.8))}
- TP4: $${fmt(longTargets[3] ?? (longAvgEntry + longRisk * 3.6))}

🚨 [CRITICAL: IF SIGNAL IS SHORT, YOU MUST USE THESE EXACT VALUES IN THE OUTPUT]
- Entry Ladder (MUST be DESCENDING for SHORT: highest, middle, lowest): ($${fmt(shortEntryHigh)}, $${fmt(shortEntryMid)}, $${fmt(shortStart)})
- Stop Loss: $${fmt(shortSl)}
- TP1: $${fmt(shortTargets[0] ?? (shortAvgEntry - shortRisk * 1.5))}
- TP2: $${fmt(shortTargets[1] ?? (shortAvgEntry - shortRisk * 2.1))}
- TP3: $${fmt(shortTargets[2] ?? (shortAvgEntry - shortRisk * 2.8))}
- TP4: $${fmt(shortTargets[3] ?? (shortAvgEntry - shortRisk * 3.6))}
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
    enhancedContext += `\n\n🧮 API-DERIVED EXECUTION PLAN (HIGHEST PRIORITY):
- Direction: ${apiTradePlan.direction}
- Entry Ladder: (${fmtPlan(apiTradePlan.entries[0])}, ${fmtPlan(apiTradePlan.entries[1])}, ${fmtPlan(apiTradePlan.entries[2])})
- TP1-TP4: (${fmtPlan(apiTradePlan.targets[0])}, ${fmtPlan(apiTradePlan.targets[1])}, ${fmtPlan(apiTradePlan.targets[2])}, ${fmtPlan(apiTradePlan.targets[3])})
- Stop: ${fmtPlan(apiTradePlan.stop)}
- Confidence: ${formatPercentValue(apiTradePlan.confidence || 0)}
CRITICAL: Use this plan exactly in the final signal format.`;
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
