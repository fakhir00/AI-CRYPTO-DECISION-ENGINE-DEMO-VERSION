// ═══════════════════════════════════════════════════════
// Blockchain.info — BTC On-Chain Health
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://api.blockchain.info';

export async function fetchBtcOnChain() {
  const [stats, pool, unconfirmed] = await Promise.allSettled([
    fetchJson(`${BASE}/stats?format=json`),
    fetchJson(`${BASE}/pools?timespan=24hours&format=json`),
    fetchJson('https://blockchain.info/q/unconfirmedcount'),
  ]);

  const points = [];
  const s = stats.status === 'fulfilled' ? stats.value : null;
  if (s) {
    points.push(
      createDataPoint('blockchain', 'BTC', 'hashrate',       s.hash_rate),
      createDataPoint('blockchain', 'BTC', 'difficulty',     s.difficulty),
      createDataPoint('blockchain', 'BTC', 'blocks_mined',   s.n_blocks_mined),
      createDataPoint('blockchain', 'BTC', 'minutes_between_blocks', s.minutes_between_blocks),
      createDataPoint('blockchain', 'BTC', 'total_btc',      s.totalbc / 1e8),
      createDataPoint('blockchain', 'BTC', 'market_price',   s.market_price_usd),
      createDataPoint('blockchain', 'BTC', 'trade_volume',   s.trade_volume_usd),
    );
  }

  const p = pool.status === 'fulfilled' ? pool.value : null;
  if (p && typeof p === 'object') {
    const topPools = Object.entries(p)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, blocks]) => ({ name, blocks }));
    points.push(createDataPoint('blockchain', 'BTC', 'mining_pools', topPools));
  }

  const uc = unconfirmed.status === 'fulfilled' ? unconfirmed.value : null;
  if (uc !== null) {
    points.push(createDataPoint('blockchain', 'BTC', 'unconfirmed_txs', Number(uc)));
  }

  return points;
}
