// ═══════════════════════════════════════════════════════
// TAAPI.io — Technical Analysis Indicators
// ═══════════════════════════════════════════════════════
import { KEYS, fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://api.taapi.io';

async function fetchIndicator(symbol, indicator, interval = '15m', params = {}) {
  if (!KEYS.taapi) return null;
  const qs = new URLSearchParams({
    secret: KEYS.taapi,
    exchange: 'binance',
    symbol: `${symbol.toUpperCase()}/USDT`,
    interval,
    ...params,
  });
  return fetchJson(`${BASE}/${indicator}?${qs}`);
}

export async function fetchTechnicals(symbol = 'BTC', interval = '15m') {
  const [rsi, macd, bbands, stoch, ema50, ema200] = await Promise.allSettled([
    fetchIndicator(symbol, 'rsi', interval),
    fetchIndicator(symbol, 'macd', interval),
    fetchIndicator(symbol, 'bbands', interval),
    fetchIndicator(symbol, 'stoch', interval),
    fetchIndicator(symbol, 'ema', interval, { period: 50 }),
    fetchIndicator(symbol, 'ema', interval, { period: 200 }),
  ]);

  const points = [];
  const v = (r) => r.status === 'fulfilled' ? r.value : null;

  if (v(rsi)?.value != null)
    points.push(createDataPoint('taapi', symbol, 'rsi_14', v(rsi).value));

  if (v(macd))
    points.push(createDataPoint('taapi', symbol, 'macd', {
      macd:      v(macd).valueMACD,
      signal:    v(macd).valueMACDSignal,
      histogram: v(macd).valueMACDHist,
    }));

  if (v(bbands))
    points.push(createDataPoint('taapi', symbol, 'bbands', {
      upper:  v(bbands).valueUpperBand,
      middle: v(bbands).valueMiddleBand,
      lower:  v(bbands).valueLowerBand,
    }));

  if (v(stoch))
    points.push(createDataPoint('taapi', symbol, 'stochastic', {
      k: v(stoch).valueK,
      d: v(stoch).valueD,
    }));

  if (v(ema50)?.value != null)
    points.push(createDataPoint('taapi', symbol, 'ema_50', v(ema50).value));

  if (v(ema200)?.value != null)
    points.push(createDataPoint('taapi', symbol, 'ema_200', v(ema200).value));

  return points;
}

/** Fetch technicals for multiple symbols in parallel. */
export async function fetchTechnicalsBatch(symbols = ['BTC', 'ETH', 'SOL'], interval = '15m') {
  const results = await Promise.allSettled(symbols.map(s => fetchTechnicals(s, interval)));
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
