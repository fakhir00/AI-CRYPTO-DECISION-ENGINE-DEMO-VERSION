// ═══════════════════════════════════════════════════════
// LunarCrush — Social Sentiment & Volume
// ═══════════════════════════════════════════════════════
import { KEYS, fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://lunarcrush.com/api4/public/coins/list/v2';

export async function fetchSocialMetrics(symbols = []) {
  if (!KEYS.lunarcrush) {
    console.warn('[lunarcrush] No API key — skipping');
    return [];
  }

  // LunarCrush /coins/list/v2 fetches a large batch of top coins
  // We specify limit=200 to ensure we capture the full universe
  const raw = await fetchJson(`${BASE}?limit=200`, {
    headers: { Authorization: `Bearer ${KEYS.lunarcrush}` },
  });

  if (!raw?.data || !Array.isArray(raw.data)) return [];

  const validSymbols = new Set(symbols.length > 0 ? symbols : ['BTC', 'ETH', 'SOL']);

  return raw.data
    .filter(c => validSymbols.has(String(c.symbol || c.s).toUpperCase()))
    .map(c =>
      createDataPoint('lunarcrush', String(c.symbol || c.s).toUpperCase(), 'social', {
        name:           c.name || c.n,
        socialVolume:   c.social_volume || c.sv,
        socialScore:    c.social_score || c.ss,
        sentiment:      c.average_sentiment || c.as,
        galaxyScore:    c.galaxy_score || c.gs,
        altRank:        c.alt_rank || c.acr,
        contributors:   c.social_contributors || c.sc,
      })
    );
}
