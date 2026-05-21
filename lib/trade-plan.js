const MIN_PRICE = 0.0000001;

export const TRADE_PLAN_DEFAULTS = {
  maxStopDistancePct: 1.85,
  minRrToTp2: 1.5,
  positionRiskPct: 0.5
};

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function avg(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

function pctDistance(a, b) {
  const base = Math.max(Math.abs(Number(a)) || 0, MIN_PRICE);
  return (Math.abs(Number(a) - Number(b)) / base) * 100;
}

function directionalSort(levels = [], direction = 'BUY') {
  const clean = levels.map(Number).filter(v => Number.isFinite(v) && v > 0);
  return direction === 'BUY'
    ? clean.sort((a, b) => a - b)
    : clean.sort((a, b) => b - a);
}

function dedupeByGap(levels = [], minGapPct = 0.12) {
  const sorted = directionalSort(levels, 'BUY');
  const clusters = [];

  for (const level of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last) {
      clusters.push([level]);
      continue;
    }

    const center = avg(last);
    if (pctDistance(center, level) <= minGapPct) {
      last.push(level);
    } else {
      clusters.push([level]);
    }
  }

  return clusters.map(cluster => avg(cluster));
}

function addWindowExtreme(series, size, highCandidates, lowCandidates) {
  if (series.length < Math.max(4, size / 2)) return;
  const window = series.slice(-size);
  highCandidates.push(Math.max(...window.map(c => c.high)));
  lowCandidates.push(Math.min(...window.map(c => c.low)));
}

export function formatPlanNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n >= 1000 ? n.toFixed(2) : n.toFixed(4);
}

function normalizeCandleSeries(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map(c => ({
      open: Number(c?.open),
      high: Number(c?.high),
      low: Number(c?.low),
      close: Number(c?.close),
      volume: Number(c?.volume) || 0
    }))
    .filter(c => [c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low && c.close > 0);
}

export function computeEntryZoneMeta(entryLevels = []) {
  const prices = (Array.isArray(entryLevels) ? entryLevels : [])
    .map(Number)
    .filter(v => Number.isFinite(v) && v > 0);
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

export function computeBreakoutVolumeConfirmation(candles = [], breakoutIndex = null, period = 20) {
  const series = normalizeCandleSeries(candles);
  const index = Number.isInteger(breakoutIndex) ? breakoutIndex : series.length - 2;
  const safePeriod = Math.max(1, Number(period) || 20);
  if (index < safePeriod - 1 || index >= series.length) return null;

  const breakoutCandle = series[index];
  const window = series.slice(index - safePeriod + 1, index + 1);
  if (window.length !== safePeriod) return null;

  const averageVolume = avg(window.map(c => c.volume));
  const volume = Number(breakoutCandle?.volume);
  if (!(volume > 0) || !(averageVolume > 0)) return null;

  const ratio = volume / averageVolume;
  return {
    ratio,
    text: `${ratio.toFixed(2)}x avg`,
    volume,
    averageVolume,
    candleIndex: index
  };
}

export function classifyStructuralStopReason(candles = [], direction = 'BUY', stopPrice = null, breakoutIndex = null, lookback = 12) {
  const series = normalizeCandleSeries(candles);
  const index = Number.isInteger(breakoutIndex) ? breakoutIndex : series.length - 2;
  const safeLookback = Math.max(1, Number(lookback) || 12);
  const stop = Number(stopPrice);
  if (!(stop > 0) || index < 0 || index >= series.length || series.length < safeLookback) return null;

  const window = series.slice(Math.max(0, series.length - safeLookback));
  if (window.length < safeLookback) return null;

  const breakoutCandle = series[index];
  const side = String(direction).toUpperCase() === 'SELL' || String(direction).toUpperCase() === 'SHORT'
    ? 'SHORT'
    : 'LONG';

  if (side === 'SHORT') {
    const swingHigh = Math.max(...window.map(c => c.high));
    const breakoutHigh = Number(breakoutCandle?.high);
    const candidates = [
      Number.isFinite(swingHigh) && stop > swingHigh ? { reason: 'above swing high', distance: stop - swingHigh } : null,
      Number.isFinite(breakoutHigh) && stop > breakoutHigh ? { reason: 'above breakdown candle', distance: stop - breakoutHigh } : null
    ].filter(Boolean);
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.distance - b.distance);
    return {
      reason: candidates[0].reason,
      swingHigh,
      breakoutCandleHigh: breakoutHigh,
      candleIndex: index
    };
  }

  const swingLow = Math.min(...window.map(c => c.low));
  const breakoutLow = Number(breakoutCandle?.low);
  const candidates = [
    Number.isFinite(swingLow) && stop < swingLow ? { reason: 'below swing low', distance: swingLow - stop } : null,
    Number.isFinite(breakoutLow) && stop < breakoutLow ? { reason: 'below breakout candle', distance: breakoutLow - stop } : null
  ].filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return {
    reason: candidates[0].reason,
    swingLow,
    breakoutCandleLow: breakoutLow,
    candleIndex: index
  };
}

export function buildLocalStructureLevels(candles = [], referencePrice = 0, atrPct = 0) {
  const series = normalizeCandleSeries(candles).slice(-120);

  const price = Number(referencePrice) || Number(series[series.length - 1]?.close) || 0;
  if (!series.length || !(price > 0)) {
    return {
      supports: [],
      resistances: [],
      nearestSupport: null,
      nearestResistance: null,
      swingHigh: null,
      swingLow: null,
      minGapPct: 0.12
    };
  }

  const highCandidates = [];
  const lowCandidates = [];
  const pivotRadius = series.length >= 70 ? 3 : 2;

  for (let i = pivotRadius; i < series.length - pivotRadius; i++) {
    const current = series[i];
    let pivotHigh = true;
    let pivotLow = true;

    for (let j = 1; j <= pivotRadius; j++) {
      if (!(current.high >= series[i - j].high && current.high > series[i + j].high)) pivotHigh = false;
      if (!(current.low <= series[i - j].low && current.low < series[i + j].low)) pivotLow = false;
      if (!pivotHigh && !pivotLow) break;
    }

    if (pivotHigh) highCandidates.push(current.high);
    if (pivotLow) lowCandidates.push(current.low);
  }

  const recent = series.slice(-18);
  recent.forEach((c) => {
    highCandidates.push(c.high);
    lowCandidates.push(c.low);
  });

  [12, 24, 48, 80, 120].forEach(size => addWindowExtreme(series, size, highCandidates, lowCandidates));

  const minGapPct = clamp(Math.max(0.1, (Number(atrPct) || 0) * 0.24), 0.1, 0.42);
  const highs = dedupeByGap(highCandidates, minGapPct);
  const lows = dedupeByGap(lowCandidates, minGapPct);

  const supports = lows
    .filter(level => level < price)
    .sort((a, b) => b - a)
    .slice(0, 10);

  const resistances = highs
    .filter(level => level > price)
    .sort((a, b) => a - b)
    .slice(0, 10);

  return {
    supports,
    resistances,
    nearestSupport: supports[0] ?? null,
    nearestResistance: resistances[0] ?? null,
    swingHigh: Math.max(...series.map(c => c.high)),
    swingLow: Math.min(...series.map(c => c.low)),
    minGapPct
  };
}

function findClosestDirectionalLevel(levels = [], anchor = 0, direction = 'BUY') {
  const sorted = directionalSort(levels, direction);
  if (direction === 'BUY') return sorted.find(level => level > anchor) ?? null;
  return sorted.find(level => level < anchor) ?? null;
}

function frontRunLevel(level, direction, referencePrice, bufferPct) {
  const buffer = Math.max(referencePrice * (bufferPct / 100), MIN_PRICE);
  return direction === 'BUY'
    ? Math.max(MIN_PRICE, level - buffer)
    : Math.max(MIN_PRICE, level + buffer);
}

function getEntryArray(entries = {}) {
  return [entries.entry1, entries.entry2, entries.entry3]
    .map(Number)
    .filter(v => Number.isFinite(v) && v > 0);
}

function priceOrderGap(referencePrice, atrPct) {
  const gapPct = clamp(Math.max((Number(atrPct) || 0) * 0.12, 0.05), 0.05, 0.2);
  return Math.max((Number(referencePrice) || MIN_PRICE) * (gapPct / 100), MIN_PRICE);
}

function enforceStopPriceOrder(direction, entries, sl, avgEntry, atrPct, stopBasis = 'ATR_INVALIDATION') {
  const entryPrices = getEntryArray(entries);
  if (entryPrices.length !== 3) return { sl, stopBasis };

  const gap = priceOrderGap(avgEntry, atrPct);
  const minEntry = Math.min(...entryPrices);
  const maxEntry = Math.max(...entryPrices);

  if (direction === 'BUY' && sl >= minEntry) {
    return {
      sl: Math.max(MIN_PRICE, minEntry - gap),
      stopBasis: `${stopBasis}_PRICE_ORDER`
    };
  }

  if (direction === 'SELL' && sl <= maxEntry) {
    return {
      sl: maxEntry + gap,
      stopBasis: `${stopBasis}_PRICE_ORDER`
    };
  }

  return { sl, stopBasis };
}

function enforceTargetPriceOrder(direction, entries, targets = [], avgEntry, atrPct, targetBasis = []) {
  const entryPrices = getEntryArray(entries);
  const cleanTargets = targets.map(Number).filter(v => Number.isFinite(v) && v > 0);
  if (entryPrices.length !== 3 || cleanTargets.length !== 4) {
    return { targets, targetBasis, adjusted: false };
  }

  const gap = priceOrderGap(avgEntry, atrPct);
  const minEntry = Math.min(...entryPrices);
  const maxEntry = Math.max(...entryPrices);
  const orderedTargets = directionalSort(cleanTargets, direction);
  let adjusted = false;

  const finalTargets = [];
  if (direction === 'BUY') {
    let floor = maxEntry + gap;
    for (const target of orderedTargets) {
      const finalTarget = Math.max(target, floor);
      if (Math.abs(finalTarget - target) > MIN_PRICE) adjusted = true;
      finalTargets.push(finalTarget);
      floor = finalTarget + gap;
    }
  } else {
    let ceiling = minEntry - gap;
    for (const target of orderedTargets) {
      const finalTarget = Math.max(MIN_PRICE, Math.min(target, ceiling));
      if (Math.abs(finalTarget - target) > MIN_PRICE) adjusted = true;
      finalTargets.push(finalTarget);
      ceiling = finalTarget - gap;
    }
  }

  return {
    targets: finalTargets,
    targetBasis: adjusted ? targetBasis.map(basis => `${basis}_PRICE_ORDER`) : targetBasis,
    adjusted
  };
}

export function validateTradePlanPriceOrder(direction = 'BUY', plan = {}) {
  const cleanDirection = direction === 'SELL' ? 'SELL' : 'BUY';
  const entries = [plan.entry1, plan.entry2, plan.entry3].map(Number);
  const targets = [plan.tp1, plan.tp2, plan.tp3, plan.tp4].map(Number);
  const sl = Number(plan.sl);

  if (![...entries, ...targets, sl].every(v => Number.isFinite(v) && v > 0)) {
    return false;
  }

  const minEntry = Math.min(...entries);
  const maxEntry = Math.max(...entries);

  if (cleanDirection === 'BUY') {
    const targetsAscending = targets.every((target, index) => index === 0 || target > targets[index - 1]);
    return sl < minEntry && maxEntry < Math.min(...targets) && targetsAscending;
  }

  const targetsDescending = targets.every((target, index) => index === 0 || target < targets[index - 1]);
  return Math.max(...targets) < minEntry && maxEntry < sl && targetsDescending;
}

function buildEntryLadder(direction, entryBase, atrPct, localLevels) {
  const entryStepPct = clamp((Number(atrPct) || 0) * 0.16, 0.07, 0.24);
  const maxEntryDepthPct = clamp((Number(atrPct) || 0) * 0.95, 0.32, 1.15);
  const frontRunPct = clamp((Number(atrPct) || 0) * 0.14, 0.04, 0.18);
  const step = entryBase * (entryStepPct / 100);

  let entry1 = direction === 'SELL'
    ? entryBase + (step * 2)
    : Math.max(MIN_PRICE, entryBase - (step * 2));
  let entry2 = direction === 'SELL'
    ? entryBase + step
    : Math.max(MIN_PRICE, entryBase - step);
  const entry3 = entryBase;

  if (direction === 'BUY') {
    const support = findClosestDirectionalLevel(localLevels?.supports || [], entryBase, 'SELL');
    const supportDistancePct = support ? pctDistance(entryBase, support) : Infinity;
    if (support && supportDistancePct >= entryStepPct * 1.35 && supportDistancePct <= maxEntryDepthPct) {
      entry1 = clamp(support + (entryBase * (frontRunPct / 100)), entryBase * (1 - maxEntryDepthPct / 100), entryBase);
      entry2 = (entry1 + entry3) / 2;
    }
  } else {
    const resistance = findClosestDirectionalLevel(localLevels?.resistances || [], entryBase, 'BUY');
    const resistanceDistancePct = resistance ? pctDistance(entryBase, resistance) : Infinity;
    if (resistance && resistanceDistancePct >= entryStepPct * 1.35 && resistanceDistancePct <= maxEntryDepthPct) {
      entry1 = clamp(resistance - (entryBase * (frontRunPct / 100)), entryBase, entryBase * (1 + maxEntryDepthPct / 100));
      entry2 = (entry1 + entry3) / 2;
    }
  }

  return { entry1, entry2, entry3 };
}

function buildStop(direction, avgEntry, atrPct, localLevels, maxStopDistancePct) {
  const stopBufferPct = clamp((Number(atrPct) || 0) * 0.24, 0.06, 0.28);
  const minStopPct = clamp((Number(atrPct) || 0) * 0.72, 0.32, 0.82);
  const fallbackStopPct = clamp((Number(atrPct) || 0) * 1.08, 0.42, maxStopDistancePct);
  const maxStopPct = clamp(Math.max(fallbackStopPct, minStopPct), 0.5, maxStopDistancePct);
  let stopBasis = 'ATR_INVALIDATION';

  let sl = direction === 'BUY'
    ? avgEntry * (1 - fallbackStopPct / 100)
    : avgEntry * (1 + fallbackStopPct / 100);

  if (direction === 'BUY') {
    const support = findClosestDirectionalLevel(localLevels?.supports || [], avgEntry, 'SELL');
    if (support) {
      const structureStop = support * (1 - stopBufferPct / 100);
      const structureRiskPct = pctDistance(avgEntry, structureStop);
      if (structureRiskPct <= maxStopDistancePct) {
        sl = structureStop;
        stopBasis = 'LOCAL_SUPPORT_BUFFER';
      }
    }

    const riskPct = pctDistance(avgEntry, sl);
    if (riskPct < minStopPct) {
      sl = avgEntry * (1 - minStopPct / 100);
      stopBasis = `${stopBasis}_MIN_ATR`;
    }
    if (pctDistance(avgEntry, sl) > maxStopPct) {
      sl = avgEntry * (1 - maxStopPct / 100);
      stopBasis = 'CAPPED_ATR_STOP';
    }
  } else {
    const resistance = findClosestDirectionalLevel(localLevels?.resistances || [], avgEntry, 'BUY');
    if (resistance) {
      const structureStop = resistance * (1 + stopBufferPct / 100);
      const structureRiskPct = pctDistance(avgEntry, structureStop);
      if (structureRiskPct <= maxStopDistancePct) {
        sl = structureStop;
        stopBasis = 'LOCAL_RESISTANCE_BUFFER';
      }
    }

    const riskPct = pctDistance(avgEntry, sl);
    if (riskPct < minStopPct) {
      sl = avgEntry * (1 + minStopPct / 100);
      stopBasis = `${stopBasis}_MIN_ATR`;
    }
    if (pctDistance(avgEntry, sl) > maxStopPct) {
      sl = avgEntry * (1 + maxStopPct / 100);
      stopBasis = 'CAPPED_ATR_STOP';
    }
  }

  return { sl: Math.max(MIN_PRICE, sl), stopBasis };
}

function buildTargetCandidates(direction, avgEntry, risk, atrPct, localLevels) {
  const targetBufferPct = clamp((Number(atrPct) || 0) * 0.2, 0.05, 0.24);
  const rrMultiples = [0.82, 1.55, 2.25, 3.05];
  const candidates = [];
  const opposingLevels = direction === 'BUY'
    ? directionalSort(localLevels?.resistances || [], 'BUY').filter(level => level > avgEntry)
    : directionalSort(localLevels?.supports || [], 'SELL').filter(level => level < avgEntry);

  for (const level of opposingLevels) {
    const target = frontRunLevel(level, direction, avgEntry, targetBufferPct);
    if (direction === 'BUY' && target <= avgEntry) continue;
    if (direction === 'SELL' && target >= avgEntry) continue;
    const reward = Math.abs(target - avgEntry);
    if (reward <= 0) continue;
    candidates.push({
      price: target,
      rr: reward / risk,
      basis: direction === 'BUY' ? 'FRONTRUN_RESISTANCE' : 'FRONTRUN_SUPPORT',
      level
    });
  }

  for (const rr of rrMultiples) {
    let target = direction === 'BUY'
      ? avgEntry + (risk * rr)
      : Math.max(MIN_PRICE, avgEntry - (risk * rr));

    const nearby = opposingLevels.find(level => pctDistance(target, level) <= targetBufferPct * 1.35);
    if (nearby) {
      const adjusted = frontRunLevel(nearby, direction, avgEntry, targetBufferPct);
      if (
        (direction === 'BUY' && adjusted > avgEntry)
        || (direction === 'SELL' && adjusted < avgEntry)
      ) {
        target = direction === 'BUY' ? Math.min(target, adjusted) : Math.max(target, adjusted);
      }
    }

    candidates.push({
      price: target,
      rr,
      basis: `MEASURED_${rr.toFixed(2)}R`,
      level: null
    });
  }

  return directionalSort(candidates.map(c => c.price), direction)
    .map(price => candidates.find(c => Math.abs(c.price - price) <= MIN_PRICE * 2))
    .filter(Boolean);
}

function selectTargets(direction, avgEntry, risk, atrPct, localLevels, minRrToTp2) {
  const minGapPct = clamp(Math.max((Number(atrPct) || 0) * 0.34, 0.14), 0.14, 0.62);
  const minGap = avgEntry * (minGapPct / 100);
  const slotMinimumRr = [
    0.42,
    Math.max(1.15, Number(minRrToTp2) || TRADE_PLAN_DEFAULTS.minRrToTp2),
    Math.max(1.75, (Number(minRrToTp2) || TRADE_PLAN_DEFAULTS.minRrToTp2) + 0.45),
    Math.max(2.35, (Number(minRrToTp2) || TRADE_PLAN_DEFAULTS.minRrToTp2) + 0.95)
  ];

  const candidates = buildTargetCandidates(direction, avgEntry, risk, atrPct, localLevels);
  const targets = [];
  const targetBasis = [];

  for (let slot = 0; slot < 4; slot++) {
    const previous = targets[targets.length - 1];
    const minRr = slotMinimumRr[slot];
    const candidate = candidates.find((item) => {
      if (item.rr < minRr) return false;
      if (!previous) return true;
      return direction === 'BUY'
        ? item.price >= previous + minGap
        : item.price <= previous - minGap;
    });

    if (candidate) {
      targets.push(candidate.price);
      targetBasis.push(candidate.basis);
      continue;
    }

    const rr = slot === 0 ? 0.82 : slotMinimumRr[slot];
    const fallback = direction === 'BUY'
      ? avgEntry + (risk * rr)
      : Math.max(MIN_PRICE, avgEntry - (risk * rr));

    const enforced = previous
      ? direction === 'BUY'
        ? Math.max(fallback, previous + minGap)
        : Math.min(fallback, previous - minGap)
      : fallback;

    const finalTarget = Math.max(MIN_PRICE, enforced);
    targets.push(finalTarget);
    const actualRr = Math.abs(finalTarget - avgEntry) / risk;
    targetBasis.push(`MEASURED_${actualRr.toFixed(2)}R`);
  }

  return { targets, targetBasis };
}

export function computeStructureAwareTradePlan(
  symbol = 'BTC',
  direction = 'BUY',
  entry = 0,
  atrPct = 0,
  snapshot = null,
  options = {}
) {
  const entryBase = Math.max(Number(entry) || 0, MIN_PRICE);
  const cleanDirection = direction === 'SELL' ? 'SELL' : 'BUY';
  const maxStopDistancePct = Number(options.maxStopDistancePct) || TRADE_PLAN_DEFAULTS.maxStopDistancePct;
  const minRrToTp2 = Number(options.minRrToTp2) || TRADE_PLAN_DEFAULTS.minRrToTp2;
  const localLevels = snapshot?.structureLevels || buildLocalStructureLevels(snapshot?.candles || [], entryBase, atrPct);
  const entries = buildEntryLadder(cleanDirection, entryBase, atrPct, localLevels);
  const avgEntry = (entries.entry1 + entries.entry2 + entries.entry3) / 3;
  const rawStop = buildStop(cleanDirection, avgEntry, atrPct, localLevels, maxStopDistancePct);
  const stop = enforceStopPriceOrder(cleanDirection, entries, rawStop.sl, avgEntry, atrPct, rawStop.stopBasis);
  const risk = Math.max(Math.abs(avgEntry - stop.sl), avgEntry * 0.001);
  const riskPct = (risk / avgEntry) * 100;
  const targetMeta = selectTargets(cleanDirection, avgEntry, risk, atrPct, localLevels, minRrToTp2);
  const orderedTargets = enforceTargetPriceOrder(
    cleanDirection,
    entries,
    targetMeta.targets,
    avgEntry,
    atrPct,
    targetMeta.targetBasis
  );
  const [tp1, tp2, tp3, tp4] = orderedTargets.targets;

  let leverage = '4X-6X';
  if (riskPct > 1.15 || Number(atrPct) > 1.0) leverage = '2X-3X';
  else if (riskPct > 0.75 || Number(atrPct) > 0.55) leverage = '3X-5X';

  const invalidation = cleanDirection === 'BUY'
    ? `15m close below ${formatPlanNumber(stop.sl)}`
    : `15m close above ${formatPlanNumber(stop.sl)}`;

  return {
    symbol,
    entry1: entries.entry1,
    entry2: entries.entry2,
    entry3: entries.entry3,
    avgEntry,
    tp1,
    tp2,
    tp3,
    tp4,
    sl: stop.sl,
    leverage,
    riskPct,
    positionRiskPct: Number(options.positionRiskPct) || TRADE_PLAN_DEFAULTS.positionRiskPct,
    invalidation,
    stopBasis: stop.stopBasis,
    targetBasis: orderedTargets.targetBasis,
    localSupport: localLevels?.nearestSupport ?? null,
    localResistance: localLevels?.nearestResistance ?? null,
    structureLevels: localLevels,
    priceOrder: cleanDirection === 'BUY'
      ? 'STOP_BELOW_BUY_ENTRIES_BELOW_SELL_TARGETS'
      : 'BUY_TARGETS_BELOW_SELL_ENTRIES_BELOW_STOP',
    priceOrderValid: validateTradePlanPriceOrder(cleanDirection, {
      entry1: entries.entry1,
      entry2: entries.entry2,
      entry3: entries.entry3,
      tp1,
      tp2,
      tp3,
      tp4,
      sl: stop.sl
    })
  };
}
