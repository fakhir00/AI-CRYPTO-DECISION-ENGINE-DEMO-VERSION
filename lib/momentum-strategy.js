import { createManagedSignal } from './signal-lifecycle.js';

const MIN_PRICE = 0.0000001;

export const DEFAULT_MOMENTUM_CONFIG = {
  primaryTimeframe: '15m',
  trendTimeframe: '1h',
  fetchLimit: 200,
  consolidationCandles: 5,
  consolidationMaxAtr: 1.2,
  confirmationCloses: 2,
  strongCandleAtr: 1.5,
  volumeMultiplier: 1.2,
  atrThreshold: 0.0015,
  spreadMaxPct: 0.05,
  rsiLongMax: 80,
  rsiShortMin: 20,
  swingLookback: 12,
  retestTolerancePct: 0.12,
  entryBufferLowPct: 0.05,
  entryBufferHighPct: 0.10,
  minTargetPct: 0.5,
  tp1Pct: 0.6,
  tp2Pct: 1.3,
  tp3Pct: 2.3,
  tp4Pct: 3.0,
  tp1ClosePct: 30,
  tp2ClosePct: 40,
  tp3ClosePct: 30,
  minStopPct: 0.35,
  maxStopPct: 1.5,
  riskPerTrade: 0.5,
  minRr: 1.5,
  expiryMinutes: 45,
  expiryCandles: 3,
  highImpactNewsBlackoutMinutes: 30,
  skipFirstMinutesAfterClose: 0,
  leverage: {
    low: 'Cross 4X-6X',
    medium: 'Cross 3X-5X',
    high: 'Cross 2X-3X'
  }
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function avg(values = []) {
  const clean = values.map(toNumber).filter(n => n !== null);
  if (!clean.length) return 0;
  return clean.reduce((sum, n) => sum + n, 0) / clean.length;
}

function timeframeToMinutes(timeframe = '15m') {
  const raw = String(timeframe || '15m').toLowerCase();
  const match = raw.match(/^(\d+)(m|h|d)$/);
  if (!match) return 15;
  const value = Number(match[1]);
  if (match[2] === 'h') return value * 60;
  if (match[2] === 'd') return value * 1440;
  return value;
}

export function normalizeMomentumConfig(config = {}) {
  const timeframes = config.timeframes || {};
  return {
    ...DEFAULT_MOMENTUM_CONFIG,
    ...config,
    primaryTimeframe: config.primaryTimeframe || timeframes.primary || DEFAULT_MOMENTUM_CONFIG.primaryTimeframe,
    trendTimeframe: config.trendTimeframe || timeframes.trend || DEFAULT_MOMENTUM_CONFIG.trendTimeframe,
    fetchLimit: Number(config.fetch_limit || config.fetchLimit || DEFAULT_MOMENTUM_CONFIG.fetchLimit),
    consolidationCandles: Number(config.consolidation_candles || config.consolidationCandles || DEFAULT_MOMENTUM_CONFIG.consolidationCandles),
    consolidationMaxAtr: Number(config.consolidation_max_atr || config.consolidationMaxAtr || DEFAULT_MOMENTUM_CONFIG.consolidationMaxAtr),
    confirmationCloses: Number(config.confirmation_closes || config.confirmationCloses || DEFAULT_MOMENTUM_CONFIG.confirmationCloses),
    strongCandleAtr: Number(config.strong_candle_atr || config.strongCandleAtr || DEFAULT_MOMENTUM_CONFIG.strongCandleAtr),
    volumeMultiplier: Number(config.volume_multiplier || config.volumeMultiplier || DEFAULT_MOMENTUM_CONFIG.volumeMultiplier),
    atrThreshold: Number(config.atr_threshold || config.atrThreshold || DEFAULT_MOMENTUM_CONFIG.atrThreshold),
    spreadMaxPct: Number(config.spread_max_pct || config.spreadMaxPct || DEFAULT_MOMENTUM_CONFIG.spreadMaxPct),
    rsiLongMax: Number(config.rsi_long_max || config.rsiLongMax || DEFAULT_MOMENTUM_CONFIG.rsiLongMax),
    rsiShortMin: Number(config.rsi_short_min || config.rsiShortMin || DEFAULT_MOMENTUM_CONFIG.rsiShortMin),
    swingLookback: Number(config.swing_lookback || config.swingLookback || DEFAULT_MOMENTUM_CONFIG.swingLookback),
    retestTolerancePct: Number(config.retest_tolerance_pct || config.retestTolerancePct || DEFAULT_MOMENTUM_CONFIG.retestTolerancePct),
    entryBufferLowPct: Number(config.entry_buffer_low_pct || config.entryBufferLowPct || DEFAULT_MOMENTUM_CONFIG.entryBufferLowPct),
    entryBufferHighPct: Number(config.entry_buffer_high_pct || config.entryBufferHighPct || DEFAULT_MOMENTUM_CONFIG.entryBufferHighPct),
    minTargetPct: Number(config.min_target_pct || config.minTargetPct || DEFAULT_MOMENTUM_CONFIG.minTargetPct),
    tp1Pct: Number(config.tp1_pct || config.tp1Pct || DEFAULT_MOMENTUM_CONFIG.tp1Pct),
    tp2Pct: Number(config.tp2_pct || config.tp2Pct || DEFAULT_MOMENTUM_CONFIG.tp2Pct),
    tp3Pct: Number(config.tp3_pct || config.tp3Pct || DEFAULT_MOMENTUM_CONFIG.tp3Pct),
    tp4Pct: Number(config.tp4_pct || config.tp4Pct || DEFAULT_MOMENTUM_CONFIG.tp4Pct),
    tp1ClosePct: Number(config.tp1_close_pct || config.tp1ClosePct || DEFAULT_MOMENTUM_CONFIG.tp1ClosePct),
    tp2ClosePct: Number(config.tp2_close_pct || config.tp2ClosePct || DEFAULT_MOMENTUM_CONFIG.tp2ClosePct),
    tp3ClosePct: Number(config.tp3_close_pct || config.tp3ClosePct || DEFAULT_MOMENTUM_CONFIG.tp3ClosePct),
    minStopPct: Number(config.min_stop_pct || config.minStopPct || DEFAULT_MOMENTUM_CONFIG.minStopPct),
    maxStopPct: Number(config.max_stop_pct || config.maxStopPct || DEFAULT_MOMENTUM_CONFIG.maxStopPct),
    riskPerTrade: Number(config.risk_per_trade || config.riskPerTrade || DEFAULT_MOMENTUM_CONFIG.riskPerTrade),
    minRr: Number(config.min_rr || config.minRr || DEFAULT_MOMENTUM_CONFIG.minRr),
    expiryMinutes: Number(config.expiry_minutes || config.expiryMinutes || DEFAULT_MOMENTUM_CONFIG.expiryMinutes),
    expiryCandles: Number(config.expiry_candles || config.expiryCandles || DEFAULT_MOMENTUM_CONFIG.expiryCandles),
    highImpactNewsBlackoutMinutes: Number(config.high_impact_news_blackout_minutes || config.highImpactNewsBlackoutMinutes || DEFAULT_MOMENTUM_CONFIG.highImpactNewsBlackoutMinutes),
    skipFirstMinutesAfterClose: Number(config.skip_first_minutes_after_close || config.skipFirstMinutesAfterClose || DEFAULT_MOMENTUM_CONFIG.skipFirstMinutesAfterClose),
    leverage: {
      ...DEFAULT_MOMENTUM_CONFIG.leverage,
      ...(config.leverage || {})
    }
  };
}

function normalizeCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map(c => ({
      time: Number(c?.time ?? c?.timestamp ?? c?.openTime ?? 0),
      open: Number(c?.open),
      high: Number(c?.high),
      low: Number(c?.low),
      close: Number(c?.close),
      volume: Number(c?.volume) || 0
    }))
    .filter(c => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low && c.close > 0);
}

export function emaSeries(values = [], period = 20) {
  const arr = values.map(Number).filter(Number.isFinite);
  if (arr.length < period) return [];
  const out = new Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let current = avg(arr.slice(0, period));
  out[period - 1] = current;
  for (let i = period; i < arr.length; i++) {
    current = (arr[i] * k) + (current * (1 - k));
    out[i] = current;
  }
  return out;
}

export function rsiSeries(closes = [], period = 14) {
  const arr = closes.map(Number).filter(Number.isFinite);
  const out = new Array(arr.length).fill(null);
  if (arr.length < period + 1) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const delta = arr[i] - arr[i - 1];
    if (delta >= 0) gains += delta;
    else losses += Math.abs(delta);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

  for (let i = period + 1; i < arr.length; i++) {
    const delta = arr[i] - arr[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
  }

  return out;
}

export function atrSeries(candles = [], period = 14) {
  const series = normalizeCandles(candles);
  const out = new Array(series.length).fill(null);
  if (series.length < period + 1) return out;

  const trs = series.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = series[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });

  let atr = avg(trs.slice(1, period + 1));
  out[period] = atr;
  for (let i = period + 1; i < trs.length; i++) {
    atr = ((atr * (period - 1)) + trs[i]) / period;
    out[i] = atr;
  }
  return out;
}

export function smaSeries(values = [], period = 20) {
  const arr = values.map(Number);
  const out = new Array(arr.length).fill(null);
  for (let i = period - 1; i < arr.length; i++) {
    const slice = arr.slice(i - period + 1, i + 1).filter(Number.isFinite);
    out[i] = slice.length === period ? avg(slice) : null;
  }
  return out;
}

function getSwingLevels(candles, endIndex, lookback) {
  const start = Math.max(0, endIndex - lookback);
  const window = candles.slice(start, endIndex);
  if (!window.length) return { high: null, low: null };
  return {
    high: Math.max(...window.map(c => c.high)),
    low: Math.min(...window.map(c => c.low))
  };
}

function getConsolidationRange(candles, breakoutIndex, config, atrValue) {
  const count = Math.max(5, config.consolidationCandles);
  const start = breakoutIndex - count;
  if (start < 0) return null;
  const window = candles.slice(start, breakoutIndex);
  const high = Math.max(...window.map(c => c.high));
  const low = Math.min(...window.map(c => c.low));
  const range = high - low;
  const close = candles[breakoutIndex]?.close || high;
  const rangePct = close > 0 ? range / close : Infinity;
  const rangeAtr = atrValue > 0 ? range / atrValue : Infinity;
  const tight = rangeAtr <= config.consolidationMaxAtr || rangePct <= 0.006;
  return { high, low, range, rangePct, rangeAtr, tight, candles: window };
}

function hasTwoCloseConfirmation(candles, index, level, direction, count = 2) {
  if (index - count + 1 < 0) return false;
  const recent = candles.slice(index - count + 1, index + 1);
  return recent.length === count && recent.every(c => direction === 'LONG' ? c.close > level : c.close < level);
}

function isStrongConfirmationCandle(candle, atrValue, volSma, direction, config) {
  if (!candle || !(atrValue > 0)) return false;
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, MIN_PRICE);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowWickOk = direction === 'LONG'
    ? lowerWick <= range * 0.28
    : upperWick <= range * 0.28;
  return (
    body >= atrValue * config.strongCandleAtr
    && lowWickOk
    && (!Number.isFinite(volSma) || candle.volume > volSma * config.volumeMultiplier)
  );
}

function isHighImpactNewsBlocked(nowMs, newsEvents = [], config) {
  if (!Array.isArray(newsEvents) || !newsEvents.length) return false;
  const blackoutMs = Math.max(0, config.highImpactNewsBlackoutMinutes) * 60 * 1000;
  return newsEvents.some((event) => {
    const impact = String(event?.impact || event?.importance || '').toLowerCase();
    if (!impact.includes('high')) return false;
    const eventTime = new Date(event?.time || event?.timestamp || event?.date).getTime();
    if (!Number.isFinite(eventTime)) return false;
    const diff = eventTime - nowMs;
    return diff >= 0 && diff <= blackoutMs;
  });
}

function isAfterMajorCloseBlocked(nowMs, config) {
  const mins = Math.max(0, Number(config.skipFirstMinutesAfterClose) || 0);
  if (!mins) return false;
  const d = new Date(nowMs);
  const minutesSinceUtcMidnight = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minutesSinceUtcMidnight < mins) return true;
  const day = d.getUTCDay();
  return day === 1 && minutesSinceUtcMidnight < mins;
}

function detectBreakoutCandidate(candles, indicators, direction, config) {
  const last = candles.length - 1;
  const minIndex = Math.max(55, last - 8);

  for (let i = last; i >= minIndex; i--) {
    const candle = candles[i];
    const atr = indicators.atr[i];
    const volSma = indicators.volumeSma[i];
    const consolidation = getConsolidationRange(candles, i, config, atr);
    if (!consolidation?.tight) continue;

    const swing = getSwingLevels(candles, i, config.swingLookback);
    const rangeLevel = direction === 'LONG'
      ? Math.max(consolidation.high, swing.high ?? consolidation.high)
      : Math.min(consolidation.low, swing.low ?? consolidation.low);
    const broke = direction === 'LONG'
      ? candle.high > rangeLevel && candle.close > rangeLevel
      : candle.low < rangeLevel && candle.close < rangeLevel;
    if (!broke) continue;

    const twoClose = hasTwoCloseConfirmation(candles, i, rangeLevel, direction, config.confirmationCloses);
    const strong = isStrongConfirmationCandle(candle, atr, volSma, direction, config);
    if (!twoClose && !strong) continue;

    const latest = candles[last];
    const tolerance = Math.abs(rangeLevel) * (config.retestTolerancePct / 100);
    const retested = direction === 'LONG'
      ? latest.low <= rangeLevel + tolerance && latest.close >= rangeLevel
      : latest.high >= rangeLevel - tolerance && latest.close <= rangeLevel;
    const isCurrentBreakout = i === last;

    if (!retested && !isCurrentBreakout) continue;

    return {
      index: i,
      candle,
      level: rangeLevel,
      consolidation,
      swing,
      confirmation: twoClose ? 'TWO_CLOSE_CONFIRMATION' : 'STRONG_ATR_VOLUME_CANDLE',
      retested,
      latest
    };
  }

  return null;
}

function chooseLeverage(stopPct, atrPct, config) {
  if (stopPct > 1.05 || atrPct > 0.012) return config.leverage.high;
  if (stopPct > 0.75 || atrPct > 0.007) return config.leverage.medium;
  return config.leverage.low;
}

function pctTarget(entry, pct, direction) {
  return direction === 'LONG'
    ? entry * (1 + pct / 100)
    : Math.max(MIN_PRICE, entry * (1 - pct / 100));
}

function buildTradePlan(symbol, direction, setup, indicators, config, context) {
  const latest = setup.latest;
  const entryLow = direction === 'LONG'
    ? latest.low * (1 + config.entryBufferLowPct / 100)
    : latest.low * (1 - config.entryBufferHighPct / 100);
  const entryHigh = direction === 'LONG'
    ? latest.high * (1 + config.entryBufferHighPct / 100)
    : latest.high * (1 - config.entryBufferLowPct / 100);
  const entries = direction === 'LONG'
    ? [Math.max(entryLow, MIN_PRICE), Math.max((entryLow + entryHigh) / 2, MIN_PRICE), Math.max(entryHigh, MIN_PRICE)].sort((a, b) => b - a)
    : [Math.max(entryLow, MIN_PRICE), Math.max((entryLow + entryHigh) / 2, MIN_PRICE), Math.max(entryHigh, MIN_PRICE)].sort((a, b) => a - b);
  const avgEntry = avg(entries);

  const swingLow = setup.swing.low ?? latest.low;
  const swingHigh = setup.swing.high ?? latest.high;
  const rawStop = direction === 'LONG'
    ? Math.min(setup.candle.low, swingLow)
    : Math.max(setup.candle.high, swingHigh);
  const minStop = avgEntry * (config.minStopPct / 100);
  const maxStop = avgEntry * (config.maxStopPct / 100);
  let stopDistance = Math.abs(avgEntry - rawStop);
  stopDistance = clamp(stopDistance, minStop, maxStop);
  const stop = direction === 'LONG'
    ? Math.max(MIN_PRICE, avgEntry - stopDistance)
    : avgEntry + stopDistance;
  const stopPct = (stopDistance / avgEntry) * 100;

  const tp2Pct = clamp(Math.max(config.tp2Pct, stopPct * config.minRr), 1.0, 1.5);
  const targets = [
    pctTarget(avgEntry, clamp(Math.max(config.tp1Pct, config.minTargetPct), 0.5, 0.7), direction),
    pctTarget(avgEntry, tp2Pct, direction),
    pctTarget(avgEntry, clamp(config.tp3Pct, 2.0, 2.5), direction),
    pctTarget(avgEntry, Math.max(config.tp4Pct, clamp(config.tp3Pct, 2.0, 2.5)), direction)
  ];
  const riskRewardToTp2 = Math.abs(targets[1] - avgEntry) / Math.max(stopDistance, MIN_PRICE);
  const atrPct = indicators.atr[indicators.lastIndex] / avgEntry;

  if (riskRewardToTp2 < config.minRr) {
    return { status: 'NO_SIGNAL', reason: 'MIN_RR_FAIL', riskRewardToTp2 };
  }

  const generatedAt = context.generatedAt || new Date(latest.time || Date.now()).toISOString();
  const managedSignal = createManagedSignal({
    symbol,
    direction,
    timeframe: config.primaryTimeframe,
    generatedAt,
    validForMinutes: config.expiryMinutes,
    expiryCandles: config.expiryCandles,
    keyLevel: `${setup.retested ? 'Breakout Retest' : 'Consolidation Breakout'} (${direction === 'LONG' ? 'Support' : 'Resistance'})`,
    strategySource: setup.confirmation,
    entryLevels: entries,
    targets,
    stopLoss: stop,
    leverage: chooseLeverage(stopPct, atrPct, config),
    riskPerTradePct: config.riskPerTrade,
    stopDistancePct: stopPct,
    riskRewardToTp2,
    invalidationTimeframe: config.primaryTimeframe,
    invalidationMode: context.invalidationMode || 'BODY_CLOSE',
    invalidationPrice: stop,
    confidence: context.confidence || null,
    source: 'momentum_breakout_retest'
  });

  managedSignal.exitPlan = {
    tp1ClosePct: config.tp1ClosePct,
    tp2ClosePct: config.tp2ClosePct,
    tp3ClosePct: config.tp3ClosePct,
    breakeven: 'Move stop to entry only after TP1 is hit.',
    trail: 'After TP3, trail remaining exposure with 1x ATR from peak.'
  };

  return {
    status: 'SIGNAL',
    direction: direction === 'LONG' ? 'BUY' : 'SELL',
    setupType: setup.retested ? 'BREAKOUT_RETEST' : 'CONSOLIDATION_BREAKOUT',
    patternSummary: setup.confirmation,
    entry: entries[0],
    entry1: entries[0],
    entry2: entries[1],
    entry3: entries[2],
    avgEntry,
    tp1: targets[0],
    tp2: targets[1],
    tp3: targets[2],
    tp4: targets[3],
    sl: stop,
    leverage: managedSignal.leverage,
    invalidation: managedSignal.priceInvalidation.text,
    stopBasis: direction === 'LONG' ? 'BREAKOUT_OR_SWING_LOW' : 'BREAKOUT_OR_SWING_HIGH',
    targetBasis: ['TP1_0.5_0.7PCT', 'TP2_1.0_1.5PCT', 'TP3_2.0_2.5PCT', 'TRAIL_1X_ATR_EXTENSION'],
    riskPct: stopPct,
    positionRiskPct: config.riskPerTrade,
    rrToTp1: Math.abs(targets[0] - avgEntry) / Math.max(stopDistance, MIN_PRICE),
    rrRatio: riskRewardToTp2,
    spreadPct: context.spreadPct ?? null,
    atrPct: atrPct * 100,
    confirmations: [setup.confirmation, setup.retested ? 'RETEST_CONFIRMED' : 'BREAKOUT_ENTRY'],
    alpha: Math.round(context.alpha || context.confidence || 70),
    lifecycleStatus: managedSignal.status,
    managedSignal,
    signalId: managedSignal.signalId,
    generatedAt: managedSignal.generatedAt,
    generatedAtLabel: managedSignal.generatedAtLabel,
    validUntil: managedSignal.validUntil,
    validUntilLabel: managedSignal.validUntilLabel,
    priceInvalidation: managedSignal.priceInvalidation,
    timeInvalidation: managedSignal.timeInvalidation,
    exitPlan: managedSignal.exitPlan,
    line: null
  };
}

function buildIndicators(candles) {
  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const rsi = rsiSeries(closes, 14);
  const atr = atrSeries(candles, 14);
  const volumeSma = smaSeries(volumes, 20);
  return {
    ema20,
    ema50,
    rsi,
    atr,
    volumeSma,
    lastIndex: candles.length - 1
  };
}

function trendAllowsDirection(direction, candles, indicators, trendCandles, config) {
  const i = indicators.lastIndex;
  const price = candles[i].close;
  const ema20 = indicators.ema20[i];
  const ema50 = indicators.ema50[i];
  const rsi = indicators.rsi[i];
  const prevRsi = indicators.rsi[i - 1];
  if (![ema20, ema50, rsi, prevRsi].every(Number.isFinite)) return false;

  const primaryOk = direction === 'LONG'
    ? price > ema20 && price > ema50 && rsi > 50 && rsi > prevRsi && rsi < config.rsiLongMax
    : price < ema20 && price < ema50 && rsi < 50 && rsi < prevRsi && rsi > config.rsiShortMin;
  if (!primaryOk) return false;

  const higher = normalizeCandles(trendCandles || []);
  if (higher.length < 50) return true;
  const hCloses = higher.map(c => c.close);
  const hEma20 = emaSeries(hCloses, 20);
  const hEma50 = emaSeries(hCloses, 50);
  const hi = higher.length - 1;
  if (![hEma20[hi], hEma50[hi]].every(Number.isFinite)) return true;
  return direction === 'LONG'
    ? higher[hi].close >= hEma20[hi] && hEma20[hi] >= hEma50[hi]
    : higher[hi].close <= hEma20[hi] && hEma20[hi] <= hEma50[hi];
}

function buildNoSignal(reason, meta = {}) {
  return {
    status: 'NO_SIGNAL',
    reason,
    alpha: Math.round(meta.alpha || 50),
    direction: meta.direction || null,
    patternSummary: reason,
    atrPct: meta.atrPct ?? null,
    spreadPct: meta.spreadPct ?? null
  };
}

export function evaluateMomentumStrategy(symbol = 'BTC', primaryCandles = [], trendCandles = [], rawConfig = {}, context = {}) {
  const config = normalizeMomentumConfig(rawConfig);
  const candles = normalizeCandles(primaryCandles).slice(-Math.max(80, config.fetchLimit || 200));
  if (candles.length < 80) return buildNoSignal('INSUFFICIENT_CANDLES', { spreadPct: context.spreadPct });

  const indicators = buildIndicators(candles);
  const i = indicators.lastIndex;
  const latest = candles[i];
  const atr = indicators.atr[i];
  const atrPct = atr && latest.close ? atr / latest.close : 0;
  const spreadPct = Number(context.spreadPct);

  if (!(atrPct >= config.atrThreshold)) return buildNoSignal('ATR_TOO_LOW', { atrPct: atrPct * 100, spreadPct });
  if (Number.isFinite(spreadPct) && spreadPct > config.spreadMaxPct) return buildNoSignal('SPREAD_TOO_WIDE', { atrPct: atrPct * 100, spreadPct });
  if (isHighImpactNewsBlocked(latest.time || Date.now(), context.newsEvents, config)) return buildNoSignal('HIGH_IMPACT_NEWS_BLACKOUT', { atrPct: atrPct * 100, spreadPct });
  if (isAfterMajorCloseBlocked(latest.time || Date.now(), config)) return buildNoSignal('MAJOR_CLOSE_COOLDOWN', { atrPct: atrPct * 100, spreadPct });

  const longAllowed = trendAllowsDirection('LONG', candles, indicators, trendCandles, config);
  const shortAllowed = trendAllowsDirection('SHORT', candles, indicators, trendCandles, config);
  const directions = longAllowed ? ['LONG'] : (shortAllowed ? ['SHORT'] : []);
  if (!directions.length) return buildNoSignal('TREND_FILTER_FAIL', { atrPct: atrPct * 100, spreadPct });

  for (const direction of directions) {
    const setup = detectBreakoutCandidate(candles, indicators, direction, config);
    if (!setup) continue;
    const plan = buildTradePlan(symbol, direction, setup, indicators, config, {
      ...context,
      atrPct: atrPct * 100,
      generatedAt: context.generatedAt || new Date(latest.time || Date.now()).toISOString(),
      spreadPct
    });
    if (plan.status === 'SIGNAL') return plan;
    return buildNoSignal(plan.reason || 'TRADE_PLAN_FAIL', {
      atrPct: atrPct * 100,
      spreadPct,
      direction: direction === 'LONG' ? 'BUY' : 'SELL'
    });
  }

  return buildNoSignal('NO_BREAKOUT_RETEST_SETUP', { atrPct: atrPct * 100, spreadPct });
}

export function runMomentumBacktest(symbol = 'BTC', candlesInput = [], trendCandlesInput = [], rawConfig = {}) {
  const config = normalizeMomentumConfig(rawConfig);
  const candles = normalizeCandles(candlesInput);
  const trendCandles = normalizeCandles(trendCandlesInput);
  const trades = [];
  const equity = [0];

  for (let i = 80; i < candles.length - 1; i++) {
    const window = candles.slice(0, i + 1);
    const signal = evaluateMomentumStrategy(symbol, window, trendCandles, config, {
      generatedAt: new Date(candles[i].time || Date.now()).toISOString(),
      spreadPct: 0
    });
    if (signal.status !== 'SIGNAL') continue;

    const entryMin = Math.min(signal.entry1, signal.entry2, signal.entry3);
    const entryMax = Math.max(signal.entry1, signal.entry2, signal.entry3);
    const expiryBars = Math.max(1, Math.round(config.expiryMinutes / timeframeToMinutes(config.primaryTimeframe)));
    const stop = signal.sl;
    const side = signal.direction === 'BUY' ? 'LONG' : 'SHORT';
    let triggered = false;
    let entry = signal.avgEntry;
    let tp1Hit = false;
    let tp2HitOnce = false;
    let resultR = 0;
    let outcome = 'EXPIRED';
    let exitIndex = i + expiryBars;

    for (let j = i + 1; j < candles.length; j++) {
      const c = candles[j];
      if (!triggered) {
        const touched = c.low <= entryMax && c.high >= entryMin;
        if (!touched) {
          if (j > i + expiryBars) break;
          continue;
        }
        triggered = true;
        entry = signal.avgEntry;
      }

      const risk = Math.max(Math.abs(entry - stop), MIN_PRICE);
      const stopHit = side === 'LONG' ? c.low <= stop : c.high >= stop;
      const tp1HitNow = side === 'LONG' ? c.high >= signal.tp1 : c.low <= signal.tp1;
      const tp2Hit = side === 'LONG' ? c.high >= signal.tp2 : c.low <= signal.tp2;
      const tp3Hit = side === 'LONG' ? c.high >= signal.tp3 : c.low <= signal.tp3;
      const beStopHit = tp1Hit && (side === 'LONG' ? c.low <= entry : c.high >= entry);

      if (stopHit && !tp1Hit && !tp1HitNow) {
        resultR = -1;
        outcome = 'SL';
        exitIndex = j;
        break;
      }
      if (tp1HitNow && !tp1Hit) {
        resultR += 0.3 * (Math.abs(signal.tp1 - entry) / risk);
        tp1Hit = true;
      }
      if (tp2Hit && !tp2HitOnce) {
        resultR += 0.4 * (Math.abs(signal.tp2 - entry) / risk);
        tp2HitOnce = true;
      }
      if (tp3Hit) {
        resultR += 0.3 * (Math.abs(signal.tp3 - entry) / risk);
        outcome = 'TP3';
        exitIndex = j;
        break;
      }
      if (beStopHit) {
        outcome = 'BE';
        exitIndex = j;
        break;
      }
    }

    if (triggered) {
      trades.push({
        signalId: signal.signalId,
        symbol,
        direction: signal.direction,
        entry,
        stop,
        rrToTp2: signal.rrRatio,
        resultR,
        outcome,
        openedAt: candles[i]?.time,
        closedAt: candles[exitIndex]?.time
      });
      equity.push(equity[equity.length - 1] + resultR);
      i = Math.max(i, exitIndex);
    }
  }

  const wins = trades.filter(t => t.resultR > 0);
  const losses = trades.filter(t => t.resultR < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.resultR, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.resultR, 0));
  let peak = equity[0] || 0;
  let maxDrawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, peak - value);
  }

  return {
    symbol,
    trades,
    summary: {
      trades: trades.length,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      avgRR: trades.length ? avg(trades.map(t => t.rrToTp2)) : 0,
      maxDrawdownR: maxDrawdown,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
      netR: trades.reduce((sum, t) => sum + t.resultR, 0)
    }
  };
}
