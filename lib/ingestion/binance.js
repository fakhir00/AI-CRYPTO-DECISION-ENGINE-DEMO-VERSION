// ═══════════════════════════════════════════════════════
// Binance Spot + Futures — Public endpoints (no API key)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint, createBatch } from './schema.js';

const SPOT  = 'https://api.binance.com/api/v3';
const SPOT_MIRRORS = [
  'https://api1.binance.com/api/v3',
  'https://api2.binance.com/api/v3',
  'https://api3.binance.com/api/v3',
  'https://data-api.binance.vision/api/v3',
];
const FAPI  = 'https://fapi.binance.com/fapi/v1';

async function spotFetch(path) {
  let data = await fetchJson(`${SPOT}${path}`);
  if (data !== null) return data;
  for (const mirror of SPOT_MIRRORS) {
    data = await fetchJson(`${mirror}${path}`);
    if (data !== null) return data;
  }
  return null;
}

// ─── 24h Tickers ────────────────────────────────────────
export async function fetchTickers() {
  const raw = await spotFetch('/ticker/24hr');
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(t => t.symbol.endsWith('USDT'))
    .flatMap(t => {
      const sym = t.symbol.replace('USDT', '');
      return [
        createDataPoint('binance', sym, 'price',      parseFloat(t.lastPrice)),
        createDataPoint('binance', sym, 'change_24h',  parseFloat(t.priceChangePercent)),
        createDataPoint('binance', sym, 'volume_24h',  parseFloat(t.quoteVolume)),
        createDataPoint('binance', sym, 'high_24h',    parseFloat(t.highPrice)),
        createDataPoint('binance', sym, 'low_24h',     parseFloat(t.lowPrice)),
        createDataPoint('binance', sym, 'trades_24h',  parseInt(t.count, 10)),
      ];
    });
}

// ─── Klines (OHLCV candles) ─────────────────────────────
export async function fetchKlines(symbol, interval = '15m', limit = 200) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const raw = await spotFetch(`/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
  if (!Array.isArray(raw)) return [];
  const candles = raw.map(k => ({
    openTime: k[0],
    open:     parseFloat(k[1]),
    high:     parseFloat(k[2]),
    low:      parseFloat(k[3]),
    close:    parseFloat(k[4]),
    volume:   parseFloat(k[5]),
    closeTime: k[6],
    quoteVol: parseFloat(k[7]),
    trades:   k[8],
  }));
  return [createDataPoint('binance', symbol, `klines_${interval}`, candles)];
}

// ─── Funding Rates (Futures) ────────────────────────────
export async function fetchFundingRates() {
  const raw = await fetchJson(`${FAPI}/premiumIndex`);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(r => r.symbol.endsWith('USDT'))
    .map(r => createDataPoint('binance', r.symbol.replace('USDT', ''), 'funding_rate', {
      rate:        parseFloat(r.lastFundingRate),
      markPrice:   parseFloat(r.markPrice),
      indexPrice:  parseFloat(r.indexPrice),
      nextFunding: r.nextFundingTime,
    }));
}

// ─── Open Interest (Futures, per-symbol) ────────────────
export async function fetchOpenInterest(symbol = 'BTC') {
  const pair = `${symbol.toUpperCase()}USDT`;
  const raw = await fetchJson(`${FAPI}/openInterest?symbol=${pair}`);
  if (!raw) return [];
  return [createDataPoint('binance', symbol, 'open_interest', {
    oi:     parseFloat(raw.openInterest),
    symbol: raw.symbol,
    time:   raw.time,
  })];
}

// ─── Batch OI for multiple symbols ──────────────────────
export async function fetchOpenInterestBatch(symbols = ['BTC', 'ETH', 'SOL']) {
  const results = await Promise.allSettled(symbols.map(s => fetchOpenInterest(s)));
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}

// ─── Order Book Depth ───────────────────────────────────
export async function fetchDepth(symbol = 'BTC', limit = 20) {
  const pair = `${symbol.toUpperCase()}USDT`;
  const raw = await spotFetch(`/depth?symbol=${pair}&limit=${limit}`);
  if (!raw) return [];
  const sumBids = raw.bids.reduce((s, [, q]) => s + parseFloat(q), 0);
  const sumAsks = raw.asks.reduce((s, [, q]) => s + parseFloat(q), 0);
  return [createDataPoint('binance', symbol, 'order_book', {
    bidTotal: sumBids,
    askTotal: sumAsks,
    ratio:    sumAsks > 0 ? sumBids / sumAsks : 0,
    depth:    limit,
    bids:     raw.bids.slice(0, 5).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
    asks:     raw.asks.slice(0, 5).map(([p, q]) => ({ price: parseFloat(p), qty: parseFloat(q) })),
  })];
}
