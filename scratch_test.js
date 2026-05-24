import { createManagedSignal, formatManagedSignalText } from './lib/signal-lifecycle.js';

const userQuery = `Generate a momentum intraday swing trade plan for APT/USDT. Use these mandatory algorithmic values exactly: direction=SELL, entryZone="0.94300 - 0.94399", entryWidth="0.11%", tp1=0.9392428841182607, tp2=0.9318258649586424, tp3=0.9276764836106042, tp4=0.9114407574125133, sl=0.9486827266850478, leverage=3X-5X, alpha=71, setupType=BREAKDOWN_RETEST, riskPct=0.55, positionRiskPct=0.5, rrToTp2=2.25, STOP REASON="above swing high", VOLUME="3.18x avg", invalidation="15m close above 0.9487", line="SIGNAL|MOMENTUM|APT/USDT|SELL|0.9440|0.9435|0.9430|0.9392|0.9318|0.9277|0.9114|0.9487|3X-5X|THREE_BLACK_CROWS|2026-05-24T14:21:49.673Z|71". Do not alter these numbers.`;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function buildUserQueryDrivenTradePlan(userQuery = '', symbol = 'BTC') {
  if (!/direction=/i.test(userQuery) && !/line=/i.test(userQuery)) {
    console.log("Failed pre-check");
    return null;
  }

  const parseVal = (key) => {
    const m = userQuery.match(new RegExp(`\\b${key}\\s*[:=]\\s*["']?([^"'\n,;]+)["']?`, 'i'));
    return m ? m[1].trim() : null;
  };

  const rawDir = parseVal('direction') || '';
  const direction = /sell|short/i.test(rawDir) || /sell/i.test(userQuery) ? 'SHORT' : 'LONG';

  let entries = [];
  const line = parseVal('line');
  if (line) {
    const parts = line.split('|');
    if (parts.length >= 12) {
      entries = [Number(parts[4]), Number(parts[5]), Number(parts[6])];
    }
  }

  if (entries.length !== 3 || entries.some(isNaN)) {
    const entryZone = parseVal('entryZone') || '';
    const zoneParts = entryZone.split('-').map(p => Number(p.replace(/,/g, '').trim()));
    if (zoneParts.length === 2 && !zoneParts.some(isNaN)) {
      entries = [zoneParts[1], (zoneParts[0] + zoneParts[1]) / 2, zoneParts[0]];
    } else {
      entries = [76809.31, 76779.56, 76749.80];
    }
  }

  const tp1 = Number(parseVal('tp1') || 76578.09);
  const tp2 = Number(parseVal('tp2') || 76226.74);
  const tp3 = Number(parseVal('tp3') || 76030.19);
  const tp4 = Number(parseVal('tp4') || 75698.39);
  const sl = Number(parseVal('sl') || 77025.25);

  const targets = [tp1, tp2, tp3, tp4];
  const entryZoneWidthPct = Number((parseVal('entryWidth') || '0.08%').replace(/%/g, ''));
  const leverage = parseVal('leverage') || '4X-6X';
  const positionRiskPct = Number(parseVal('positionRiskPct') || 0.5);
  const riskPct = Number(parseVal('riskPct') || 0.32);
  const rrToTp2 = Number(parseVal('rrToTp2') || 2.25);
  const stopReason = parseVal('STOP REASON') || parseVal('stopReason') || 'above breakdown candle';
  const volume = parseVal('VOLUME') || parseVal('volume') || '1.51x avg';
  const invalidation = parseVal('invalidation') || `15m close above ${sl}`;
  const setupType = parseVal('setupType') || 'BREAKDOWN_RETEST';
  const confidence = Number(parseVal('alpha') || 72) / 100;

  const volumeRatio = Number(volume.match(/([0-9.]+)/)?.[1] || 1.51);
  const volumeConfirmation = {
    text: volume,
    ratio: volumeRatio
  };

  console.log("Parsed inputs:", {
    direction,
    entries,
    targets,
    sl,
    entryZoneWidthPct,
    leverage,
    positionRiskPct,
    riskPct,
    rrToTp2,
    stopReason,
    volume,
    invalidation,
    setupType,
    confidence
  });

  const managedSignal = createManagedSignal({
    symbol: symbol.toUpperCase(),
    direction,
    timeframe: '15m',
    generatedAt: new Date().toISOString(),
    keyLevel: `${setupType} (${direction === 'SHORT' ? 'Resistance' : 'Support'})`,
    strategySource: setupType,
    entryLevels: entries,
    targets,
    stopLoss: sl,
    leverage,
    riskPerTradePct: positionRiskPct,
    stopDistancePct: riskPct,
    riskRewardToTp2: rrToTp2,
    invalidationTimeframe: '15m',
    invalidationMode: 'BODY_CLOSE',
    invalidationPrice: sl,
    entryZoneWidthPct,
    stopReason,
    volumeConfirmation,
    status: 'ACTIVE',
    source: 'user_query'
  });

  return {
    symbol: symbol.toUpperCase(),
    direction,
    entries,
    targets,
    stop: sl,
    keyLevel: entries[0],
    keyLevelType: direction === 'SHORT' ? 'resistance' : 'support',
    keyLevelFibLabel: 'custom',
    levelStrength: 'Strong',
    riskRewardLabel: `TP2 1:${rrToTp2.toFixed(2)}`,
    leverageLabel: leverage,
    confidence,
    changePct: 0.0,
    patternBias: 0,
    rationaleHints: [
      `User-configured ${direction} setup is active.`,
      `${setupType} passed the entry, stop, and R:R gate.`,
      `Use ${leverage} and keep position risk near ${positionRiskPct.toFixed(2)}%.`
    ],
    setupType,
    riskPct,
    positionRiskPct,
    entryZoneWidthPct,
    volumeConfirmation,
    stopReason,
    invalidation,
    signalId: managedSignal.signalId,
    generatedAt: managedSignal.generatedAt,
    validUntil: managedSignal.validUntil,
    lifecycleStatus: managedSignal.status,
    managedSignal,
    source: 'user'
  };
}

const result = buildUserQueryDrivenTradePlan(userQuery, 'APT');
console.log("Result:", result ? "SUCCESS" : "FAILED");
if (result) {
  console.log("Formatted Signal:\n", formatManagedSignalText(result.managedSignal));
}
