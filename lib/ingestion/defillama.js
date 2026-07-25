// ═══════════════════════════════════════════════════════
// DeFi Llama — Top Yield Pools (no API key)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const POOLS_URL = 'https://yields.llama.fi/pools';

export async function fetchTopPools(limit = 20) {
  const raw = await fetchJson(POOLS_URL, {}, 10000);
  if (!raw?.data) return [];

  const top = raw.data
    .filter(p => p.tvlUsd > 1_000_000 && p.apy > 0)
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, limit);

  return top.map(p =>
    createDataPoint('defillama', String(p.symbol || '').toUpperCase(), 'defi_pool', {
      pool:     p.pool,
      project:  p.project,
      chain:    p.chain,
      tvl:      p.tvlUsd,
      apy:      p.apy,
      apyBase:  p.apyBase,
      apyReward: p.apyReward,
      stablecoin: p.stablecoin,
    })
  );
}
