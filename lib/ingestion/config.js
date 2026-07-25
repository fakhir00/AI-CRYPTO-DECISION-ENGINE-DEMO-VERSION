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

/** Safe JSON fetch — returns parsed body or null on any failure. */
export async function fetchJson(url, options = {}, timeoutMs = 8000) {
  try {
    const res = await fetchWithTimeout(url, options, timeoutMs);
    return await res.json();
  } catch (e) {
    console.warn(`[ingestion] ${url} failed:`, e.message);
    return null;
  }
}
