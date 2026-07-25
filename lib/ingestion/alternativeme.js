// ═══════════════════════════════════════════════════════
// Alternative.me — Fear & Greed Index (no API key)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const URL = 'https://api.alternative.me/fng/?limit=1&format=json';

export async function fetchFearAndGreed() {
  const raw = await fetchJson(URL);
  if (!raw?.data?.[0]) return [];
  const d = raw.data[0];
  return [createDataPoint('alternativeme', '*', 'fear_greed', {
    value: parseInt(d.value, 10),
    label: d.value_classification,
    timestamp: parseInt(d.timestamp, 10) * 1000,
  })];
}
