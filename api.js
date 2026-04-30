// API Keys Configuration
const KEYS = {
  coingecko: 'CG-7gTv8kk2qS7r8kj515m2rVQJ',
  cmc: 'e7080786d0f14b3abfc6c58de5f61adc',
  etherscan: 'CRSWB6SIH2SAAPCPFGBK2NN473EC5JIS9M',
  openai: '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'
};

// 1. CoinGecko (Market Data)
export async function fetchMarketData() {
  try {
    const coins = ['bitcoin', 'ethereum', 'solana', 'injective-protocol', 'ondo-finance', 'avalanche-2', 'arbitrum'];
    const ids = coins.join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&x_cg_demo_api_key=${KEYS.coingecko}`);
    if(!res.ok) throw new Error('CG Error');
    return await res.json();
  } catch(e) {
    console.error("CoinGecko Fetch failed", e);
    return null;
  }
}

// 2. CoinMarketCap (Global Data) via Vite Proxy
export async function fetchGlobalMarketData() {
  try {
    const res = await fetch('/api/cmc/v1/global-metrics/quotes/latest', {
      headers: {
        'X-CMC_PRO_API_KEY': KEYS.cmc,
        'Accept': 'application/json'
      }
    });
    if(!res.ok) throw new Error('CMC Error');
    return await res.json();
  } catch (e) {
    console.error("CMC Fetch failed", e);
    return null;
  }
}

// 3. Etherscan (Whale Data)
export async function fetchWhaleActivity() {
  try {
    // Fetching recent transactions for USDC as a proxy for smart money / whales
    const usdcContract = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const res = await fetch(`https://api.etherscan.io/api?module=account&action=tokentx&contractaddress=${usdcContract}&page=1&offset=50&sort=desc&apikey=${KEYS.etherscan}`);
    const data = await res.json();
    if(data.status === "1" && data.result) {
       // filter out > $500k
       const whales = data.result.filter(tx => (parseInt(tx.value) / 1e6) > 500000);
       return whales.map(tx => ({
          hash: tx.hash,
          value: parseInt(tx.value) / 1e6,
          token: tx.tokenSymbol
       }));
    }
    return [];
  } catch(e) {
    console.error("Etherscan Fetch failed", e);
    return [];
  }
}

// 4. Reddit Sentiment
export async function fetchSentiment() {
  try {
    const res = await fetch('https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25');
    const data = await res.json();
    const titles = data.data.children.map(c => c.data.title.toLowerCase());
    
    let bullish = 0; let bearish = 0;
    titles.forEach(t => {
       if (t.includes('buy') || t.includes('moon') || t.includes('bull') || t.includes('pump') || t.includes('up')) bullish++;
       if (t.includes('sell') || t.includes('dump') || t.includes('bear') || t.includes('crash') || t.includes('down')) bearish++;
    });
    
    let score = 50;
    if (bullish > bearish) score = Math.min(100, 50 + (bullish*5));
    else if (bearish > bullish) score = Math.max(0, 50 - (bearish*5));
    
    return { bullish, bearish, score };
  } catch(e) {
    console.error("Reddit Fetch failed", e);
    return { bullish: 0, bearish: 0, score: 50 };
  }
}

// 5. OpenAI Engine via Vite Proxy
export async function fetchAIAnalysis(promptText) {
  try {
    const res = await fetch('/api/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEYS.openai}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: promptText }]
      })
    });
    const data = await res.json();
    if(data.choices && data.choices[0]) return data.choices[0].message.content;
    return null;
  } catch(e) {
    console.error("OpenAI Fetch failed", e);
    return null;
  }
}

export function calculateAlphaScore(whaleActive, sentimentScore, techScore, newsScore, volScore, alphaSources) {
  let alpha = (whaleActive ? 25 : 0) +
              (sentimentScore * 0.2) +
              (techScore * 20) +
              (newsScore * 15) +
              (volScore * 10) +
              (alphaSources * 15);
  
  // Normalize to 100
  return Math.min(100, Math.round(alpha));
}
