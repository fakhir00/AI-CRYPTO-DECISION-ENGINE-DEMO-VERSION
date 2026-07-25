// ═══════════════════════════════════════════════════════
// Ingestion Layer — Shared Configuration
// ═══════════════════════════════════════════════════════
// Reads API keys from Vite env vars. Never hardcode keys.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const KEYS = Object.freeze({
  coingecko: env.VITE_COINGECKO_API_KEY || '',
  etherscan: env.VITE_ETHERSCAN_API_KEY || '',
  lunarcrush: env.VITE_LUNARCRUSH_API_KEY || '',
  taapi: env.VITE_TAAPI_SECRET || '',
});

/** Timeout-aware fetch wrapper. Rejects after `ms` milliseconds. */
export async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Safe JSON fetch with exponential backoff on 429 (Too Many Requests) */
export async function fetchJson(url, options = {}, timeoutMs = 8000, maxRetries = 3) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const res = await fetchWithTimeout(url, options, timeoutMs);
      return await res.json();
    } catch (e) {
      if (e.message.includes('HTTP 429') && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
        console.warn(`[rate-limit] 429 on ${url}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.warn(`[ingestion] ${url} failed:`, e.message);
      return null;
    }
  }
  return null;
}
