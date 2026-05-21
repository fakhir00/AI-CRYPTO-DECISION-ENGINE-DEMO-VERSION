import ccxt from 'ccxt';

const EXCHANGE_OPTIONS = {
  enableRateLimit: true,
  timeout: 15000,
  options: {
    defaultType: 'spot'
  }
};

function normalizeSymbol(symbol = 'BTC/USDT') {
  const raw = String(symbol || 'BTC/USDT').toUpperCase().replace('-', '/');
  if (raw.includes('/')) return raw;
  return raw.endsWith('USDT') ? `${raw.replace(/USDT$/, '')}/USDT` : `${raw}/USDT`;
}

export function createCcxtExchange(exchangeId = 'binance', options = {}) {
  const id = String(exchangeId || 'binance').toLowerCase();
  const Exchange = ccxt[id];
  if (!Exchange) throw new Error(`Unsupported CCXT exchange: ${exchangeId}`);
  return new Exchange({
    ...EXCHANGE_OPTIONS,
    ...options,
    options: {
      ...EXCHANGE_OPTIONS.options,
      ...(options.options || {})
    }
  });
}

export async function fetchCcxtCandles({
  exchangeId = 'binance',
  symbol = 'BTC/USDT',
  timeframe = '15m',
  limit = 200,
  since = undefined,
  exchangeOptions = {}
} = {}) {
  const exchange = createCcxtExchange(exchangeId, exchangeOptions);
  const market = normalizeSymbol(symbol);
  if (exchange.loadMarkets) await exchange.loadMarkets();
  const rows = await exchange.fetchOHLCV(market, timeframe, since, limit);
  return rows.map(row => ({
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]) || 0
  })).filter(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite));
}

export async function fetchMultiTimeframeCandles({
  exchangeId = 'binance',
  symbol = 'BTC/USDT',
  timeframes = ['15m', '1h'],
  limit = 200
} = {}) {
  const out = {};
  for (const timeframe of timeframes) {
    out[timeframe] = await fetchCcxtCandles({ exchangeId, symbol, timeframe, limit });
  }
  return out;
}
