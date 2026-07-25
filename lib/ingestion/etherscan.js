// ═══════════════════════════════════════════════════════
// Etherscan — Whale Transaction Monitoring
// ═══════════════════════════════════════════════════════
import { KEYS, fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://api.etherscan.io/api';

// Top-10 known exchange/whale addresses to monitor for large moves
const WHALE_ADDRESSES = [
  '0x28c6c06298d514db089934071355e5743bf21d60', // Binance Hot Wallet
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549', // Binance Cold Wallet
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d', // Binance
  '0x56eddb7aa87536c09ccc2793473599fd21a8b17f', // Bitfinex
  '0x742d35cc6634c0532925a3b844bc9e7595f2bd1e', // Bitfinex
];

export async function fetchWhaleTransactions() {
  if (!KEYS.etherscan) {
    console.warn('[etherscan] No API key — skipping whale fetch');
    return [];
  }
  const results = await Promise.allSettled(
    WHALE_ADDRESSES.slice(0, 3).map(addr =>
      fetchJson(`${BASE}?module=account&action=txlist&address=${addr}&startblock=0&endblock=99999999&page=1&offset=5&sort=desc&apikey=${KEYS.etherscan}`)
    )
  );

  const points = [];
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.result) continue;
    const txs = Array.isArray(r.value.result) ? r.value.result : [];
    for (const tx of txs) {
      const ethValue = parseFloat(tx.value) / 1e18;
      if (ethValue < 100) continue; // Only track large moves (>100 ETH)
      points.push(createDataPoint('etherscan', 'ETH', 'whale_tx', {
        hash:      tx.hash,
        from:      tx.from,
        to:        tx.to,
        value:     ethValue,
        gas:       tx.gasUsed,
        timestamp: parseInt(tx.timeStamp, 10) * 1000,
        block:     tx.blockNumber,
      }));
    }
  }
  return points;
}
