// DEPRECATED STUB — prevents main.js build breakage until Step 2 replaces this with lib/scoring/engine.js
export const DEFAULT_MOMENTUM_CONFIG = {
  spreadMaxPct: 0.15, atrThreshold: 0.0005, minRr: 1.2, minTp1Rr: 0.8,
  maxStopPct: 5.0, expiryCandles: 4, expiryMinutes: 45, riskPerTrade: 0.5
};
export const SIGNAL_HARD_REJECTS = {
  minTp1Pct: 0.25, minVolumeRatio: 0.3, minStopDistancePct: 0.15,
  maxEntryWidthPct: 0.85, tp1TooLow: 'TP1_TOO_LOW', volumeTooLow: 'VOLUME_TOO_LOW',
  stopTooTight: 'STOP_TOO_TIGHT', entryZoneTooWide: 'ENTRY_ZONE_TOO_WIDE'
};
export function evaluateMomentumStrategy() { return { status: 'NO_SIGNAL', direction: null }; }
