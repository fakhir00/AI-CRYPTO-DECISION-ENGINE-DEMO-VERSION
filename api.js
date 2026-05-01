// ====================================================
// NEXUS API Engine — All external data integrations
// ====================================================

const KEYS = {
  coingecko: 'CG-7gTv8kk2qS7r8kj515m2rVQJ',
  cmc: 'e7080786d0f14b3abfc6c58de5f61adc',
  etherscan: 'CRSWB6SIH2SAAPCPFGBK2NN473EC5JIS9M'
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

// ─── 4. Reddit: Live sentiment from r/CryptoCurrency ─────────────────────────
export async function fetchSentiment() {
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
    return { bullish, bearish, score };
  } catch (e) {
    console.warn('⚠️ Reddit failed:', e.message);
    return { bullish: 5, bearish: 3, score: 62 };
  }
}

// ─── 5. OpenAI: AI analysis via secure Vite proxy / Vercel Function ──────────
export async function fetchAIAnalysis(promptText) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are Nexus, an elite quantitative crypto trading AI. Provide concise, professional HTML-formatted responses. If the user asks for a trading "signal", you MUST output exactly in this format using HTML <br> tags: 📪 #[COIN]/USDT<br><br>Exchange: Binance Future,Kucoin,Bybit,Huobi.pro,OKX<br>Leverage: Cross (20X)<br><br>Entry:[Entry Price]-[Entry Price]-[Entry Price]<br><br>Target 1: [Target Price]<br>Target 2: [Target Price]<br>Target 3: [Target Price]<br>Target 4: [Target Price]<br><br>Stop loss: [Stop Price]<br><br> predictum Pro Autotrade Signals'
          },
          { role: 'user', content: promptText }
        ],
        max_tokens: 500,
        temperature: 0.7
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

// ─── 6. Alpha Score Engine ────────────────────────────────────────────────────
export function calculateAlphaScore(whaleActive, sentimentScore, techScore, newsScore, volScore, alphaSources) {
  const raw =
    (whaleActive ? 25 : 0) +
    (sentimentScore * 0.2) +
    (techScore * 20) +
    (newsScore * 15) +
    (volScore * 10) +
    (alphaSources * 15);
  return Math.min(100, Math.max(0, Math.round(raw)));
}


// ─── 8. AI Analysis Handler ────────────────────────────────────────────────────
// Connects to OpenAI for Command Center responses
export async function fetchDualAI(userQuery, assetContext = '') {
  const context = assetContext
    ? `Current context: ${assetContext}. User query: ${userQuery}`
    : userQuery;

  // Since Groq was removed, we just return the OpenAI result directly.
  // The function is still called fetchDualAI to maintain compatibility with main.js
  const result = await fetchAIAnalysis(context);
  
  if (!result || result.startsWith('[OpenAI')) {
     // If it failed or returned an error string
     return result || null; 
  }

  // Format it nicely for the UI
  return `
    <div>
      <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:#10B981;margin-bottom:0.75rem;text-transform:uppercase;">
        🧠 Nexus AI Analysis
      </div>
      <div style="color:#BAC2DE;line-height:1.7;">${result}</div>
    </div>`;
}

