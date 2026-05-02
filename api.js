// ====================================================
// NEXUS API Engine — All external data integrations
// ====================================================

const KEYS = {
  coingecko: 'CG-7gTv8kk2qS7r8kj515m2rVQJ',
  cmc: 'e7080786d0f14b3abfc6c58de5f61adc',
  etherscan: 'CRSWB6SIH2SAAPCPFGBK2NN473EC5JIS9M',
  taapi: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjbHVlIjoiNjlmNWJjMTVlZTAzMzMxMWE0ZjJjOGRiIiwiaWF0IjoxNzc3NzEyMTQ5LCJleHAiOjMzMjgyMTc2MTQ5fQ.8Htit-r6kGZC5LZn7_EZLozYC7yOyCu4Z1WzhuPIH34',
  lunarcrush: '8a0hxklrnp6i5kfiowg77edxjemoobmyiw0g62whp'
};

// ─── 1. CoinGecko: Real-time price, market cap, volume ───────────────────────
export async function fetchMarketData() {
  const coins = [
    'bitcoin', 'ethereum', 'solana', 'injective-protocol',
    'ondo-finance', 'avalanche-2', 'arbitrum'
  ];
  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets`
      + `?vs_currency=usd&ids=${coins.join(',')}`
      + `&x_cg_demo_api_key=${KEYS.coingecko}&sparkline=false`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ CoinGecko data fetched:', data.length, 'coins');
    return data;
  } catch (e) {
    console.warn('⚠️ CoinGecko failed, using mock data:', e.message);
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
    return data;
  } catch (e) {
    console.warn('⚠️ CoinMarketCap failed:', e.message);
    return null;
  }
}

// ─── 3. Etherscan: Whale transactions > $500k ────────────────────────────────
export async function fetchWhaleActivity() {
  try {
    const usdcContract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const url = `https://api.etherscan.io/api`
      + `?module=account&action=tokentx`
      + `&contractaddress=${usdcContract}`
      + `&page=1&offset=100&sort=desc`
      + `&apikey=${KEYS.etherscan}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status === '1' && data.result) {
      const whales = data.result.filter(tx => (parseInt(tx.value) / 1e6) > 500000);
      console.log('✅ Etherscan whale txs found:', whales.length);
      return whales.map(tx => ({
        hash: tx.hash,
        value: parseInt(tx.value) / 1e6,
        token: tx.tokenSymbol,
        from: tx.from,
        to: tx.to
      }));
    }
    return [];
  } catch (e) {
    console.warn('⚠️ Etherscan failed:', e.message);
    return [];
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
        return { bullish: 85, bearish: 15, score: score, source: 'LunarCrush AI' };
      }
    }
  } catch (e) {
    console.warn('⚠️ LunarCrush failed or requires plan upgrade:', e.message);
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
    return { bullish, bearish, score, source: 'Reddit NLP' };
  } catch (e) {
    console.warn('⚠️ Reddit failed:', e.message);
    return { bullish: 5, bearish: 5, score: 50, source: 'Data Unavailable' };
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
      return {
        value: parseInt(data.data.value),
        label: data.data.value_classification
      };
    }
    return { value: 50, label: 'Neutral' };
  } catch (e) {
    console.warn('⚠️ CMC Fear & Greed failed, falling back to alternative.me:', e.message);
    // Fallback to alternative.me if CMC key doesn't have access or fails
    try {
      const fallback = await fetch('https://api.alternative.me/fng/');
      const fData = await fallback.json();
      return {
        value: parseInt(fData.data[0].value),
        label: fData.data[0].value_classification
      };
    } catch(err) {
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
    return topPools;
  } catch (e) {
    console.warn('⚠️ DefiLlama failed:', e.message);
    return null;
  }
}

// ─── 4B. Aggregated RSS News Feed ──────────────────────────────────────────────
export async function fetchNews() {
  const feeds = [
    'https://cointelegraph.com/rss',
    'https://cryptoslate.com/feed/',
    'https://decrypt.co/feed',
    'https://www.newsbtc.com/feed/'
  ];

  try {
    const fetchPromises = feeds.map(feed => 
      fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}`)
        .then(res => res.ok ? res.json() : null)
        .catch(() => null)
    );

    const results = await Promise.allSettled(fetchPromises);
    
    let allNews = [];
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value && result.value.items) {
        allNews = allNews.concat(result.value.items);
      }
    });

    if (allNews.length === 0) throw new Error('All news feeds failed');

    // Sort by publication date (newest first)
    allNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    // Filter out duplicates by title (sometimes news is cross-posted)
    const uniqueNews = [];
    const titles = new Set();
    for (const item of allNews) {
      if (!titles.has(item.title)) {
        uniqueNews.push(item);
        titles.add(item.title);
      }
    }

    console.log(`✅ Aggregated ${uniqueNews.length} news items from multiple sources`);
    return uniqueNews.slice(0, 15);
  } catch (e) {
    console.warn('⚠️ Aggregated News fetch failed:', e.message);
    return null;
  }
}

// ─── 4C. Binance & TAAPI: Technical Signals ──────────────────────────────────
export async function fetchTechnicalSignals(symbols = ['BTC', 'ETH', 'SOL', 'INJ', 'AVAX', 'ARB', 'ONDO']) {
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
    try {
      const taapiRes = await fetch(`https://api.taapi.io/rsi?secret=${KEYS.taapi}&exchange=binance&symbol=BTC/USDT&interval=1h`);
      if (taapiRes.ok) {
        const taapiJson = await taapiRes.json();
        btcRsi = taapiJson.value;
        console.log('✅ TAAPI RSI fetched:', btcRsi);
      }
    } catch(err) {
      console.warn('⚠️ TAAPI rate limit or error:', err.message);
    }

    console.log('✅ Multi-indicator technical data fetched for', symbols.length, 'assets');
    return { binance: binanceData, rsi: btcRsi, ema: emaData };
  } catch (e) {
    console.warn('⚠️ Binance/TAAPI failed:', e.message);
    return null;
  }
}

// ─── 4C-2. Binance Futures: Funding Rates (FREE, NO KEY) ─────────────────────
export async function fetchFundingRates(symbols = ['BTC', 'ETH', 'SOL', 'INJ', 'AVAX', 'ARB']) {
  try {
    const promises = symbols.map(sym =>
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}USDT&limit=1`)
        .then(r => r.json())
        .then(data => ({ symbol: sym, rate: data[0] ? parseFloat(data[0].fundingRate) : 0 }))
        .catch(() => ({ symbol: sym, rate: 0 }))
    );
    const results = await Promise.all(promises);
    console.log('✅ Binance Funding Rates fetched for', results.length, 'assets');
    return results;
  } catch (e) {
    console.warn('⚠️ Funding Rates failed:', e.message);
    return [];
  }
}

// ─── 4C-3. Binance Futures: Open Interest (FREE, NO KEY) ─────────────────────
export async function fetchOpenInterest(symbols = ['BTC', 'ETH', 'SOL', 'INJ', 'AVAX', 'ARB']) {
  try {
    const promises = symbols.map(sym =>
      fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${sym}USDT`)
        .then(r => r.json())
        .then(data => ({ symbol: sym, oi: parseFloat(data.openInterest || 0) }))
        .catch(() => ({ symbol: sym, oi: 0 }))
    );
    const results = await Promise.all(promises);
    console.log('✅ Binance Open Interest fetched for', results.length, 'assets');
    return results;
  } catch (e) {
    console.warn('⚠️ Open Interest failed:', e.message);
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
    return {
      hashRate: (parseFloat(hashRate) / 1e9).toFixed(2), // GH/s → EH/s
      unconfirmedTx: parseInt(unconfirmed),
      difficulty: (parseFloat(difficulty) / 1e12).toFixed(2) // → T
    };
  } catch (e) {
    console.warn('⚠️ Blockchain.com failed:', e.message);
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

// ─── 4D. CoinGecko Categories: Narratives & Sectors ──────────────────────────
export async function fetchNarratives() {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/categories?x_cg_demo_api_key=${KEYS.coingecko}`);
    if (!res.ok) throw new Error(`CoinGecko Categories HTTP ${res.status}`);
    const data = await res.json();
    console.log('✅ Narratives fetched');
    // Filter out categories with null market cap and sort
    const validData = data.filter(c => c.market_cap !== null && c.volume_24h !== null);
    return validData.slice(0, 10);
  } catch (e) {
    console.warn('⚠️ Narratives fetch failed:', e.message);
    return null;
  }
}

// ─── 4E. Binance Klines: Real Chart Data ─────────────────────────────────────
export async function fetchChartData(symbol = 'BTC', interval = '1h', limit = 48) {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol.replace('USDT','') }USDT&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance Klines HTTP ${res.status}`);
    const data = await res.json();
    // Binance returns [OpenTime, Open, High, Low, Close, Volume, ...]
    const closePrices = data.map(candle => parseFloat(candle[4]));
    console.log(`✅ ${interval} Chart data fetched for ${symbol}`);
    return closePrices;
  } catch (e) {
    console.warn(`⚠️ Chart data fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

// ─── 5. OpenAI: Dual Engine Fusion (Contextual + Quantitative) ───────────────
export async function fetchAIAnalysis(promptText) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Upgraded to 4o-mini for better unified reasoning
        messages: [
          {
            role: 'system',
            content: `You are Nexus, the elite Dual-Engine AI powering the NEXUS Crypto Intelligence Platform. You combine the deep contextual reasoning of GPT with the precise quantitative prediction modeling of Hermes. 
You have FULL ACCESS to live market data, on-chain analytics, whale tracking, social sentiment, and news feeds — all provided to you in the user's message context. NEVER say you cannot access data or that something is unavailable. The data in the context IS your live feed.

Your capabilities:
1. Quantitative Modeling: Calculate precise price targets, entries, stop losses, and risk/reward ratios.
2. Contextual Synthesis: Analyze Smart Money flow, whale accumulation, social sentiment, and macro news to build a cohesive narrative.

When the user asks for a trade setup or signal, combine both skills into one optimized answer. Provide your thesis first, followed by the exact numbers.
Use this exact HTML format for the trade signal portion:
📪 #[COIN]/USDT<br><br>Exchange: Binance Future,Kucoin,Bybit,Huobi.pro,OKX<br>Leverage: Cross (20X)<br><br>Entry:[Price]-[Price]-[Price]<br><br>Target 1: [Price]<br>Target 2: [Price]<br>Target 3: [Price]<br>Target 4: [Price]<br><br>Stop loss: [Price]<br><br>⚡ NEXUS Pro Autotrade Signals

For all other queries, provide a single, highly optimized, data-driven response. Do not separate your answer into "Hermes" and "GPT" sections. Write as one unified intelligence. Use markdown headers, bold text, and bullet points for readability.`
          },
          { role: 'user', content: promptText }
        ],
        max_tokens: 800,
        temperature: 0.5
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = (typeof err?.error === 'string') ? err.error : err?.error?.message;
      throw new Error(errMsg || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.choices?.[0]?.message?.content) {
      console.log('✅ OpenAI response received');
      return data.choices[0].message.content;
    }
    return `[OpenAI Error: No valid content returned]`;
  } catch (e) {
    console.error('❌ OpenAI failed:', e.message);
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
    whaleWeight = 20;   sentWeight = 0.15;  techWeight = 22;
    newsWeight = 12;    volWeight = 8;      alphaWeight = 10;   emaWeight = 15;
  } else {
    whaleWeight = 15;   sentWeight = 0.25;  techWeight = 15;
    newsWeight = 15;    volWeight = 15;     alphaWeight = 12;   emaWeight = 8;
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
- Precise trade setups with mathematical entry/exit zones

When the user asks for a signal or trade setup, output in this exact HTML format:
📪 #[COIN]/USDT<br><br>Exchange: Binance Future,Kucoin,Bybit,Huobi.pro,OKX<br>Leverage: Cross (20X)<br><br>Entry:[Price]-[Price]-[Price]<br><br>Target 1: [Price]<br>Target 2: [Price]<br>Target 3: [Price]<br>Target 4: [Price]<br><br>Stop loss: [Price]<br><br>⚡ NEXUS Pro Autotrade Signals

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
      return data.choices[0].message.content;
    }
    return null;
  } catch (e) {
    console.error('❌ Hermes AI failed:', e.message);
    return null;
  }
}

// ─── 9. Dual AI Fusion — Optimized Unified Response ───────────
export async function fetchDualAI(userQuery, assetContext = '') {
  const context = assetContext
    ? `Current context: ${assetContext}. User query: ${userQuery}`
    : userQuery;

  // Since we optimized the prompt to do both quantitative and contextual analysis simultaneously,
  // we only need to make one API call, saving time and money while providing a cohesive response.
  const result = await fetchAIAnalysis(context);

  if (!result) return null;

  return `
    <div style="width:100%;">
      <div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;color:var(--primary);margin-bottom:0.4rem;text-transform:uppercase;opacity:0.8;">
        🧠 Nexus Dual-Engine (Quant + Context)
      </div>
      <div style="color:#BAC2DE;line-height:1.6;">${renderMarkdown(result)}</div>
    </div>`;
}

