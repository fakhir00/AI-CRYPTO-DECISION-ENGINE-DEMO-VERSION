const MIN_SIGNAL_PRICE = 0.0000001;
const OUTPUT_MIN_VOLUME_RATIO = 1.2;
const OUTPUT_MAX_ENTRY_WIDTH_PCT = 0.20;
const OUTPUT_MIN_TP1_PCT = 0.5;
const OUTPUT_MIN_STOP_DISTANCE_PCT = 0.35;
const ALLOWED_STOP_REASONS = new Map([
  ['below swing low', 'below swing low'],
  ['below breakout candle', 'below breakout candle'],
  ['above swing high', 'above swing high'],
  ['above breakdown candle', 'above breakdown candle'],
  ['above breakout candle', 'above breakdown candle']
]);

export const SIGNAL_STATUSES = {
  ACTIVE: 'ACTIVE',
  TRIGGERED: 'TRIGGERED',
  INVALIDATED: 'INVALIDATED',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED'
};

export const SIGNAL_STRATEGY_PRESETS = {
  MOMENTUM_INTRADAY: {
    name: 'MOMENTUM_INTRADAY',
    timeframe: '15m',
    expiryCandles: 4,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    entryLogic: 'ANY_ENTRY_TOUCH',
    riskPerTradePct: 0.5,
    leverage: '3x Cross'
  },
  LEGACY_15M: {
    name: 'LEGACY_15M',
    timeframe: '15m',
    expiryCandles: 4,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    entryLogic: 'ANY_ENTRY_TOUCH',
    riskPerTradePct: 0.5,
    leverage: '3x Cross'
  }
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function normalizeDirection(direction = 'LONG') {
  const raw = String(direction || '').toUpperCase();
  return raw === 'SELL' || raw === 'SHORT' ? 'SHORT' : 'LONG';
}

export function timeframeToMinutes(timeframe = '15m') {
  const raw = String(timeframe || '15m').trim().toLowerCase();
  if (raw === 'scalp') return 15;
  const match = raw.match(/^(\d+(?:\.\d+)?)(m|h|d)$/);
  if (!match) return 15;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === 'h') return value * 60;
  if (unit === 'd') return value * 1440;
  return value;
}

export function normalizeTimeframe(timeframe = '15m') {
  const raw = String(timeframe || '15m').trim().toLowerCase();
  if (raw === 'scalp') return '15m';
  return raw;
}

export function formatUtcTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown UTC';
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
}

export function buildSignalId(symbol = 'BTC', direction = 'LONG', generatedAt = new Date()) {
  const cleanSymbol = String(symbol || 'BTC').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTC';
  const cleanDirection = normalizeDirection(direction);
  const date = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const yyyy = safeDate.getUTCFullYear();
  const mm = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(safeDate.getUTCDate()).padStart(2, '0');
  const hh = String(safeDate.getUTCHours()).padStart(2, '0');
  const min = String(safeDate.getUTCMinutes()).padStart(2, '0');
  const sec = String(safeDate.getUTCSeconds()).padStart(2, '0');
  return `${cleanSymbol}-${yyyy}${mm}${dd}-${hh}${min}${sec}-${cleanDirection}`;
}

export function formatLifecyclePrice(value, reference = 1) {
  const n = toNumber(value);
  if (n === null) return '0';
  const ref = Math.abs(toNumber(reference) ?? Math.abs(n));

  let decimals = 2;
  if (ref < 0.000001) decimals = 12;
  else if (ref < 0.0001) decimals = 10;
  else if (ref < 0.001) decimals = 8;
  else if (ref < 0.01) decimals = 7;
  else if (ref < 0.1) decimals = 6;
  else if (ref < 1) decimals = 5;
  else if (ref < 10) decimals = 4;
  else if (ref < 1000) decimals = 2;
  else decimals = 1;

  return n.toFixed(decimals).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatLifecycleEntryZonePrice(value, reference = 1) {
  const n = toNumber(value);
  if (n === null) return '0.00000';
  const ref = Math.abs(toNumber(reference) ?? Math.abs(n));

  let decimals = 2;
  if (ref < 0.000001) decimals = 12;
  else if (ref < 0.0001) decimals = 10;
  else if (ref < 0.001) decimals = 8;
  else if (ref < 0.01) decimals = 7;
  else if (ref < 0.1) decimals = 6;
  else if (ref < 1) decimals = 5;
  else if (ref < 10) decimals = 4;
  else if (ref < 1000) decimals = 2;
  else decimals = 2;

  return n.toFixed(decimals);
}

function buildLifecycleEntryZoneMeta(entryPrices = []) {
  const prices = (Array.isArray(entryPrices) ? entryPrices : [])
    .map(toNumber)
    .filter(price => price !== null && price > 0);
  if (prices.length !== 3) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (!(min > 0) || !(max >= min)) return null;
  return {
    min,
    max,
    widthPct: ((max - min) / min) * 100
  };
}

function normalizeEntries(direction, entries = []) {
  const side = normalizeDirection(direction);
  const clean = entries.map(toNumber).filter(n => n !== null && n > 0).slice(0, 3);
  return clean.sort((a, b) => side === 'SHORT' ? a - b : b - a);
}

function normalizeTargets(direction, targets = []) {
  const side = normalizeDirection(direction);
  const clean = targets.map(toNumber).filter(n => n !== null && n > 0).slice(0, 4);
  return clean.sort((a, b) => side === 'SHORT' ? b - a : a - b);
}

function avg(values = []) {
  const clean = values.map(toNumber).filter(n => n !== null);
  if (!clean.length) return 0;
  return clean.reduce((sum, n) => sum + n, 0) / clean.length;
}

export function normalizeSignalStopReason(reason = '') {
  const clean = String(reason || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ALLOWED_STOP_REASONS.get(clean) || null;
}

function parseVolumeRatio(volumeConfirmation = {}) {
  const direct = toNumber(volumeConfirmation?.ratio);
  if (direct !== null) return direct;
  const match = String(volumeConfirmation?.text || '').match(/([0-9.]+)\s*x\s*avg/i);
  return match ? toNumber(match[1]) : null;
}

function formatVolumeConfirmationText(volumeConfirmation = {}) {
  const ratio = parseVolumeRatio(volumeConfirmation);
  if (ratio === null || ratio < OUTPUT_MIN_VOLUME_RATIO) return null;
  return `${ratio.toFixed(2)}x avg`;
}

function pctDistanceFromEntry(avgEntry, value) {
  const entry = Number(avgEntry);
  const price = Number(value);
  if (!(entry > 0) || !(price > 0)) return null;
  return (Math.abs(price - entry) / entry) * 100;
}

function buildNoSignalLine(signal = {}, reason = 'SIGNAL_METADATA_MISSING') {
  return `NO_SIGNAL|${signal.timeframe || '15m'}|${signal.pair || `${signal.symbol || 'BTC'}/USDT`}|${new Date().toISOString()}|${reason}`;
}

function buildStatusHistory(status, at, reason) {
  return [{
    status,
    at: at.toISOString(),
    reason
  }];
}

export function createManagedSignal(options = {}) {
  const preset = SIGNAL_STRATEGY_PRESETS[options.strategyPreset || 'MOMENTUM_INTRADAY'] || SIGNAL_STRATEGY_PRESETS.MOMENTUM_INTRADAY;
  const symbol = String(options.symbol || 'BTC').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'BTC';
  const pair = String(options.pair || `${symbol}/USDT`).toUpperCase();
  const direction = normalizeDirection(options.direction);
  const timeframe = normalizeTimeframe(options.timeframe || preset.timeframe);
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date(options.generatedAt || Date.now());
  const safeGeneratedAt = Number.isFinite(generatedAt.getTime()) ? generatedAt : new Date();
  const expiryCandles = Math.max(1, Math.round(Number(options.expiryCandles || preset.expiryCandles) || preset.expiryCandles));
  const validMinutes = Number(options.validForMinutes) || (timeframeToMinutes(timeframe) * expiryCandles);
  const explicitValidUntil = options.validUntil ? new Date(options.validUntil) : null;
  const validUntil = explicitValidUntil && Number.isFinite(explicitValidUntil.getTime())
    ? explicitValidUntil
    : new Date(safeGeneratedAt.getTime() + (validMinutes * 60 * 1000));
  const entries = normalizeEntries(direction, options.entryLevels || options.entries || []);
  const targets = normalizeTargets(direction, options.targets || []);
  const stopLoss = Math.max(toNumber(options.stopLoss ?? options.stop) || MIN_SIGNAL_PRICE, MIN_SIGNAL_PRICE);
  const avgEntry = avg(entries);
  const tp2 = targets[1] ?? targets[0] ?? avgEntry;
  const stopDistancePct = Number.isFinite(Number(options.stopDistancePct))
    ? Number(options.stopDistancePct)
    : (avgEntry > 0 ? (Math.abs(avgEntry - stopLoss) / avgEntry) * 100 : 0);
  const rrToTp2 = Number.isFinite(Number(options.riskRewardToTp2))
    ? Number(options.riskRewardToTp2)
    : (Math.abs(avgEntry - stopLoss) > 0 ? Math.abs(tp2 - avgEntry) / Math.abs(avgEntry - stopLoss) : 0);
  const invalidationTimeframe = normalizeTimeframe(options.invalidationTimeframe || preset.invalidationTimeframe || timeframe);
  const invalidationMode = String(options.invalidationMode || preset.invalidationMode || 'BODY_CLOSE').toUpperCase();
  const invalidationOperator = direction === 'SHORT' ? 'above' : 'below';
  const invalidationPrice = Math.max(toNumber(options.invalidationPrice ?? stopLoss) || stopLoss, MIN_SIGNAL_PRICE);
  const reference = avgEntry || stopLoss || 1;

  const priceInvalidationText = `${invalidationTimeframe} candle ${invalidationMode === 'WICK_BREACH' ? 'wick breach' : 'BODY close'} ${invalidationOperator} ${formatLifecyclePrice(invalidationPrice, reference)}`;
  const timeInvalidationText = options.timeInvalidationText || `Cancel if entry not triggered within ${expiryCandles} x ${timeframe} candles`;
  const signalId = options.signalId || buildSignalId(symbol, direction, safeGeneratedAt);
  const status = Object.values(SIGNAL_STATUSES).includes(options.status) ? options.status : SIGNAL_STATUSES.ACTIVE;

  return {
    signalId,
    symbol,
    pair,
    generatedAt: safeGeneratedAt.toISOString(),
    generatedAtLabel: formatUtcTimestamp(safeGeneratedAt),
    validUntil: validUntil.toISOString(),
    validUntilLabel: formatUtcTimestamp(validUntil),
    keyLevel: options.keyLevel || options.strategySource || `Fibonacci Scanner (${direction === 'SHORT' ? 'Resistance' : 'Support'})`,
    strategy: {
      preset: preset.name,
      source: options.strategySource || options.keyLevel || 'Fibonacci Scanner',
      timeframe,
      entryLogic: options.entryLogic || preset.entryLogic,
      expiryCandles,
      duplicateWindowMinutes: Number(options.duplicateWindowMinutes) || 30,
      cooldownMinutes: Number(options.cooldownMinutes) || 30
    },
    direction,
    signalType: options.signalType || `Regular ${direction === 'SHORT' ? 'Short' : 'Long'}`,
    entryZone: {
      prices: entries,
      min: entries.length ? Math.min(...entries) : null,
      max: entries.length ? Math.max(...entries) : null,
      logic: options.entryLogic || preset.entryLogic
    },
    takeProfitTargets: targets,
    stopLoss,
    leverage: options.leverage || preset.leverage,
    riskPerTradePct: Number.isFinite(Number(options.riskPerTradePct)) ? Number(options.riskPerTradePct) : preset.riskPerTradePct,
    stopDistancePct,
    riskRewardToTp2: rrToTp2,
    priceInvalidation: {
      timeframe: invalidationTimeframe,
      mode: invalidationMode,
      operator: invalidationOperator,
      price: invalidationPrice,
      text: priceInvalidationText
    },
    timeInvalidation: {
      timeframe,
      expiryCandles,
      validUntil: validUntil.toISOString(),
      text: timeInvalidationText
    },
    entryZoneWidthPct: Number.isFinite(Number(options.entryZoneWidthPct)) ? Number(options.entryZoneWidthPct) : null,
    stopReason: options.stopReason || null,
    volumeConfirmation: options.volumeConfirmation || null,
    status,
    confidence: Number.isFinite(Number(options.confidence)) ? clamp(Number(options.confidence), 0, 100) : null,
    source: options.source || 'scanner',
    events: Array.isArray(options.events) ? options.events : [{
      type: 'SIGNAL_CREATED',
      at: safeGeneratedAt.toISOString(),
      status,
      price: null
    }],
    statusHistory: Array.isArray(options.statusHistory)
      ? options.statusHistory
      : buildStatusHistory(status, safeGeneratedAt, 'SIGNAL_CREATED'),
    hitTargets: Array.isArray(options.hitTargets) ? options.hitTargets : []
  };
}

function addLifecycleEvent(signal, type, at, price = null, details = {}) {
  const event = {
    type,
    at: at.toISOString(),
    status: signal.status,
    price,
    ...details
  };
  signal.events = Array.isArray(signal.events) ? [...signal.events, event] : [event];
}

function transitionSignal(signal, status, at, reason, price = null, details = {}) {
  if (signal.status === status) return;
  signal.status = status;
  signal.statusHistory = Array.isArray(signal.statusHistory) ? signal.statusHistory : [];
  signal.statusHistory.push({
    status,
    at: at.toISOString(),
    reason
  });
  addLifecycleEvent(signal, reason, at, price, details);
}

function getMarketRange(market = {}) {
  const candle = market.candle || {};
  const high = toNumber(candle.high) ?? toNumber(market.high) ?? toNumber(market.price);
  const low = toNumber(candle.low) ?? toNumber(market.low) ?? toNumber(market.price);
  const close = toNumber(candle.close) ?? toNumber(market.close) ?? (market.priceAsClose ? toNumber(market.price) : null);
  return { high, low, close };
}

function priceTouched(price, low, high) {
  if (!(price > 0)) return false;
  if (low !== null && high !== null) return low <= price && high >= price;
  if (high !== null) return high === price;
  return false;
}

function invalidationHit(signal, market = {}) {
  const side = normalizeDirection(signal.direction);
  const rule = signal.priceInvalidation || {};
  const range = getMarketRange(market);
  const price = Number(rule.price);
  if (!(price > 0)) return false;

  if (String(rule.mode || '').toUpperCase() === 'WICK_BREACH') {
    if (side === 'SHORT') return range.high !== null && range.high >= price;
    return range.low !== null && range.low <= price;
  }

  if (side === 'SHORT') return range.close !== null && range.close > price;
  return range.close !== null && range.close < price;
}

export function updateSignalLifecycle(inputSignal = {}, market = {}) {
  const signal = JSON.parse(JSON.stringify(inputSignal || {}));
  const now = market.now instanceof Date ? market.now : new Date(market.now || Date.now());
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const finalStatuses = new Set([SIGNAL_STATUSES.INVALIDATED, SIGNAL_STATUSES.EXPIRED, SIGNAL_STATUSES.COMPLETED]);
  if (finalStatuses.has(signal.status)) return signal;

  const range = getMarketRange(market);
  const generatedAt = new Date(signal.generatedAt || Date.now());
  const validUntil = new Date(signal.validUntil || Date.now());
  const elapsedMinutes = Math.max(0, (safeNow.getTime() - generatedAt.getTime()) / 60000);
  const candleMinutes = timeframeToMinutes(signal.timeInvalidation?.timeframe || signal.strategy?.timeframe || '15m');
  signal.elapsedCandles = Math.floor(elapsedMinutes / candleMinutes);

  if (signal.status === SIGNAL_STATUSES.ACTIVE && Number.isFinite(validUntil.getTime()) && safeNow > validUntil) {
    transitionSignal(signal, SIGNAL_STATUSES.EXPIRED, safeNow, 'TIME_INVALIDATION_EXPIRED', range.close);
    signal.expiredAt = safeNow.toISOString();
    return signal;
  }

  if (signal.status === SIGNAL_STATUSES.ACTIVE && invalidationHit(signal, market)) {
    transitionSignal(signal, SIGNAL_STATUSES.INVALIDATED, safeNow, 'PRICE_INVALIDATION_HIT', range.close);
    signal.invalidatedAt = safeNow.toISOString();
    return signal;
  }

  const entryPrices = signal.entryZone?.prices || [];
  if (signal.status === SIGNAL_STATUSES.ACTIVE) {
    const touchedEntry = entryPrices.find(entry => priceTouched(Number(entry), range.low, range.high));
    if (touchedEntry) {
      transitionSignal(signal, SIGNAL_STATUSES.TRIGGERED, safeNow, 'ENTRY_TOUCHED', touchedEntry, { entryPrice: touchedEntry });
      signal.triggeredAt = safeNow.toISOString();
      signal.triggerPrice = touchedEntry;
    }
  }

  if (signal.status !== SIGNAL_STATUSES.TRIGGERED) return signal;

  const side = normalizeDirection(signal.direction);
  const stop = Number(signal.stopLoss);
  const targets = signal.takeProfitTargets || [];
  const hitTargets = new Set(signal.hitTargets || []);

  targets.forEach((target, index) => {
    const targetNum = Number(target);
    const hit = side === 'SHORT'
      ? range.low !== null && range.low <= targetNum
      : range.high !== null && range.high >= targetNum;
    if (hit && !hitTargets.has(index + 1)) {
      hitTargets.add(index + 1);
      addLifecycleEvent(signal, `TP${index + 1}_HIT`, safeNow, targetNum, { targetIndex: index + 1 });
    }
  });
  signal.hitTargets = [...hitTargets].sort((a, b) => a - b);

  const stopHit = side === 'SHORT'
    ? range.high !== null && range.high >= stop
    : range.low !== null && range.low <= stop;
  if (stopHit) {
    transitionSignal(signal, SIGNAL_STATUSES.COMPLETED, safeNow, 'STOP_LOSS_HIT', stop);
    signal.completedAt = safeNow.toISOString();
    signal.completedBy = 'SL';
    return signal;
  }

  if (hitTargets.has(4)) {
    transitionSignal(signal, SIGNAL_STATUSES.COMPLETED, safeNow, 'TAKE_PROFIT_4_HIT', Number(targets[3]));
    signal.completedAt = safeNow.toISOString();
    signal.completedBy = 'TP4';
  }

  return signal;
}

export function formatManagedSignalText(signal = {}) {
  const reference = avg(signal.entryZone?.prices || []) || Number(signal.stopLoss) || 1;
  const entryMeta = buildLifecycleEntryZoneMeta(signal.entryZone?.prices || []);
  const targets = (signal.takeProfitTargets || []).map(price => formatLifecyclePrice(price, reference));
  const stop = formatLifecyclePrice(signal.stopLoss, reference);
  const rr = Number(signal.riskRewardToTp2 || 0);
  const volumeText = formatVolumeConfirmationText(signal.volumeConfirmation);
  const stopReason = normalizeSignalStopReason(signal.stopReason);
  const entryWidth = Number(signal.entryZoneWidthPct ?? signal.entryZone?.widthPct ?? entryMeta?.widthPct);
  const avgEntry = avg(signal.entryZone?.prices || []);
  const tp1Pct = pctDistanceFromEntry(avgEntry, signal.takeProfitTargets?.[0]);
  const stopDistancePct = Number(signal.stopDistancePct);
  const requiredTextFields = [
    signal.signalId,
    signal.generatedAt,
    signal.validUntil,
    signal.keyLevel,
    signal.signalType,
    signal.leverage,
    signal.priceInvalidation?.text,
    signal.timeInvalidation?.text
  ];

  if (
    !entryMeta
    || !volumeText
    || !stopReason
    || !Number.isFinite(entryWidth)
    || entryWidth > OUTPUT_MAX_ENTRY_WIDTH_PCT
    || !Number.isFinite(tp1Pct)
    || tp1Pct < OUTPUT_MIN_TP1_PCT
    || !Number.isFinite(stopDistancePct)
    || stopDistancePct < OUTPUT_MIN_STOP_DISTANCE_PCT
    || !Number.isFinite(rr)
    || rr <= 0
    || targets.length < 4
    || targets.slice(0, 4).some(target => !target || target === '0')
    || !stop
    || stop === '0'
    || requiredTextFields.some(value => {
      const clean = String(value || '').trim();
      return !clean || /^N\/A$/i.test(clean) || /^UNKNOWN$/i.test(clean);
    })
  ) {
    return buildNoSignalLine(signal);
  }

  return `#${signal.pair || `${signal.symbol || 'BTC'}/USDT`}

Signal ID: ${signal.signalId}
Generated: ${signal.generatedAtLabel || formatUtcTimestamp(signal.generatedAt)}
Valid Until: ${signal.validUntilLabel || formatUtcTimestamp(signal.validUntil)}

Key Level: ${signal.keyLevel || 'Fibonacci Scanner'}

Signal Type: ${signal.signalType || `Regular ${normalizeDirection(signal.direction) === 'SHORT' ? 'Short' : 'Long'}`}

Entry Zone:
${formatLifecycleEntryZonePrice(entryMeta.min, reference)} - ${formatLifecycleEntryZonePrice(entryMeta.max, reference)}

ENTRY WIDTH: ${entryWidth.toFixed(2)}%

Take-Profit Targets:
1) ${targets[0] || '0'}
2) ${targets[1] || '0'}
3) ${targets[2] || '0'}
4) ${targets[3] || '0'}

Stop Loss:
${stop}

Price Invalidation:
${signal.priceInvalidation?.text || `${signal.priceInvalidation?.timeframe || '15m'} candle BODY close ${normalizeDirection(signal.direction) === 'SHORT' ? 'above' : 'below'} ${stop}`}

Time Invalidation:
${signal.timeInvalidation?.text || 'Cancel if entry is not triggered before expiry'}

Leverage:
${signal.leverage || '3x Cross'}

Risk Per Trade:
${Number(signal.riskPerTradePct || 0.5).toFixed(2)}%

Stop Distance:
${Number(signal.stopDistancePct || 0).toFixed(2)}%

Risk-Reward:
1:${rr.toFixed(2)} to TP2

VOLUME: ${volumeText}

STOP REASON: ${stopReason}

Status:
${signal.status || SIGNAL_STATUSES.ACTIVE}`;
}
