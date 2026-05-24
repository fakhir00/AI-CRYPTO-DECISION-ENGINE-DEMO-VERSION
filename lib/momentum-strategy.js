import { createManagedSignal, normalizeSignalStopReason } from './signal-lifecycle.js';

const MIN_PRICE = 0.0000001;

export const SIGNAL_HARD_REJECTS = {
  minVolumeRatio: 0.3,
  minTp1Pct: 0.25,
  minStopDistancePct: 0.15,
  maxEntryWidthPct: 0.35,
  tp1TooLow: 'TP1 percentage <0.25%',
  volumeTooLow: 'Volume too low',
  stopTooTight: 'Stop distance <0.15%',
  entryZoneTooWide: 'Entry zone too wide'
};

export const DEFAULT_MOMENTUM_CONFIG = {
  primaryTimeframe: '15m',
  trendTimeframe: '1h',
  fetchLimit: 200,
  consolidationCandles: 5,
  consolidationMaxAtr: 1.6,
  confirmationCloses: 1,
  strongCandleAtr: 1.0,
  volumeMultiplier: 0.3,
  atrThreshold: 0.0005,
  spreadMaxPct: 0.15,
  rsiLongMax: 88,
  rsiShortMin: 12,
  swingLookback: 12,
  retestTolerancePct: 0.25,
  entryBufferLowPct: 0.05,
  entryBufferHighPct: 0.10,
  entryZoneMinWidthPct: 0.05,
  entryZoneMaxWidthPct: 0.35,
  minTargetPct: 0.25,
  tp1Pct: 0.3,
  tp2Pct: 0.6,
  tp3Pct: 1.2,
  tp4Pct: 1.8,
  tp1ClosePct: 30,
  tp2ClosePct: 40,
  tp3ClosePct: 30,
  minStopPct: 0.15,
  maxStopPct: 3.0,
  minTp1Rr: 0.4,
  structuralStopBufferPct: 0.05,
  riskPerTrade: 0.5,
  minRr: 1.0,
  expiryMinutes: 45,
  expiryCandles: 4,
  highImpactNewsBlackoutMinutes: 5,
  skipFirstMinutesAfterClose: 0,
  leverage: {
    tight: '3x Cross',
    wide: '2x Cross'
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
    entryZoneMinWidthPct: Number(config.entry_zone_min_width_pct || config.entryZoneMinWidthPct || DEFAULT_MOMENTUM_CONFIG.entryZoneMinWidthPct),
    entryZoneMaxWidthPct: Number(config.entry_zone_max_width_pct || config.entryZoneMaxWidthPct || DEFAULT_MOMENTUM_CONFIG.entryZoneMaxWidthPct),
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
    minTp1Rr: Number(config.min_tp1_rr || config.minTp1Rr || DEFAULT_MOMENTUM_CONFIG.minTp1Rr),
    structuralStopBufferPct: Number(config.structural_stop_buffer_pct || config.structuralStopBufferPct || DEFAULT_MOMENTUM_CONFIG.structuralStopBufferPct),
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

function getVolumeRatio(candle, averageVolume) {
  const volume = Number(candle?.volume);
  const avgVolume = Number(averageVolume);
  if (!(volume > 0) || !(avgVolume > 0)) return null;
  return volume / avgVolume;
}

function buildZoneAroundMid(mid, widthPct) {
  const safeMid = Math.max(Number(mid) || MIN_PRICE, MIN_PRICE);
  const pct = Math.max(Number(widthPct) || 0, 0) / 100;
  const low = (2 * safeMid) / (2 + pct);
  const high = low * (1 + pct);
  return { low: Math.max(low, MIN_PRICE), high: Math.max(high, MIN_PRICE) };
}

function normalizeEntryZone(rawLow, rawHigh, direction, config) {
  let zoneLow = Math.max(Math.min(Number(rawLow), Number(rawHigh)), MIN_PRICE);
  let zoneHigh = Math.max(Math.max(Number(rawLow), Number(rawHigh)), MIN_PRICE);
  let rawWidthPct = zoneLow > 0 ? ((zoneHigh - zoneLow) / zoneLow) * 100 : Infinity;
  if (!(zoneHigh > zoneLow)) {
    const zone = buildZoneAroundMid((zoneLow + zoneHigh) / 2, config.entryZoneMinWidthPct);
    zoneLow = zone.low;
    zoneHigh = zone.high;
    rawWidthPct = 0;
  }

  let widthPct = ((zoneHigh - zoneLow) / zoneLow) * 100;
  const minWidth = Math.max(0.01, Number(config.entryZoneMinWidthPct) || 0.10);
  const maxWidth = Math.max(minWidth, Number(config.entryZoneMaxWidthPct) || 0.20);
  if (widthPct < minWidth || widthPct > maxWidth) {
    const mid = (zoneLow + zoneHigh) / 2;
    const targetWidth = clamp(widthPct, minWidth, maxWidth);
    const zone = buildZoneAroundMid(mid, targetWidth);
    zoneLow = zone.low;
    zoneHigh = zone.high;
    widthPct = ((zoneHigh - zoneLow) / zoneLow) * 100;
  }

  const entries = [zoneLow, (zoneLow + zoneHigh) / 2, zoneHigh]
    .map(price => Math.max(price, MIN_PRICE))
    .sort((a, b) => direction === 'SHORT' ? a - b : b - a);

  return { entries, zoneLow, zoneHigh, widthPct, rawWidthPct };
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
  const minVolumeRatio = Math.max(
    Number(config.volumeMultiplier) || DEFAULT_MOMENTUM_CONFIG.volumeMultiplier,
    SIGNAL_HARD_REJECTS.minVolumeRatio
  );
  let lowVolumeRejection = null;

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

    const volumeIndex = retested ? last : i;
    const volumeCandle = candles[volumeIndex];
    const volumeRatio = getVolumeRatio(volumeCandle, indicators.volumeSma[volumeIndex]);
    if (!(volumeRatio >= minVolumeRatio)) {
      lowVolumeRejection = {
        status: 'NO_SIGNAL',
        reason: SIGNAL_HARD_REJECTS.volumeTooLow,
        rejectionReasons: [SIGNAL_HARD_REJECTS.volumeTooLow],
        volumeRatio
      };
      continue;
    }
    const breakoutVolumeAvg = indicators.volumeSma[i];
    const breakoutVolumeRatio = getVolumeRatio(candle, breakoutVolumeAvg);

    return {
      index: i,
      candle,
      level: rangeLevel,
      consolidation,
      swing,
      recentSwing: getSwingLevels(candles, last + 1, config.swingLookback),
      confirmation: twoClose ? 'TWO_CLOSE_CONFIRMATION' : 'STRONG_ATR_VOLUME_CANDLE',
      volumeRatio,
      breakoutVolumeRatio,
      breakoutVolumeAvg,
      breakoutVolume: candle.volume,
      volumeCandle,
      retested,
      latest
    };
  }

  return lowVolumeRejection;
}

function chooseLeverage(stopPct, config) {
  return stopPct < 0.6
    ? (config.leverage.tight || '3x Cross')
    : (config.leverage.wide || '2x Cross');
}

function formatThreshold(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return String(Number(num.toFixed(digits)));
}

function pushRejectionReason(reasons, reason) {
  if (!reason || reasons.includes(reason)) return;
  reasons.push(reason);
}

function formatRejectedReason(reasons = []) {
  const clean = [];
  for (const reason of reasons) {
    pushRejectionReason(clean, reason);
  }
  return clean.length ? `REJECTED: ${clean.join(', ')}` : 'REJECTED';
}

function getHardRejectReason(reasons = []) {
  if (!Array.isArray(reasons)) return null;
  return reasons.find(reason => (
    reason === SIGNAL_HARD_REJECTS.tp1TooLow
    || reason === SIGNAL_HARD_REJECTS.volumeTooLow
    || reason === SIGNAL_HARD_REJECTS.stopTooTight
    || reason === SIGNAL_HARD_REJECTS.entryZoneTooWide
  )) || null;
}

function appendMetricRejectionReasons(reasons, metrics = {}, config) {
  const minTp1Pct = Math.max(
    Number(config.minTargetPct) || DEFAULT_MOMENTUM_CONFIG.minTargetPct,
    SIGNAL_HARD_REJECTS.minTp1Pct
  );
  const minRr = Number(config.minRr) || DEFAULT_MOMENTUM_CONFIG.minRr;
  const minZoneWidthPct = Number(config.entryZoneMinWidthPct) || DEFAULT_MOMENTUM_CONFIG.entryZoneMinWidthPct;
  const maxZoneWidthPct = Math.min(
    Number(config.entryZoneMaxWidthPct) || DEFAULT_MOMENTUM_CONFIG.entryZoneMaxWidthPct,
    SIGNAL_HARD_REJECTS.maxEntryWidthPct
  );
  const minVolumeRatio = Math.max(
    Number(config.volumeMultiplier) || DEFAULT_MOMENTUM_CONFIG.volumeMultiplier,
    SIGNAL_HARD_REJECTS.minVolumeRatio
  );
  const minAtrPct = (Number(config.atrThreshold) || DEFAULT_MOMENTUM_CONFIG.atrThreshold) * 100;
  const maxRsi = Number(config.rsiLongMax) || DEFAULT_MOMENTUM_CONFIG.rsiLongMax;
  const maxSpreadPct = Number(config.spreadMaxPct) || DEFAULT_MOMENTUM_CONFIG.spreadMaxPct;
  const minStopPct = Math.max(
    Number(config.minStopPct) || DEFAULT_MOMENTUM_CONFIG.minStopPct,
    SIGNAL_HARD_REJECTS.minStopDistancePct
  );
  const epsilon = 0.000001;

  const tp1Pct = Number(metrics.tp1Pct);
  if (Number.isFinite(tp1Pct) && tp1Pct + epsilon < minTp1Pct) {
    pushRejectionReason(reasons, SIGNAL_HARD_REJECTS.tp1TooLow);
  }

  const rrToTp2 = Number(metrics.rrToTp2);
  if (metrics.rrToTp2 !== undefined && !(Number.isFinite(rrToTp2) && rrToTp2 + epsilon >= minRr)) {
    pushRejectionReason(reasons, `R:R <${formatThreshold(minRr)}`);
  }

  const zoneWidthPct = Number(metrics.zoneWidthPct);
  if (Number.isFinite(zoneWidthPct) && zoneWidthPct - epsilon > maxZoneWidthPct) {
    pushRejectionReason(reasons, SIGNAL_HARD_REJECTS.entryZoneTooWide);
  } else if (Number.isFinite(zoneWidthPct) && zoneWidthPct + epsilon < minZoneWidthPct) {
    pushRejectionReason(reasons, 'zone width bad');
  }

  const volumeRatio = Number(metrics.volumeRatio);
  if (Number.isFinite(volumeRatio) && volumeRatio + epsilon < minVolumeRatio) {
    pushRejectionReason(reasons, SIGNAL_HARD_REJECTS.volumeTooLow);
  }

  const atrPct = Number(metrics.atrPct);
  if (Number.isFinite(atrPct) && atrPct + epsilon < minAtrPct) {
    pushRejectionReason(reasons, 'ATR low');
  }

  const rsi = Number(metrics.rsi);
  if (Number.isFinite(rsi) && rsi > maxRsi) {
    pushRejectionReason(reasons, 'RSI overbought');
  }

  const spreadPct = Number(metrics.spreadPct);
  if (Number.isFinite(spreadPct) && spreadPct > maxSpreadPct) {
    pushRejectionReason(reasons, 'spread high');
  }

  const stopDistancePct = Number(metrics.stopDistancePct);
  if (Number.isFinite(stopDistancePct) && stopDistancePct + epsilon < minStopPct) {
    pushRejectionReason(reasons, SIGNAL_HARD_REJECTS.stopTooTight);
  }

  if (metrics.timeInNoTradeZone) {
    pushRejectionReason(reasons, 'time blackout');
  }

  return reasons;
}

function pctTarget(entry, pct, direction) {
  return direction === 'LONG'
    ? entry * (1 + pct / 100)
    : Math.max(MIN_PRICE, entry * (1 - pct / 100));
}

function chooseStructuralStop(direction, avgEntry, setup, config) {
  const buffer = Math.max(0, Number(config.structuralStopBufferPct) || 0.05) / 100;
  const minStopPct = Math.max(
    Number(config.minStopPct) || DEFAULT_MOMENTUM_CONFIG.minStopPct,
    SIGNAL_HARD_REJECTS.minStopDistancePct
  );
  const recentSwing = setup.recentSwing || setup.swing || {};
  const stopOptions = direction === 'LONG'
    ? [
        { basis: 'SWING_LOW', reason: 'below swing low', price: (recentSwing.low ?? setup.latest.low) * (1 - buffer) },
        { basis: 'BREAKOUT_CANDLE_LOW', reason: 'below breakout candle', price: setup.candle.low * (1 - buffer) }
      ]
    : [
        { basis: 'SWING_HIGH', reason: 'above swing high', price: (recentSwing.high ?? setup.latest.high) * (1 + buffer) },
        { basis: 'BREAKDOWN_CANDLE_HIGH', reason: 'above breakdown candle', price: setup.candle.high * (1 + buffer) }
      ];

  const candidates = stopOptions
    .map((option) => {
      const stop = Math.max(Number(option.price) || 0, MIN_PRICE);
      const distance = direction === 'LONG' ? avgEntry - stop : stop - avgEntry;
      const pct = avgEntry > 0 ? (distance / avgEntry) * 100 : 0;
      return { ...option, stop, distance, pct };
    })
    .filter(option => option.distance > 0 && Number.isFinite(option.pct));

  if (!candidates.length) return { status: 'NO_SIGNAL', reason: 'STRUCTURAL_STOP_INVALID' };

  const widestPct = Math.max(...candidates.map(option => option.pct));
  if (widestPct < minStopPct) {
    return { status: 'NO_SIGNAL', reason: 'STOP_TOO_TIGHT' };
  }

  const valid = candidates
    .filter(option => option.pct <= config.maxStopPct)
    .sort((a, b) => b.pct - a.pct);

  if (!valid.length) return { status: 'NO_SIGNAL', reason: 'STOP_DISTANCE_TOO_WIDE' };
  if (valid[0].pct < minStopPct) return { status: 'NO_SIGNAL', reason: 'STOP_TOO_TIGHT' };
  return { status: 'OK', ...valid[0] };
}

function buildTradePlan(symbol, direction, setup, indicators, config, context) {
  const latest = setup.latest;
  const rawEntryLow = direction === 'LONG'
    ? latest.low * (1 + config.entryBufferLowPct / 100)
    : latest.low * (1 - config.entryBufferHighPct / 100);
  const rawEntryHigh = direction === 'LONG'
    ? latest.high * (1 + config.entryBufferHighPct / 100)
    : latest.high * (1 - config.entryBufferLowPct / 100);
  const entryZone = normalizeEntryZone(rawEntryLow, rawEntryHigh, direction, config);
  const entries = entryZone.entries;
  const avgEntry = avg(entries);
  const rejectionZoneWidthPct = Number.isFinite(entryZone.rawWidthPct) ? entryZone.rawWidthPct : entryZone.widthPct;
  const commonRejectionMetrics = {
    zoneWidthPct: rejectionZoneWidthPct,
    volumeRatio: setup.volumeRatio,
    atrPct: context.atrPct,
    rsi: indicators.rsi[indicators.lastIndex],
    spreadPct: context.spreadPct,
    timeInNoTradeZone: context.timeInNoTradeZone
  };

  const stopChoice = chooseStructuralStop(direction, avgEntry, setup, config);
  if (stopChoice.status !== 'OK') {
    const rejectionReasons = appendMetricRejectionReasons([], commonRejectionMetrics, config);
    if (stopChoice.reason === 'STOP_TOO_TIGHT') {
      pushRejectionReason(rejectionReasons, SIGNAL_HARD_REJECTS.stopTooTight);
    }
    if (rejectionReasons.length) {
      return {
        status: 'NO_SIGNAL',
        reason: formatRejectedReason(rejectionReasons),
        rejectionReasons,
        zoneWidthPct: rejectionZoneWidthPct,
        normalizedZoneWidthPct: entryZone.widthPct,
        volumeRatio: setup.volumeRatio,
        atrPct: context.atrPct,
        spreadPct: context.spreadPct
      };
    }
    return { status: 'NO_SIGNAL', reason: stopChoice.reason };
  }

  const stop = stopChoice.stop;
  const stopDistance = stopChoice.distance;
  const stopPct = stopChoice.pct;

  const tp2Pct = clamp(Math.max(config.tp2Pct, stopPct * config.minRr), 1.0, 1.5);
  const targets = [
    pctTarget(avgEntry, clamp(Math.max(config.tp1Pct, config.minTargetPct), 0.5, 0.7), direction),
    pctTarget(avgEntry, tp2Pct, direction),
    pctTarget(avgEntry, clamp(config.tp3Pct, 2.0, 2.5), direction),
    pctTarget(avgEntry, Math.max(config.tp4Pct, clamp(config.tp3Pct, 2.0, 2.5)), direction)
  ];
  const tp1DistancePct = (Math.abs(targets[0] - avgEntry) / avgEntry) * 100;
  const tp2DistancePct = (Math.abs(targets[1] - avgEntry) / avgEntry) * 100;
  const riskRewardToTp1 = tp1DistancePct / Math.max(stopPct, 0.00001);
  const riskRewardToTp2 = tp2DistancePct / Math.max(stopPct, 0.00001);
  const atrPct = indicators.atr[indicators.lastIndex] / avgEntry;
  const outputVolumeRatio = Number(setup.breakoutVolumeRatio);
  const outputVolumeAvg = Number(setup.breakoutVolumeAvg);
  const outputVolume = Number(setup.breakoutVolume);
  const setupVolumeRatio = Number(setup.volumeRatio);
  const signalVolumeRatio = Number.isFinite(outputVolumeRatio) && Number.isFinite(setupVolumeRatio)
    ? Math.min(outputVolumeRatio, setupVolumeRatio)
    : (Number.isFinite(outputVolumeRatio) ? outputVolumeRatio : setupVolumeRatio);
  const rejectionReasons = appendMetricRejectionReasons([], {
    ...commonRejectionMetrics,
    volumeRatio: signalVolumeRatio,
    tp1Pct: tp1DistancePct,
    rrToTp2: riskRewardToTp2,
    atrPct: atrPct * 100,
    stopDistancePct: stopPct
  }, config);

  if (rejectionReasons.length) {
    return {
      status: 'NO_SIGNAL',
      reason: formatRejectedReason(rejectionReasons),
      rejectionReasons,
      tp1DistancePct,
      riskRewardToTp2,
      zoneWidthPct: rejectionZoneWidthPct,
      normalizedZoneWidthPct: entryZone.widthPct,
      volumeRatio: signalVolumeRatio,
      atrPct: atrPct * 100,
      spreadPct: context.spreadPct,
      stopDistancePct: stopPct
    };
  }
  if (!(outputVolumeRatio > 0) || !(outputVolumeAvg > 0) || !(outputVolume > 0)) {
    return {
      status: 'NO_SIGNAL',
      reason: 'SIGNAL_METADATA_MISSING',
      rejectionReasons: ['volume unavailable']
    };
  }
  if (riskRewardToTp1 < config.minTp1Rr) {
    return { status: 'NO_SIGNAL', reason: 'TP1_RR_FAIL', riskRewardToTp1 };
  }

  const generatedAt = context.generatedAt || new Date(latest.time || Date.now()).toISOString();
  const managedSignal = createManagedSignal({
    strategyPreset: 'MOMENTUM_INTRADAY',
    symbol,
    direction,
    timeframe: config.primaryTimeframe,
    generatedAt,
    validForMinutes: config.expiryMinutes,
    expiryCandles: config.expiryCandles,
    keyLevel: `Momentum Intraday Swing (${direction === 'LONG' ? 'Support' : 'Resistance'})`,
    strategySource: setup.confirmation,
    signalType: `Momentum Intraday Swing ${direction === 'LONG' ? 'Long' : 'Short'}`,
    entryLevels: entries,
    targets,
    stopLoss: stop,
    leverage: chooseLeverage(stopPct, config),
    riskPerTradePct: config.riskPerTrade,
    stopDistancePct: stopPct,
    riskRewardToTp2,
    invalidationTimeframe: config.primaryTimeframe,
    invalidationMode: context.invalidationMode || 'BODY_CLOSE',
    invalidationPrice: stop,
    confidence: context.confidence || null,
    source: 'momentum_intraday_swing'
  });
  managedSignal.entryZone.widthPct = entryZone.widthPct;
  managedSignal.entryZoneWidthPct = entryZone.widthPct;
  managedSignal.stopReason = normalizeSignalStopReason(stopChoice.reason);
  managedSignal.volumeConfirmation = {
    ratio: outputVolumeRatio,
    volume: outputVolume,
    averageVolume: outputVolumeAvg,
    text: `${outputVolumeRatio.toFixed(2)}x avg`
  };
  managedSignal.timeInvalidation.text = `Cancel if entry not triggered within ${config.expiryCandles} x ${config.primaryTimeframe} candles or ${config.expiryMinutes} minutes, whichever comes first`;

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
    setupType: setup.retested ? 'MOMENTUM_INTRADAY_RETEST' : 'MOMENTUM_INTRADAY_BREAKOUT',
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
    stopBasis: stopChoice.basis,
    stopReason: managedSignal.stopReason,
    targetBasis: ['TP1_MIN_0.5PCT', 'TP2_MIN_RR_1.5', 'TP3_INTRADAY_SWING', 'TRAIL_1X_ATR_EXTENSION'],
    entryZoneMin: Math.min(...entries),
    entryZoneMax: Math.max(...entries),
    entryZoneWidthPct: entryZone.widthPct,
    riskPct: stopPct,
    positionRiskPct: config.riskPerTrade,
    rrToTp1: riskRewardToTp1,
    rrRatio: riskRewardToTp2,
    spreadPct: context.spreadPct ?? null,
    atrPct: atrPct * 100,
    volumeMultiple: outputVolumeRatio,
    volumeConfirmation: managedSignal.volumeConfirmation,
    confirmations: [setup.confirmation, setup.retested ? 'RETEST_CONFIRMED' : 'BREAKOUT_ENTRY', `VOLUME_${setup.volumeRatio.toFixed(2)}X_AVG`],
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
  if (![ema50, rsi].every(Number.isFinite)) return false;

  const primaryOk = direction === 'LONG'
    ? price > ema50 && rsi >= 45 && rsi < config.rsiLongMax
    : price < ema50 && rsi <= 55 && rsi > config.rsiShortMin;
  if (!primaryOk) return false;

  const higher = normalizeCandles(trendCandles || []);
  if (higher.length < 50) return true;
  const hCloses = higher.map(c => c.close);
  const hEma50 = emaSeries(hCloses, 50);
  const hi = higher.length - 1;
  if (!Number.isFinite(hEma50[hi])) return true;
  return direction === 'LONG'
    ? higher[hi].close >= hEma50[hi]
    : higher[hi].close <= hEma50[hi];
}

function buildNoSignal(reason, meta = {}) {
  const rejectionReasons = Array.isArray(meta.rejectionReasons) ? [] : null;
  if (rejectionReasons) {
    for (const rejectionReason of meta.rejectionReasons) {
      pushRejectionReason(rejectionReasons, rejectionReason);
    }
  }
  const cleanAtrPct = Number(meta.atrPct);
  const cleanSpreadPct = Number(meta.spreadPct);
  return {
    status: 'NO_SIGNAL',
    reason,
    alpha: Math.round(meta.alpha || 50),
    direction: meta.direction || null,
    patternSummary: reason,
    atrPct: Number.isFinite(cleanAtrPct) ? cleanAtrPct : null,
    spreadPct: Number.isFinite(cleanSpreadPct) ? cleanSpreadPct : null,
    rejectionReasons: rejectionReasons || [],
    rejectionLog: rejectionReasons?.length ? formatRejectedReason(rejectionReasons) : null
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
  const atrPctDisplay = atrPct * 100;
  const spreadPct = Number(context.spreadPct);
  const latestVolumeRatio = getVolumeRatio(latest, indicators.volumeSma[i]);
  const latestRsi = indicators.rsi[i];
  const nowMs = latest.time || Date.now();
  const timeInNoTradeZone = (
    isHighImpactNewsBlocked(nowMs, context.newsEvents, config)
    || isAfterMajorCloseBlocked(nowMs, config)
  );

  if (latestVolumeRatio === null) return buildNoSignal('VOLUME_DATA_MISSING', { atrPct: atrPctDisplay, spreadPct });
  const minVolumeRatio = Math.max(
    Number(config.volumeMultiplier) || DEFAULT_MOMENTUM_CONFIG.volumeMultiplier,
    SIGNAL_HARD_REJECTS.minVolumeRatio
  );
  if (latestVolumeRatio < minVolumeRatio) {
    return buildNoSignal(SIGNAL_HARD_REJECTS.volumeTooLow, {
      atrPct: atrPctDisplay,
      spreadPct,
      rejectionReasons: [SIGNAL_HARD_REJECTS.volumeTooLow]
    });
  }

  const preflightRejectionReasons = appendMetricRejectionReasons([], {
    atrPct: atrPctDisplay,
    rsi: latestRsi,
    spreadPct,
    timeInNoTradeZone
  }, config);
  if (preflightRejectionReasons.length) {
    return buildNoSignal(formatRejectedReason(preflightRejectionReasons), {
      atrPct: atrPctDisplay,
      spreadPct,
      rejectionReasons: preflightRejectionReasons
    });
  }

  const longAllowed = trendAllowsDirection('LONG', candles, indicators, trendCandles, config);
  const shortAllowed = trendAllowsDirection('SHORT', candles, indicators, trendCandles, config);
  const directions = longAllowed ? ['LONG'] : (shortAllowed ? ['SHORT'] : []);
  if (!directions.length) return buildNoSignal('TREND_FILTER_FAIL', { atrPct: atrPctDisplay, spreadPct });

  for (const direction of directions) {
    const setup = detectBreakoutCandidate(candles, indicators, direction, config);
    if (!setup) continue;
    if (setup.status === 'NO_SIGNAL') {
      return buildNoSignal(setup.reason || 'TRADE_PLAN_FAIL', {
        atrPct: atrPctDisplay,
        spreadPct,
        direction: direction === 'LONG' ? 'BUY' : 'SELL',
        rejectionReasons: setup.rejectionReasons
      });
    }
    const plan = buildTradePlan(symbol, direction, setup, indicators, config, {
      ...context,
      atrPct: atrPctDisplay,
      generatedAt: context.generatedAt || new Date(latest.time || Date.now()).toISOString(),
      spreadPct,
      timeInNoTradeZone
    });
    if (plan.status === 'SIGNAL') return plan;
    return buildNoSignal(getHardRejectReason(plan.rejectionReasons) || plan.reason || 'TRADE_PLAN_FAIL', {
      atrPct: atrPctDisplay,
      spreadPct,
      direction: direction === 'LONG' ? 'BUY' : 'SELL',
      rejectionReasons: plan.rejectionReasons
    });
  }

  return buildNoSignal('NO_BREAKOUT_RETEST_SETUP', { atrPct: atrPctDisplay, spreadPct });
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
