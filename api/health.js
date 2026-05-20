import { getServerEnv, hasAnyEnv } from '../lib/server-env.js';

async function checkJson(name, url, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...(options.headers || {}) },
      signal: AbortSignal.timeout(options.timeoutMs || 7000)
    });

    return {
      name,
      status: response.ok ? 'ok' : 'failed',
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      name,
      status: 'failed',
      detail: error.message,
      latencyMs: Date.now() - startedAt
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const cmcKey = getServerEnv('CMC_API_KEY', 'VITE_CMC_API_KEY');
  const checks = await Promise.all([
    checkJson('Binance Spot', 'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
    checkJson('Binance Futures', 'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT'),
    checkJson('CoinGecko Trending', 'https://api.coingecko.com/api/v3/search/trending'),
    checkJson('DefiLlama Pools', 'https://yields.llama.fi/pools'),
    checkJson('Fear & Greed', 'https://api.alternative.me/fng/'),
    cmcKey
      ? checkJson('CoinMarketCap Global', 'https://pro-api.coinmarketcap.com/v1/global-metrics/quotes/latest', {
          headers: { 'X-CMC_PRO_API_KEY': cmcKey }
        })
      : Promise.resolve({
          name: 'CoinMarketCap Global',
          status: 'degraded',
          detail: 'Server key not configured; Binance fallback is active in the SaaS.'
        })
  ]);

  const configured = {
    openai: hasAnyEnv('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY'),
    groqHermes: hasAnyEnv('GROQ_API_KEY', 'VITE_GROQ_API_KEY'),
    dune: hasAnyEnv('DUNE_API_KEY', 'VITE_DUNE_API_KEY'),
    supabaseUrl: hasAnyEnv('VITE_SUPABASE_URL'),
    supabaseAnon: hasAnyEnv('VITE_SUPABASE_ANON_KEY'),
    supabaseServiceRole: hasAnyEnv('SUPABASE_SERVICE_ROLE_KEY'),
    clerk: hasAnyEnv('VITE_CLERK_PUBLISHABLE_KEY'),
    coinMarketCap: Boolean(cmcKey),
    coingecko: hasAnyEnv('COINGECKO_API_KEY', 'VITE_COINGECKO_API_KEY'),
    taapi: hasAnyEnv('TAAPI_KEY', 'VITE_TAAPI_KEY'),
    lunarCrush: hasAnyEnv('LUNARCRUSH_KEY', 'VITE_LUNARCRUSH_KEY'),
    etherscan: hasAnyEnv('ETHERSCAN_API_KEY', 'VITE_ETHERSCAN_API_KEY')
  };

  const ok = checks.filter(check => check.status === 'ok').length;
  const degraded = checks.filter(check => check.status === 'degraded').length;
  const failed = checks.filter(check => check.status === 'failed').length;
  const notConfigured = checks.filter(check => check.status === 'not_configured').length;

  return res.status(200).json({
    source: 'nexus_api_health',
    asOf: new Date().toISOString(),
    summary: {
      checked: checks.length,
      ok,
      degraded,
      failed,
      notConfigured
    },
    configured,
    checks
  });
}
