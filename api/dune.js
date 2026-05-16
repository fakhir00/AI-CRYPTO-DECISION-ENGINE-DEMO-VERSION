// ═══════════════════════════════════════════════════════════════
// NEXUS Dune Proxy — Server-side macro on-chain intelligence
// ═══════════════════════════════════════════════════════════════

const DUNE_BASE_URL = 'https://api.dune.com/api/v1';
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const EXEC_TIMEOUT_MS = 18 * 1000;  // bounded to keep UI responsive
const POLL_INTERVAL_MS = 900;
const DUNE_FALLBACK_API_KEY = 'oisWtTIfQ7fLOSHZcoSx1Sns76TKoVkQ';

let cachedPayload = null;
let cacheTimestamp = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pctChange(current, previous) {
  const c = toNumber(current, 0);
  const p = toNumber(previous, 0);
  if (Math.abs(p) < 1e-9) return c > 0 ? 100 : 0;
  return ((c - p) / Math.abs(p)) * 100;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function duneRequest(path, apiKey, options = {}) {
  const headers = {
    'X-Dune-Api-Key': apiKey,
    ...options.headers
  };

  const res = await fetch(`${DUNE_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Dune ${path} HTTP ${res.status}${errText ? `: ${errText.slice(0, 180)}` : ''}`);
  }

  return res.json();
}

async function executeDuneSql(sql, apiKey, performance = 'medium') {
  const executePayload = await duneRequest('/sql/execute', apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, performance })
  });

  const executionId = executePayload?.execution_id;
  if (!executionId) throw new Error('Dune execution_id missing');

  const deadline = Date.now() + EXEC_TIMEOUT_MS;
  let lastState = String(executePayload?.state || '');

  while (Date.now() < deadline) {
    const status = await duneRequest(`/execution/${executionId}/status`, apiKey);
    lastState = String(status?.state || '');

    if (lastState === 'QUERY_STATE_COMPLETED' || lastState === 'QUERY_STATE_COMPLETED_PARTIAL') {
      const resultPayload = await duneRequest(`/execution/${executionId}/results`, apiKey);
      return resultPayload?.result?.rows || [];
    }

    if (
      lastState === 'QUERY_STATE_FAILED' ||
      lastState === 'QUERY_STATE_CANCELED' ||
      lastState === 'QUERY_STATE_EXPIRED'
    ) {
      const errMsg = status?.error?.message || status?.error?.type || lastState;
      throw new Error(`Dune execution failed: ${errMsg}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Dune execution timeout (${lastState || 'pending'})`);
}

function buildPulseFromRows(rows = []) {
  const row = rows[0] || {};

  const volume24h = toNumber(row.volume_24h);
  const volumePrev24h = toNumber(row.volume_prev_24h);
  const trades24h = toNumber(row.trades_24h);
  const uniqueTraders24h = toNumber(row.unique_traders_24h);
  const btcTx24h = toNumber(row.btc_txs_24h);
  const btcTxPrev24h = toNumber(row.btc_txs_prev_24h);

  const volumeGrowthPct = pctChange(volume24h, volumePrev24h);
  const btcTxGrowthPct = pctChange(btcTx24h, btcTxPrev24h);
  const traderDepthScore = clamp((Math.log10(uniqueTraders24h + 1) - 4.2) * 12, -12, 12);
  const tradeFlowScore = clamp((Math.log10(trades24h + 1) - 5.3) * 7, -8, 8);

  const signalScore = clamp(
    50 + (volumeGrowthPct * 0.28) + (btcTxGrowthPct * 0.18) + traderDepthScore + tradeFlowScore,
    0,
    100
  );

  const bias = signalScore >= 57 ? 'bullish' : (signalScore <= 43 ? 'bearish' : 'neutral');

  return {
    volume24h,
    volumePrev24h,
    volumeGrowthPct,
    trades24h,
    uniqueTraders24h,
    btcTx24h,
    btcTxPrev24h,
    btcTxGrowthPct,
    signalScore,
    bias
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (cachedPayload && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return res.status(200).json({
      source: 'cache',
      asOf: new Date(cacheTimestamp).toISOString(),
      data: cachedPayload
    });
  }

  const apiKey = process.env.DUNE_API_KEY || process.env.VITE_DUNE_API_KEY || DUNE_FALLBACK_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      source: 'disabled',
      asOf: new Date().toISOString(),
      data: null,
      warning: 'DUNE_API_KEY is not configured.'
    });
  }

  // Single compact query keeps credit usage low while adding useful macro context.
  const sql = `
WITH dex_window AS (
  SELECT
    block_time,
    amount_usd,
    tx_from
  FROM dex.trades
  WHERE block_time >= NOW() - INTERVAL '48' HOUR
    AND blockchain IN ('ethereum', 'arbitrum', 'base', 'optimism')
),
btc_window AS (
  SELECT block_time
  FROM bitcoin.transactions
  WHERE block_time >= NOW() - INTERVAL '48' HOUR
)
SELECT
  COALESCE(SUM(CASE WHEN block_time >= NOW() - INTERVAL '24' HOUR THEN amount_usd END), 0) AS volume_24h,
  COALESCE(SUM(CASE WHEN block_time < NOW() - INTERVAL '24' HOUR THEN amount_usd END), 0) AS volume_prev_24h,
  COUNT(CASE WHEN block_time >= NOW() - INTERVAL '24' HOUR THEN 1 END) AS trades_24h,
  COUNT(DISTINCT CASE WHEN block_time >= NOW() - INTERVAL '24' HOUR THEN tx_from END) AS unique_traders_24h,
  (SELECT COUNT(CASE WHEN block_time >= NOW() - INTERVAL '24' HOUR THEN 1 END) FROM btc_window) AS btc_txs_24h,
  (SELECT COUNT(CASE WHEN block_time < NOW() - INTERVAL '24' HOUR THEN 1 END) FROM btc_window) AS btc_txs_prev_24h
FROM dex_window
`;

  try {
    const rows = await executeDuneSql(sql, apiKey, 'medium');
    const pulse = buildPulseFromRows(rows);

    cachedPayload = pulse;
    cacheTimestamp = Date.now();

    return res.status(200).json({
      source: 'dune_sql',
      asOf: new Date(cacheTimestamp).toISOString(),
      data: pulse
    });
  } catch (error) {
    console.error('Dune Proxy Error:', error.message);
    if (cachedPayload) {
      return res.status(200).json({
        source: 'stale-cache',
        asOf: new Date(cacheTimestamp).toISOString(),
        data: cachedPayload,
        warning: error.message
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch Dune market pulse',
      detail: error.message
    });
  }
}
