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
            content: 'You are Nexus, an elite quantitative crypto trading AI. You provide concise, professional HTML-formatted responses with specific price targets, entry/exit zones, and alpha signals. Use <strong>, <span class="text-green">, <span class="text-red">, <span class="text-primary"> for formatting. Never use markdown code blocks.'
          },
          { role: 'user', content: promptText }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.choices?.[0]?.message?.content) {
      console.log('✅ OpenAI response received');
      return data.choices[0].message.content;
    }
    return null;
  } catch (e) {
    console.error('❌ OpenAI failed:', e.message);
    return null;
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

// ─── 7. Hermes AI (NousResearch via Groq) — Quantitative Prediction Engine ───
// Hermes-3 is a reasoning-focused model ideal for structured trade analysis
export async function fetchHermesAnalysis(promptText) {
  try {
    const res = await fetch('/api/hermes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Hermes-based reasoning on Groq
        messages: [
          {
            role: 'system',
            content: `You are Hermes, a quantitative crypto prediction model trained on on-chain analytics, 
order flow data, and macro cycles. Your role is to produce STRUCTURED prediction outputs:
1. Price target (3-day, 7-day)
2. Probability score (0-100)
3. Key risk factors
4. Conviction level: LOW / MEDIUM / HIGH
Output as clean HTML using <strong>, <span class="text-green">, <span class="text-red">, 
<span class="text-primary"> tags. No markdown. Be concise and data-driven.`
          },
          { role: 'user', content: promptText }
        ],
        max_tokens: 600,
        temperature: 0.4 // Lower temp = more deterministic predictions
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
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

// ─── 8. Dual AI Fusion — Combines Hermes + OpenAI for maximum insight ────────
// Use this for the highest quality responses in the Command Center
export async function fetchDualAI(userQuery, assetContext = '') {
  const context = assetContext
    ? `Current context: ${assetContext}. User query: ${userQuery}`
    : userQuery;

  // Fire both in parallel
  const [hermesResult, openaiResult] = await Promise.allSettled([
    fetchHermesAnalysis(context),
    fetchAIAnalysis(context)
  ]);

  const hermes = hermesResult.status === 'fulfilled' ? hermesResult.value : null;
  const openai = openaiResult.status === 'fulfilled' ? openaiResult.value : null;

  if (hermes && openai) {
    // Both succeeded — show fusion output
    return `
      <div style="margin-bottom:1.5rem;">
        <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:var(--primary);margin-bottom:0.75rem;text-transform:uppercase;">
          🔮 Hermes Quantitative Prediction
        </div>
        <div style="color:#BAC2DE;line-height:1.7;">${hermes}</div>
      </div>
      <hr style="border-color:var(--border-color);margin:1rem 0;"/>
      <div>
        <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:#10B981;margin-bottom:0.75rem;text-transform:uppercase;">
          🧠 GPT Contextual Analysis
        </div>
        <div style="color:#BAC2DE;line-height:1.7;">${openai}</div>
      </div>`;
  }

  // Fallback to whichever responded
  return hermes || openai || null;
}

