// ═══════════════════════════════════════════════════════════════
// NEXUS Server-Side Market Data — Single Source of Truth
// ═══════════════════════════════════════════════════════════════
// Fetches Binance market universe + deterministic SCALP/DAY signal snapshots.
// Cached for 60s so every client sees the same scan window.

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds (scan cadence)

const BINANCE_TOP_N = 50;
const MIN_QUOTE_VOLUME_USD = 20_000_000;
const MAX_ABS_CHANGE_PCT = 20;
const MAX_INTRADAY_RANGE_PCT = 24;
const KLINE_LIMIT = 80;
const FETCH_TIMEOUT_MS = 6000;
const KLINE_CONCURRENCY = 12;

const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
  'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
  'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
]);

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function avg(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function pctPrice(price, pct) {
  return price * (1 + (pct / 100));
}

function isStablecoinLike(symbol = '', name = '', price = null) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return false;
  if (STABLECOINS.has(sym)) return true;
  if (/^(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)\d*$/i.test(sym)) return true;

  const nm = String(name || '').toUpperCase();
  const p = Number(price);
  if (Number.isFinite(p) && p > 0.85 && p < 1.15 && /(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)/.test(sym)) {
    return true;
  }
  if (
    nm
    && /\b(STABLE|USD|DOLLAR|EURO|EUR|GBP|YEN|PEGGED)\b/.test(nm)
    && Number.isFinite(p)
    && p > 0.85
    && p < 1.15
  ) {
    return true;
  }

  return false;
}

function isUnpredictableOrSham(ticker = {}) {
  const base = String(ticker.base || '').toUpperCase();
  if (!base) return true;
  if (/^(1000|1000000)/.test(base)) return true;
  if (/(UP|DOWN|BULL|BEAR)$/.test(base)) return true;

  const quoteVolume = Number(ticker.quoteVolume) || 0;
  const absChange = Math.abs(Number(ticker.changePct) || 0);
  const openPrice = Number(ticker.openPrice) || 0;
  const highPrice = Number(ticker.highPrice) || 0;
  const lowPrice = Number(ticker.lowPrice) || 0;
  const rangePct = openPrice > 0 ? ((highPrice - lowPrice) / openPrice) * 100 : absChange;

  if (quoteVolume < MIN_QUOTE_VOLUME_USD) return true;
  if (absChange > MAX_ABS_CHANGE_PCT) return true;
  if (rangePct > MAX_INTRADAY_RANGE_PCT) return true;
  return false;
}

function computeEMASeries(values = [], period = 9) {
  const arr = values.map(Number).filter(Number.isFinite);
  if (arr.length < period) return [];

  const k = 2 / (period + 1);
  const out = new Array(arr.length).fill(null);
  let ema = avg(arr.slice(0, period));
  out[period - 1] = ema;

  for (let i = period; i < arr.length; i++) {
    ema = (arr[i] * k) + (ema * (1 - k));
    out[i] = ema;
  }

  return out;
}

function computeRSI(closes = [], period = 14) {
  const arr = closes.map(Number).filter(Number.isFinite);
  if (arr.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = arr[i] - arr[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < arr.length; i++) {
    const delta = arr[i] - arr[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeMacdStats(closes = []) {
  const arr = closes.map(Number).filter(Number.isFinite);
  if (arr.length < 35) {
    return {
      histCurrent: null,
      histPrevious: null,
      minHist20: null,
      maxHist20: null,
      candlesSinceCross: 10,
      histSeries: []
    };
  }

  const ema12 = computeEMASeries(arr, 12);
  const ema26 = computeEMASeries(arr, 26);
  const macdSeries = arr.map((_, idx) => {
    const a = ema12[idx];
    const b = ema26[idx];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return a - b;
  });

  const compactMacd = macdSeries.filter(Number.isFinite);
  const compactSignal = computeEMASeries(compactMacd, 9);

  const signalSeries = new Array(macdSeries.length).fill(null);
  let p = 0;
  for (let i = 0; i < macdSeries.length; i++) {
    if (Number.isFinite(macdSeries[i])) {
      signalSeries[i] = compactSignal[p] ?? null;
      p += 1;
    }
  }

  const histSeries = macdSeries.map((m, i) => {
    const s = signalSeries[i];
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m - s;
  });

  const validHist = histSeries.filter(Number.isFinite);
  const histCurrent = validHist.length ? validHist[validHist.length - 1] : null;
  const histPrevious = validHist.length > 1 ? validHist[validHist.length - 2] : null;
  const last20 = validHist.slice(-20);

  const minHist20 = last20.length ? Math.min(...last20) : null;
  const maxHist20 = last20.length ? Math.max(...last20) : null;

  let candlesSinceCross = 10;
  for (let i = histSeries.length - 1; i > 0; i--) {
    const cur = histSeries[i];
    const prev = histSeries[i - 1];
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) continue;
    const nowSign = cur >= 0 ? 1 : -1;
    const prevSign = prev >= 0 ? 1 : -1;
    if (nowSign !== prevSign) {
      candlesSinceCross = Math.max(0, histSeries.length - 1 - i);
      break;
    }
  }

  return {
    histCurrent,
    histPrevious,
    minHist20,
    maxHist20,
    candlesSinceCross,
    histSeries
  };
}

function detectMacdDivergence(candles = [], histSeries = []) {
  if (!candles.length || !histSeries.length) return { bullish: false, bearish: false };

  const n = Math.min(candles.length, histSeries.length);
  if (n < 30) return { bullish: false, bearish: false };

  const offset = n - 30;
  const priceWindow = candles.slice(-30);
  const histWindow = histSeries.slice(offset);

  const firstHalf = priceWindow.slice(0, 15);
  const secondHalf = priceWindow.slice(15);
  const firstHist = histWindow.slice(0, 15);
  const secondHist = histWindow.slice(15);

  let firstLow = Infinity;
  let firstLowIdx = -1;
  firstHalf.forEach((c, i) => {
    if (c.low < firstLow) {
      firstLow = c.low;
      firstLowIdx = i;
    }
  });

  let secondLow = Infinity;
  let secondLowIdx = -1;
  secondHalf.forEach((c, i) => {
    if (c.low < secondLow) {
      secondLow = c.low;
      secondLowIdx = i;
    }
  });

  let firstHigh = -Infinity;
  let firstHighIdx = -1;
  firstHalf.forEach((c, i) => {
    if (c.high > firstHigh) {
      firstHigh = c.high;
      firstHighIdx = i;
    }
  });

  let secondHigh = -Infinity;
  let secondHighIdx = -1;
  secondHalf.forEach((c, i) => {
    if (c.high > secondHigh) {
      secondHigh = c.high;
      secondHighIdx = i;
    }
  });

  const firstLowHist = firstLowIdx >= 0 ? firstHist[firstLowIdx] : null;
  const secondLowHist = secondLowIdx >= 0 ? secondHist[secondLowIdx] : null;

  const firstHighHist = firstHighIdx >= 0 ? firstHist[firstHighIdx] : null;
  const secondHighHist = secondHighIdx >= 0 ? secondHist[secondHighIdx] : null;

  const bullish = (
    Number.isFinite(firstLow)
    && Number.isFinite(secondLow)
    && Number.isFinite(firstLowHist)
    && Number.isFinite(secondLowHist)
    && secondLow < firstLow
    && secondLowHist > firstLowHist
  );

  const bearish = (
    Number.isFinite(firstHigh)
    && Number.isFinite(secondHigh)
    && Number.isFinite(firstHighHist)
    && Number.isFinite(secondHighHist)
    && secondHigh > firstHigh
    && secondHighHist < firstHighHist
  );

  return { bullish, bearish };
}

function detectPattern(candles = [], timeframe = 'SCALP') {
  if (!Array.isArray(candles) || candles.length < 3) return { name: 'NONE', hasPattern: false, highReliability: false };

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const closes = candles.map(c => c.close);

  const lastBull = last.close > last.open;
  const lastBear = last.close < last.open;
  const prevBull = prev.close > prev.open;
  const prevBear = prev.close < prev.open;

  const bullishEngulfing = prevBear && lastBull && last.open < prev.close && last.close > prev.open;
  const bearishEngulfing = prevBull && lastBear && last.open > prev.close && last.close < prev.open;

  const recent = closes.slice(-12);
  const movePct = recent.length >= 12 ? ((recent[8] - recent[0]) / recent[0]) * 100 : 0;
  const pullbackPct = recent.length >= 12 ? ((recent[11] - recent[8]) / recent[8]) * 100 : 0;
  const bullFlag = movePct > 1.2 && pullbackPct < 0 && pullbackPct > -0.9;
  const bearFlag = movePct < -1.2 && pullbackPct > 0 && pullbackPct < 0.9;

  if (bullishEngulfing) {
    return {
      name: 'BULL_ENGULF',
      hasPattern: true,
      highReliability: timeframe === 'SCALP'
    };
  }

  if (bearishEngulfing) {
    return {
      name: 'BEAR_ENGULF',
      hasPattern: true,
      highReliability: timeframe === 'SCALP'
    };
  }

  if (bullFlag) {
    return {
      name: 'BULL_FLAG',
      hasPattern: true,
      highReliability: timeframe === 'SCALP'
    };
  }

  if (bearFlag) {
    return {
      name: 'BEAR_FLAG',
      hasPattern: true,
      highReliability: timeframe === 'SCALP'
    };
  }

  return { name: 'NONE', hasPattern: false, highReliability: false };
}

function computeTechnicalScore(snapshot = {}, direction = 'BUY', timeframe = 'SCALP') {
  const rsi = Number.isFinite(snapshot.rsi) ? snapshot.rsi : 50;
  const rsiScore = clamp(100 - (Math.abs(rsi - 50) * 2), 0, 100);

  const histCurrent = snapshot.macd?.histCurrent;
  const histPrevious = snapshot.macd?.histPrevious;
  const minHist20 = snapshot.macd?.minHist20;
  const maxHist20 = snapshot.macd?.maxHist20;
  const candlesSinceCross = Number.isFinite(snapshot.macd?.candlesSinceCross) ? snapshot.macd.candlesSinceCross : 10;

  let strength = 50;
  if (Number.isFinite(histCurrent) && Number.isFinite(minHist20) && Number.isFinite(maxHist20)) {
    const range = maxHist20 - minHist20;
    if (range > 0) {
      strength = ((histCurrent - minHist20) / range) * 100;
    }
  }

  let directionScore = 50;
  if (Number.isFinite(histCurrent) && Number.isFinite(histPrevious)) {
    if (histCurrent > histPrevious) directionScore = 100;
    else if (histCurrent < histPrevious) directionScore = 0;
  }

  const recency = clamp(100 - (candlesSinceCross * 10), 0, 100);
  const rawMacd = (strength * 0.4) + (directionScore * 0.3) + (recency * 0.3);

  const divergence = snapshot.divergence || { bullish: false, bearish: false };
  const divergenceBonus = direction === 'BUY'
    ? (divergence.bullish ? 10 : 0)
    : (divergence.bearish ? 10 : 0);

  const macdScore = clamp(rawMacd + divergenceBonus, 0, 100);

  const pattern = snapshot.pattern || { hasPattern: false, highReliability: false };
  let patternScore = pattern.hasPattern ? 100 : 50;
  if (pattern.highReliability) {
    const isAllowedHighReliability = timeframe === 'SCALP';
    patternScore = isAllowedHighReliability ? 120 : 100;
  }
  patternScore = clamp(patternScore, 0, 100);

  const technical = (rsiScore * 0.3) + (macdScore * 0.4) + (patternScore * 0.3);
  return {
    score: clamp(technical, 0, 100),
    rsiScore,
    macdScore,
    patternScore
  };
}

function computeEmaConfluenceScore(direction = 'BUY', snapshot = {}) {
  const price = Number(snapshot.price);
  const ema9 = Number(snapshot.ema9);
  const ema21 = Number(snapshot.ema21);
  const ema9Prev = Number(snapshot.ema9Prev);
  const ema21Prev = Number(snapshot.ema21Prev);

  if (![price, ema9, ema21].every(Number.isFinite)) return 50;

  const ema9Expanding = Number.isFinite(ema9Prev) ? ema9 > ema9Prev : false;
  const ema21Expanding = Number.isFinite(ema21Prev) ? ema21 > ema21Prev : false;

  if (direction === 'BUY') {
    if (price > ema9 && price > ema21 && ema9Expanding && ema21Expanding) return 100;
    if (price < ema9 && price < ema21) return 0;
    return 50;
  }

  const ema9Contracting = Number.isFinite(ema9Prev) ? ema9 < ema9Prev : false;
  const ema21Contracting = Number.isFinite(ema21Prev) ? ema21 < ema21Prev : false;

  if (price < ema9 && price < ema21 && ema9Contracting && ema21Contracting) return 100;
  if (price > ema9 && price > ema21) return 0;
  return 50;
}

function computeVolumeScore(volumeRatio = 0) {
  if (volumeRatio > 2.0) return 100;
  if (volumeRatio > 1.5) return 70;
  if (volumeRatio > 1.2) return 50;
  return 20;
}

function computeAlphaFromPillars(pillars = {}) {
  const sentiment = Number.isFinite(pillars.sentiment) ? pillars.sentiment : 50;
  const isTrending = sentiment > 65 || sentiment < 35;

  const weights = isTrending
    ? { technical: 0.22, whale: 0.20, ema: 0.15, volume: 0.08, sentiment: 0.15, news: 0.12, alphaSources: 0.10 }
    : { technical: 0.15, whale: 0.15, ema: 0.08, volume: 0.15, sentiment: 0.25, news: 0.15, alphaSources: 0.12 };

  const raw =
    (pillars.technical * weights.technical)
    + (pillars.whale * weights.whale)
    + (pillars.ema * weights.ema)
    + (pillars.volume * weights.volume)
    + (pillars.sentiment * weights.sentiment)
    + (pillars.news * weights.news)
    + (pillars.alphaSources * weights.alphaSources);

  return {
    regime: isTrending ? 'TRENDING' : 'RANGING',
    alpha: clamp(raw, 0, 100)
  };
}

function computeTpSl(timeframe = 'SCALP', symbol = 'BTC', direction = 'BUY', entry = 0) {
  const isMajors = symbol === 'BTC' || symbol === 'ETH';

  let tp1Pct;
  let tp2Pct;
  let slPct;

  if (timeframe === 'SCALP') {
    if (isMajors) {
      tp1Pct = 0.25;
      tp2Pct = 0.40;
      slPct = 0.15;
    } else {
      tp1Pct = 0.35;
      tp2Pct = 0.50;
      slPct = 0.20;
    }
  } else if (isMajors) {
    tp1Pct = 1.0;
    tp2Pct = 1.8;
    slPct = 0.6;
  } else {
    tp1Pct = 1.5;
    tp2Pct = 2.5;
    slPct = 0.8;
  }

  if (direction === 'BUY') {
    return {
      tp1: pctPrice(entry, tp1Pct),
      tp2: pctPrice(entry, tp2Pct),
      sl: pctPrice(entry, -slPct)
    };
  }

  return {
    tp1: pctPrice(entry, -tp1Pct),
    tp2: pctPrice(entry, -tp2Pct),
    sl: pctPrice(entry, slPct)
  };
}

function formatLineNumber(v) {
  if (!Number.isFinite(v)) return '0';
  return v >= 1000 ? v.toFixed(2) : v.toFixed(4);
}

function buildNoSignalLine(timeframe, symbol, timestamp, reason) {
  return `NO_SIGNAL|${timeframe}|${symbol}/USDT|${timestamp}|${reason}`;
}

function buildSignalLine(timeframe, symbol, direction, entry, tp1, tp2, sl, patternName, timestamp, alpha) {
  return `SIGNAL|${timeframe}|${symbol}/USDT|${direction}|${formatLineNumber(entry)}|${formatLineNumber(tp1)}|${formatLineNumber(tp2)}|${formatLineNumber(sl)}|${patternName || 'NONE'}|${timestamp}|${Math.round(alpha)}`;
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKlines(symbol, interval, limit = KLINE_LIMIT) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}USDT&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const raw = await fetchJsonWithTimeout(url);
  if (!Array.isArray(raw) || raw.length === 0) return null;

  return raw.map(k => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  })).filter(c => Number.isFinite(c.close) && Number.isFinite(c.volume));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= items.length) break;
      try {
        out[current] = await mapper(items[current], current);
      } catch {
        out[current] = null;
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

function buildTimeframeSnapshot(candles = [], timeframe = 'SCALP') {
  if (!Array.isArray(candles) || candles.length < 30) return null;

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const ema9Series = computeEMASeries(closes, 9);
  const ema21Series = computeEMASeries(closes, 21);

  if (!ema9Series.length || !ema21Series.length) return null;

  const ema9 = ema9Series[ema9Series.length - 1];
  const ema21 = ema21Series[ema21Series.length - 1];
  const ema9Prev = ema9Series[ema9Series.length - 2];
  const ema21Prev = ema21Series[ema21Series.length - 2];

  const currentVolume = volumes[volumes.length - 1];
  const avgVol3 = avg(volumes.slice(-4, -1));
  const avgVol5 = avg(volumes.slice(-6, -1));
  const volumeRatio3 = avgVol3 > 0 ? (currentVolume / avgVol3) : 0;
  const volumeRatio5 = avgVol5 > 0 ? (currentVolume / avgVol5) : 0;

  const macd = computeMacdStats(closes);
  const divergence = detectMacdDivergence(candles, macd.histSeries || []);
  const pattern = detectPattern(candles, timeframe);

  return {
    price: closes[closes.length - 1],
    ema9,
    ema21,
    ema9Prev,
    ema21Prev,
    rsi: computeRSI(closes, 14),
    macd,
    divergence,
    pattern,
    volumeRatio3,
    volumeRatio5,
    currentVolume,
    avgVol3,
    avgVol5
  };
}

function evaluateSignal(symbol, timeframe, snapshot, timestampIso) {
  if (!snapshot) {
    return {
      status: 'NO_SIGNAL',
      reason: 'DATA_UNAVAILABLE',
      alpha: 50,
      line: buildNoSignalLine(timeframe, symbol, timestampIso, 'DATA_UNAVAILABLE')
    };
  }

  let direction = null;
  if (snapshot.ema9 > snapshot.ema21) direction = 'BUY';
  else if (snapshot.ema9 < snapshot.ema21) direction = 'SELL';

  if (!direction) {
    return {
      status: 'NO_SIGNAL',
      reason: 'EMA_CROSS_FAIL',
      alpha: 50,
      line: buildNoSignalLine(timeframe, symbol, timestampIso, 'EMA_CROSS_FAIL')
    };
  }

  const volumeRatio = timeframe === 'SCALP' ? snapshot.volumeRatio3 : snapshot.volumeRatio5;
  if (!(Number.isFinite(volumeRatio) && volumeRatio > 0.5)) {
    return {
      status: 'NO_SIGNAL',
      reason: 'VOLUME_FAIL',
      alpha: 50,
      direction,
      line: buildNoSignalLine(timeframe, symbol, timestampIso, 'VOLUME_FAIL')
    };
  }

  const technicalMeta = computeTechnicalScore(snapshot, direction, timeframe);
  const technicalScore = technicalMeta.score;

  // If unavailable from external feeds in this endpoint, keep strict neutral defaults per spec.
  const whaleScore = 50;
  const sentimentScore = 50;
  const newsScore = 50;
  const alphaSourcesScore = 50;

  const emaConfluenceScore = computeEmaConfluenceScore(direction, snapshot);
  const volumeScore = computeVolumeScore(volumeRatio);

  const pillars = {
    technical: technicalScore,
    whale: whaleScore,
    ema: emaConfluenceScore,
    volume: volumeScore,
    sentiment: sentimentScore,
    news: newsScore,
    alphaSources: alphaSourcesScore
  };

  const alphaMeta = computeAlphaFromPillars(pillars);
  const alpha = alphaMeta.alpha;

  const levels = computeTpSl(timeframe, symbol, direction, snapshot.price);
  const patternName = snapshot.pattern?.name || 'NONE';

  return {
    status: 'SIGNAL',
    direction,
    reason: null,
    entry: snapshot.price,
    tp1: levels.tp1,
    tp2: levels.tp2,
    sl: levels.sl,
    pattern: patternName,
    alpha: Math.round(alpha),
    regime: alphaMeta.regime,
    pillars: {
      technical: Math.round(technicalScore),
      whale: Math.round(whaleScore),
      emaConfluence: Math.round(emaConfluenceScore),
      volume: Math.round(volumeScore),
      sentiment: Math.round(sentimentScore),
      news: Math.round(newsScore),
      alphaSources: Math.round(alphaSourcesScore)
    },
    components: {
      rsi: Math.round(technicalMeta.rsiScore),
      macd: Math.round(technicalMeta.macdScore),
      pattern: Math.round(technicalMeta.patternScore)
    },
    line: buildSignalLine(
      timeframe,
      symbol,
      direction,
      snapshot.price,
      levels.tp1,
      levels.tp2,
      levels.sl,
      patternName,
      timestampIso,
      alpha
    )
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (cachedData && (Date.now() - cacheTimestamp < CACHE_TTL)) {
    return res.status(200).json({
      source: 'cache',
      age: Math.round((Date.now() - cacheTimestamp) / 1000),
      data: cachedData
    });
  }

  try {
    const binance24h = await fetchJsonWithTimeout('https://api.binance.com/api/v3/ticker/24hr');

    const topBinance = Array.isArray(binance24h)
      ? binance24h
          .filter(t => typeof t?.symbol === 'string' && t.symbol.endsWith('USDT'))
          .map(t => {
            const base = t.symbol.replace('USDT', '').toUpperCase();
            return {
              base,
              lastPrice: Number(t.lastPrice) || 0,
              changePct: Number(t.priceChangePercent) || 0,
              quoteVolume: Number(t.quoteVolume) || 0,
              openPrice: Number(t.openPrice) || 0,
              highPrice: Number(t.highPrice) || 0,
              lowPrice: Number(t.lowPrice) || 0
            };
          })
          .filter(t => t.base && !isStablecoinLike(t.base, t.base, t.lastPrice))
          .filter(t => !isUnpredictableOrSham(t))
          .sort((a, b) => b.quoteVolume - a.quoteVolume)
          .slice(0, BINANCE_TOP_N)
      : [];

    const timestampIso = new Date().toISOString();

    const klinePairs = [];
    topBinance.forEach((t) => {
      klinePairs.push({ symbol: t.base, timeframe: 'SCALP', interval: '1m' });
      klinePairs.push({ symbol: t.base, timeframe: 'DAY', interval: '15m' });
    });

    const klineResults = await mapWithConcurrency(klinePairs, KLINE_CONCURRENCY, async (task) => {
      const candles = await fetchKlines(task.symbol, task.interval, KLINE_LIMIT);
      return {
        ...task,
        candles
      };
    });

    const snapshotMap = new Map();
    klineResults.forEach((row) => {
      if (!row || !row.symbol || !row.timeframe) return;
      const key = `${row.symbol}_${row.timeframe}`;
      snapshotMap.set(key, buildTimeframeSnapshot(row.candles || [], row.timeframe));
    });

    const assets = topBinance.map((t, idx) => {
      const scalpSnapshot = snapshotMap.get(`${t.base}_SCALP`) || null;
      const daySnapshot = snapshotMap.get(`${t.base}_DAY`) || null;

      const scalpSignal = evaluateSignal(t.base, 'SCALP', scalpSnapshot, timestampIso);
      const daySignal = evaluateSignal(t.base, 'DAY', daySnapshot, timestampIso);

      const combinedAlpha = Math.round(((Number(scalpSignal.alpha) || 50) + (Number(daySignal.alpha) || 50)) / 2);
      const preferred = daySignal.status === 'SIGNAL'
        ? daySignal
        : (scalpSignal.status === 'SIGNAL' ? scalpSignal : daySignal);

      const bias = preferred.direction === 'BUY'
        ? 'bullish'
        : preferred.direction === 'SELL'
          ? 'bearish'
          : (t.changePct >= 0 ? 'bullish' : 'bearish');

      return {
        symbol: t.base,
        name: t.base,
        price: t.lastPrice,
        change: t.changePct,
        score: combinedAlpha,
        opportunityScore: combinedAlpha,
        confidence: Math.min(99, combinedAlpha),
        bias,
        reason: preferred.pattern && preferred.pattern !== 'NONE' ? preferred.pattern : 'NONE',
        vol: '$' + (t.quoteVolume / 1e9).toFixed(1) + 'B',
        market_cap_rank: idx + 1,
        market_cap: 0,
        total_volume: t.quoteVolume,
        scanTimestamp: timestampIso,
        signals: {
          scalp: scalpSignal,
          day: daySignal
        }
      };
    });

    assets.sort((a, b) => (b.score - a.score) || a.symbol.localeCompare(b.symbol));

    cachedData = assets;
    cacheTimestamp = Date.now();

    return res.status(200).json({
      source: 'fresh',
      age: 0,
      data: assets,
      universe: {
        binanceTopIncluded: topBinance.length,
        scanCadenceSec: 60,
        qualityFilters: {
          minQuoteVolumeUsd: MIN_QUOTE_VOLUME_USD,
          maxAbsChangePct: MAX_ABS_CHANGE_PCT,
          maxIntradayRangePct: MAX_INTRADAY_RANGE_PCT
        },
        mandatoryChecks: {
          emaState: 'EMA9 above EMA21 = BUY, below = SELL',
          volumeRatioThreshold: 0.5,
          spreadCheck: 'disabled'
        }
      }
    });
  } catch (error) {
    console.error('Market API Error:', error.message);

    if (cachedData) {
      return res.status(200).json({
        source: 'stale-cache',
        age: Math.round((Date.now() - cacheTimestamp) / 1000),
        data: cachedData
      });
    }

    return res.status(500).json({ error: 'Failed to fetch market data' });
  }
}
