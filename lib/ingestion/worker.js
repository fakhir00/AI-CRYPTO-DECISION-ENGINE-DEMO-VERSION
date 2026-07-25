// ═══════════════════════════════════════════════════════
// Ingestion Worker — Orchestrates all source adapters
// ═══════════════════════════════════════════════════════
// Runs each source at its configured interval, caches results,
// and maintains a unified DataPoint store for the scoring engine.

import { cachedFetch, ttlFor } from './cache.js';

// ─── Source Adapters ────────────────────────────────────
import { fetchTickers, fetchKlines, fetchFundingRates, fetchOpenInterestBatch, fetchDepth } from './binance.js';
import { fetchMarkets, fetchTrending, fetchCategories, fetchGlobal } from './coingecko.js';
import { fetchWhaleTransactions } from './etherscan.js';
import { fetchBtcOnChain } from './blockchain.js';
import { fetchDuneMarketPulse } from './dune.js';
import { fetchTopPools } from './defillama.js';
import { fetchSocialMetrics } from './lunarcrush.js';
import { fetchHotPosts } from './reddit.js';
import { fetchFearAndGreed } from './alternativeme.js';
import { fetchNews } from './rss.js';
import { fetchTechnicalsBatch } from './taapi.js';

// ─── Source registry ────────────────────────────────────
// Each entry: { key, fetchFn, ttlKey }
// key = cache key, fetchFn = async () => DataPoint[], ttlKey = TTLS lookup key
const SCORING_SYMBOLS = ['BTC', 'ETH', 'SOL'];

const SOURCES = [
  // Fast-cycle sources (tickers, klines)
  { key: 'binance_tickers',       fn: fetchTickers,                         ttl: 'binance_tickers' },
  { key: 'binance_funding',       fn: fetchFundingRates,                    ttl: 'binance_funding' },
  { key: 'binance_oi',            fn: () => fetchOpenInterestBatch(SCORING_SYMBOLS), ttl: 'binance_oi' },
  { key: 'binance_depth_btc',     fn: () => fetchDepth('BTC'),              ttl: 'binance_depth' },

  // Per-symbol klines (one entry per symbol)
  ...SCORING_SYMBOLS.map(s => ({
    key: `binance_klines_${s}`,
    fn:  () => fetchKlines(s, '15m', 200),
    ttl: 'binance_klines',
  })),

  // Medium-cycle sources
  { key: 'coingecko_markets',     fn: fetchMarkets,                         ttl: 'coingecko_markets' },
  { key: 'coingecko_trending',    fn: fetchTrending,                        ttl: 'coingecko_trending' },
  { key: 'coingecko_categories',  fn: fetchCategories,                      ttl: 'coingecko_categories' },
  { key: 'coingecko_global',      fn: fetchGlobal,                          ttl: 'coingecko_markets' },

  // Slow-cycle sources
  { key: 'etherscan',             fn: fetchWhaleTransactions,               ttl: 'etherscan' },
  { key: 'blockchain',            fn: fetchBtcOnChain,                      ttl: 'blockchain' },
  { key: 'dune',                  fn: fetchDuneMarketPulse,                 ttl: 'dune' },
  { key: 'defillama',             fn: fetchTopPools,                        ttl: 'defillama' },
  { key: 'lunarcrush',            fn: fetchSocialMetrics,                   ttl: 'lunarcrush' },
  { key: 'reddit',                fn: fetchHotPosts,                        ttl: 'reddit' },
  { key: 'alternativeme',         fn: fetchFearAndGreed,                    ttl: 'alternativeme' },
  { key: 'rss_news',              fn: fetchNews,                            ttl: 'rss_news' },
  { key: 'taapi',                 fn: () => fetchTechnicalsBatch(SCORING_SYMBOLS), ttl: 'taapi' },
];

// ─── Single-pass ingestion ──────────────────────────────
// Fetches all sources (respecting cache TTLs), returns merged DataPoint array.
export async function ingestAll() {
  const t0 = Date.now();
  const results = await Promise.allSettled(
    SOURCES.map(({ key, fn, ttl }) =>
      cachedFetch(key, fn, ttlFor(ttl))
    )
  );

  const allPoints = [];
  const report = { fetched: 0, cached: 0, failed: 0, sources: {} };

  for (let i = 0; i < SOURCES.length; i++) {
    const { key } = SOURCES[i];
    const r = results[i];
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allPoints.push(...r.value);
      report.sources[key] = r.value.length;
      report.fetched++;
    } else if (r.status === 'fulfilled' && r.value === null) {
      report.sources[key] = 'cached';
      report.cached++;
    } else {
      report.sources[key] = 'failed';
      report.failed++;
    }
  }

  report.totalPoints = allPoints.length;
  report.elapsedMs = Date.now() - t0;
  console.log(`[worker] Ingestion complete: ${allPoints.length} points in ${report.elapsedMs}ms (${report.fetched} fresh, ${report.cached} cached, ${report.failed} failed)`);

  return { points: allPoints, report };
}

// ─── Fetch a single source (for targeted refresh) ──────
export async function ingestSource(sourceKey) {
  const entry = SOURCES.find(s => s.key === sourceKey);
  if (!entry) throw new Error(`Unknown source: ${sourceKey}`);
  return cachedFetch(entry.key, entry.fn, ttlFor(entry.ttl));
}

// ─── Scheduled loop (for client-side use) ───────────────
let _intervalId = null;

export function startWorker(intervalMs = 60_000) {
  if (_intervalId) return; // already running
  console.log(`[worker] Starting ingestion loop (every ${intervalMs / 1000}s)`);
  // Run immediately, then on interval
  ingestAll().catch(e => console.warn('[worker] Initial ingestion error:', e.message));
  _intervalId = setInterval(() => {
    ingestAll().catch(e => console.warn('[worker] Ingestion error:', e.message));
  }, intervalMs);
}

export function stopWorker() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    console.log('[worker] Ingestion loop stopped');
  }
}

export { SOURCES, SCORING_SYMBOLS };
