// ═══════════════════════════════════════════════════════
// Ingestion Layer — Dual Cache (Memory + Supabase)
// ═══════════════════════════════════════════════════════
// Memory: fast, per-process, volatile.
// Supabase global_market_cache: persistent, cross-device.
// Reads: memory → Supabase → miss.
// Writes: memory + Supabase (fire-and-forget).

const mem = new Map();

// TTLs in ms, tuned to each source's update frequency.
const TTLS = {
  binance_tickers:      10_000,
  binance_klines:       60_000,
  binance_funding:      60_000,
  binance_oi:           60_000,
  binance_depth:        30_000,
  coingecko_markets:   120_000,
  coingecko_trending:  300_000,
  coingecko_categories:300_000,
  etherscan:           300_000,
  blockchain:          300_000,
  dune:                600_000,
  defillama:           300_000,
  lunarcrush:          300_000,
  reddit:              300_000,
  alternativeme:     1_800_000,
  rss_news:            900_000,
  taapi:               120_000,
  DEFAULT:              60_000,
};

export function ttlFor(key) {
  return TTLS[key] ?? TTLS.DEFAULT;
}

// ─── Memory layer ──────────────────────────────────────
function memGet(key) {
  const e = mem.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) { mem.delete(key); return null; }
  return e.data;
}

function memSet(key, data, ttl) {
  mem.set(key, { data, ts: Date.now(), ttl });
}

// ─── Supabase layer ────────────────────────────────────
async function sbGet(key) {
  try {
    const { supabase } = await import('../supabase.js');
    const { data } = await supabase
      .from('global_market_cache')
      .select('data, updated_at')
      .eq('id', `ingest_${key}`)
      .single();
    if (!data?.data) return null;
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > ttlFor(key) * 3) return null;  // reject very stale remote data
    return data.data;
  } catch { return null; }
}

async function sbSet(key, data) {
  try {
    const { supabase } = await import('../supabase.js');
    await supabase.from('global_market_cache').upsert({
      id: `ingest_${key}`,
      data,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[cache] Supabase write failed for ${key}:`, e.message);
  }
}

// ─── Public API ────────────────────────────────────────

/** Read from cache (memory first, then Supabase). */
export async function cacheGet(key) {
  const m = memGet(key);
  if (m !== null) return m;
  const r = await sbGet(key);
  if (r !== null) memSet(key, r, ttlFor(key));
  return r;
}

/** Write to both cache layers. */
export async function cacheSet(key, data, ttlOverride) {
  memSet(key, data, ttlOverride ?? ttlFor(key));
  // Supabase write is fire-and-forget to avoid blocking the caller.
  sbSet(key, data).catch(() => {});
}

/**
 * Fetch-through cache: return cached data if fresh, otherwise call fetchFn
 * and cache the result. Returns null if both cache and fetch fail.
 */
export async function cachedFetch(key, fetchFn, ttlOverride) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  try {
    const fresh = await fetchFn();
    if (fresh != null) await cacheSet(key, fresh, ttlOverride);
    return fresh ?? null;
  } catch (e) {
    console.warn(`[cache] Fetch failed for ${key}:`, e.message);
    return null;
  }
}

/** Evict a single key from memory (Supabase entry remains until overwritten). */
export function cacheEvict(key) { mem.delete(key); }

/** Evict all memory entries. */
export function cacheClear() { mem.clear(); }
