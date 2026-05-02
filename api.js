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
            content: `You are Nexus, the AI engine powering the NEXUS Crypto Intelligence Platform. You have FULL ACCESS to live market data, on-chain analytics, whale tracking, social sentiment, and news feeds — all provided to you in the user's message context. NEVER say you cannot access data or that something is unavailable. The data in the context IS your live feed. Always analyze it confidently.

Your capabilities:
- Smart Money / Whale Flow analysis (use the price trends and volume data provided)
- On-chain intelligence (interpret the scores, biases, and confidence percentages)
- Social sentiment scanning (use the context to infer momentum)
- News & narrative analysis
- Trade signal generation with precise entries, targets, and stop losses
- Market overview and macro analysis

When generating trade signals, use this exact HTML format:
📪 #[COIN]/USDT<br><br>Exchange: Binance Future,Kucoin,Bybit,Huobi.pro,OKX<br>Leverage: Cross (20X)<br><br>Entry:[Price]-[Price]-[Price]<br><br>Target 1: [Price]<br>Target 2: [Price]<br>Target 3: [Price]<br>Target 4: [Price]<br><br>Stop loss: [Price]<br><br>⚡ NEXUS Pro Autotrade Signals

For all other queries, provide detailed, data-driven analysis using the live prices and metrics from the context. Format with markdown headers, bold text, and bullet points for readability.`
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
    .replace(/^###\s+(.+)$/gm, '<div style="font-size:0.95rem;font-weight:800;color:#fff;margin:1rem 0 0.5rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:0.4rem;">$1</div>')
    .replace(/^##\s+(.+)$/gm, '<div style="font-size:1.05rem;font-weight:800;color:#fff;margin:1.25rem 0 0.5rem;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:0.4rem;">$1</div>')
    .replace(/^#\s+(.+)$/gm, '<div style="font-size:1.15rem;font-weight:900;color:#fff;margin:1.25rem 0 0.5rem;">$1</div>')
    // Unordered lists (asterisks, dashes, bullets)
    .replace(/^\s*[-•*]\s+(.+)$/gm, '<div style="padding-left:0.5rem;margin:0.4rem 0;display:flex;gap:0.5rem;"><span style="color:var(--primary);flex-shrink:0;">▸</span><span>$1</span></div>')
    // Numbered lists
    .replace(/^\s*\d+\.\s+(.+)$/gm, '<div style="padding-left:0.5rem;margin:0.4rem 0;display:flex;gap:0.5rem;"><span style="color:var(--primary);flex-shrink:0;">▸</span><span>$1</span></div>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>')
    // Italic
    .replace(/\b_(.*?)_\b/g, '<em>$1</em>') // use word boundaries for italic to avoid breaking urls
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(139,120,255,0.15);padding:0.15rem 0.4rem;border-radius:4px;font-size:0.85em;color:var(--primary);">$1</code>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:1rem 0;"/>')
    // Line breaks
    .replace(/\n\n/g, '<div style="margin-bottom:0.75rem;"></div>')
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

// ─── 9. Dual AI Fusion — Combines Hermes + GPT for maximum insight ───────────
export async function fetchDualAI(userQuery, assetContext = '') {
  const context = assetContext
    ? `Current context: ${assetContext}. User query: ${userQuery}`
    : userQuery;

  // Fire both in parallel (both use OpenAI now)
  const [hermesResult, openaiResult] = await Promise.allSettled([
    fetchHermesAnalysis(context),
    fetchAIAnalysis(context)
  ]);

  const hermes = hermesResult.status === 'fulfilled' ? hermesResult.value : null;
  const openai = openaiResult.status === 'fulfilled' ? openaiResult.value : null;

  // Both succeeded — show fusion output
  if (hermes && openai) {
    return `
      <div style="margin-bottom:1.5rem;">
        <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:var(--primary);margin-bottom:0.75rem;text-transform:uppercase;">
          🔮 Hermes Quantitative Prediction
        </div>
        <div style="color:#BAC2DE;line-height:1.7;">${renderMarkdown(hermes)}</div>
      </div>
      <hr style="border-color:var(--border-color);margin:1rem 0;"/>
      <div>
        <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:#10B981;margin-bottom:0.75rem;text-transform:uppercase;">
          🧠 GPT Contextual Analysis
        </div>
        <div style="color:#BAC2DE;line-height:1.7;">${renderMarkdown(openai)}</div>
      </div>`;
  }

  // Fallback to whichever responded
  const result = hermes || openai || null;
  if (!result) return null;

  return `
    <div>
      <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.1em;color:#10B981;margin-bottom:0.75rem;text-transform:uppercase;">
        🧠 Nexus AI Analysis
      </div>
      <div style="color:#BAC2DE;line-height:1.7;">${renderMarkdown(result)}</div>
    </div>`;
}

