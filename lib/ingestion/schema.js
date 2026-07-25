// ═══════════════════════════════════════════════════════
// Ingestion Layer — Normalized Data Schema
// ═══════════════════════════════════════════════════════
// Every source adapter returns arrays of DataPoints.
// The scoring engine consumes DataPoints by (symbol, metric).

/**
 * @typedef {Object} DataPoint
 * @property {string}  source    - Origin adapter: 'binance', 'coingecko', etc.
 * @property {string}  symbol    - Uppercase ticker: 'BTC', 'ETH', or '*' for global.
 * @property {string}  metric    - What this measures: 'price', 'rsi_14', 'funding_rate'.
 * @property {*}       value     - The payload (number, string, or nested object).
 * @property {number}  timestamp - Unix milliseconds when the value was captured.
 */

export function createDataPoint(source, symbol, metric, value) {
  return {
    source: String(source),
    symbol: String(symbol || '*').toUpperCase(),
    metric: String(metric),
    value,
    timestamp: Date.now(),
  };
}

/** Create many DataPoints from one source in one call. */
export function createBatch(source, items) {
  return items.map(({ symbol, metric, value }) =>
    createDataPoint(source, symbol, metric, value)
  );
}

/**
 * Index an array of DataPoints into a lookup map.
 * Key format: `${symbol}::${metric}` → latest DataPoint.
 */
export function indexBySymbolMetric(points = []) {
  const map = new Map();
  for (const p of points) {
    const key = `${p.symbol}::${p.metric}`;
    const existing = map.get(key);
    if (!existing || p.timestamp > existing.timestamp) {
      map.set(key, p);
    }
  }
  return map;
}

/** Look up a single value from an indexed map. */
export function lookup(index, symbol, metric) {
  return index.get(`${String(symbol).toUpperCase()}::${metric}`)?.value ?? null;
}
