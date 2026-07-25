// ═══════════════════════════════════════════════════════
// LunarCrush — Social Sentiment & Volume
// ═══════════════════════════════════════════════════════
import { KEYS, fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://lunarcrush.com/api4/public/coins/list/v2';

export async function fetchSocialMetrics() {
  if (!KEYS.lunarcrush) {
    console.warn('[lunarcrush] No API key — skipping');
    return [];
  }

  const raw = await fetchJson(BASE, {
    headers: { Authorization: `Bearer ${KEYS.lunarcrush}` },
  });

  if (!raw?.data || !Array.isArray(raw.data)) return [];

  return raw.data.slice(0, 50).map(c =>
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
