// ═══════════════════════════════════════════════════════
// Dune Analytics — On-Chain Market Pulse (via proxy)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

// Goes through the existing api/dune.js Vercel serverless proxy
// which holds the Dune API key server-side.
export async function fetchDuneMarketPulse() {
  const raw = await fetchJson('/api/dune', {}, 15000);
  if (!raw) return [];
  // The proxy returns a pre-shaped object; wrap it as a DataPoint.
  return [createDataPoint('dune', '*', 'market_pulse', raw)];
}
