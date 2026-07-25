// ═══════════════════════════════════════════════════════
// Scoring Category: On-Chain (Whale flows + BTC health)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

export function scoreOnchain(index, symbol, cfg = {}) {
  const whaleMinValue = cfg.whale_min_value ?? 500;
  const mempoolCongested = cfg.mempool_congested ?? 150000;

  let score = 0;
  const factors = [];

  // ─── Whale Transactions ────────────────────────────
  // Aggregated from etherscan DataPoints
  // For now, we look for recent large whale moves
  const whaleTx = lookup(index, 'ETH', 'whale_tx');
  if (whaleTx && typeof whaleTx === 'object') {
    const val = Number(whaleTx.value || 0);
    if (val >= whaleMinValue) {
      // Large whale move detected — signals institutional activity
      score += 0.5;
      factors.push(`Whale activity detected: ${val.toFixed(0)} ETH moved`);
    }
  }

  // ─── BTC On-Chain Health (applies to all symbols) ──
  const hashrate = lookup(index, 'BTC', 'hashrate');
  if (hashrate != null) {
    // High hashrate = network security = bullish backdrop
    factors.push(`BTC hashrate: ${(hashrate / 1e6).toFixed(1)} EH/s`);
  }

  const unconfirmed = lookup(index, 'BTC', 'unconfirmed_txs');
  if (unconfirmed != null) {
    if (unconfirmed > mempoolCongested) {
      score -= 0.3;
      factors.push(`BTC mempool congested: ${unconfirmed.toLocaleString()} unconfirmed`);
    } else {
      factors.push(`BTC mempool healthy: ${unconfirmed.toLocaleString()} unconfirmed`);
    }
  }

  // ─── Mining Pool Distribution ──────────────────────
  const pools = lookup(index, 'BTC', 'mining_pools');
  if (Array.isArray(pools) && pools.length > 0) {
    const topPool = pools[0];
    factors.push(`Top mining pool: ${topPool.name} (${topPool.blocks} blocks/24h)`);
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
