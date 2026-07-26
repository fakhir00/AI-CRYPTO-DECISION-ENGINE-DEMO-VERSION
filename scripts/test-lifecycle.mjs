import { processMissedCandles } from './run-shadow.mjs';
import { simulateOutcome } from '../lib/backtest/runner.js';
import { SCORING_CONFIG } from '../lib/config.js';

const COST_PER_SIDE = 0.0004 + 0.0005; // 0.09%

async function runTest() {
  console.log('[test] Running deterministic lifecycle test...');

  const sig = {
    direction: 'long',
    entries: [100, 100],
    stop_loss: 90,
    take_profits: [110, 120, 130, 140]
  };

  // 1. Synthetic Sequence:
  // Candle 0: Entry candle (already passed)
  // Candle 1: Hits TP1 (High 111, Low 99)
  // Candle 2: Pulls back, hits breakeven stop loss (High 105, Low 95)
  // Stop loss after TP1 is 100.
  const candles = [
    { openTime: 1000, open: 100, high: 100, low: 100, close: 100 }, // candle 0 (entry)
    { openTime: 2000, open: 100, high: 111, low: 99, close: 110 },  // candle 1
    { openTime: 3000, open: 110, high: 105, low: 95, close: 95 },   // candle 2
  ];

  const splitConfig = [0.3, 0.3, 0.2, 0.2];

  // Test backtester simulateOutcome
  const backtestOutcome = simulateOutcome(candles, 0, { levels: { entries: [100, 100], stopLoss: 90, takeProfit: [110, 120, 130, 140] }, direction: 'long' }, { exits: { scale_out_splits: splitConfig } });

  // 🚨 Note on Batch Processing: We pass an array of TWO candles here simultaneously (`candles.slice(1)`).
  // This explicitly tests the downtime-backfill logic by ensuring the state machine correctly iterates
  // through multiple missed candles chronologically in a single execution batch, rather than one-by-one.
  const result = processMissedCandles(sig, candles.slice(1), COST_PER_SIDE, splitConfig);

  console.log('\n--- Backtester Output (simulateOutcome) ---');
  console.log(backtestOutcome);

  console.log('\n--- Live Worker Output (processMissedCandles) ---');
  console.log(result.outcome);

  // Assertions
  const realizedRMatch = Math.abs(backtestOutcome.rMultiple - result.outcome.realizedR) < 0.0001;
  const statusMatch = backtestOutcome.result === result.outcome.finalResultStr;

  if (realizedRMatch && statusMatch) {
    console.log('✅ CASE 1 (TP1 -> Breakeven SL) PASSED.');
  } else {
    console.error('❌ CASE 1 FAILED.');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════
  // Case 2: Full Stop-Loss, no TP hit
  // ═══════════════════════════════════════════════════════
  console.log('\n[Case 2] Full Stop-Loss (clean loss)');
  
  const candlesCase2 = [
    { openTime: 1000, open: 100, high: 100, low: 100, close: 100 }, // entry
    { openTime: 2000, open: 100, high: 105, low: 95, close: 98 },   // pull back
    { openTime: 3000, open: 98, high: 100, low: 88, close: 90 },    // stop out at 90
  ];

  const btOutcome2 = simulateOutcome(candlesCase2, 0, { levels: { entries: [100, 100], stopLoss: 90, takeProfit: [110, 120, 130, 140] }, direction: 'long' }, { exits: { scale_out_splits: splitConfig } });
  
  // Clean sig for processMissedCandles
  const sig2 = {
    direction: 'long',
    entries: [100, 100],
    stop_loss: 90,
    take_profits: [110, 120, 130, 140]
  };
  const res2 = processMissedCandles(sig2, candlesCase2.slice(1), COST_PER_SIDE, splitConfig);

  console.log('Backtest:', btOutcome2.rMultiple, btOutcome2.result);
  console.log('Live:', res2.outcome.realizedR, res2.outcome.finalResultStr);

  const rMatch2 = Math.abs(btOutcome2.rMultiple - res2.outcome.realizedR) < 0.0001;
  const statMatch2 = btOutcome2.result === res2.outcome.finalResultStr;

  if (rMatch2 && statMatch2) {
    console.log('✅ CASE 2 (Full SL) PASSED.');
  } else {
    console.error('❌ CASE 2 FAILED.');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════
  // Case 3: All Four TPs Hit
  // ═══════════════════════════════════════════════════════
  console.log('\n[Case 3] All Four TPs Hit (full win)');

  const candlesCase3 = [
    { openTime: 1000, open: 100, high: 100, low: 100, close: 100 }, // entry
    { openTime: 2000, open: 100, high: 111, low: 105, close: 110 }, // tp1 hit
    { openTime: 3000, open: 110, high: 125, low: 105, close: 120 }, // tp2 hit
    { openTime: 4000, open: 120, high: 145, low: 120, close: 145 }, // tp3 and tp4 hit in one giant candle
  ];

  const btOutcome3 = simulateOutcome(candlesCase3, 0, { levels: { entries: [100, 100], stopLoss: 90, takeProfit: [110, 120, 130, 140] }, direction: 'long' }, { exits: { scale_out_splits: splitConfig } });
  
  const sig3 = {
    direction: 'long',
    entries: [100, 100],
    stop_loss: 90,
    take_profits: [110, 120, 130, 140]
  };
  
  // Here we pass THREE missed candles at once in a batch
  const res3 = processMissedCandles(sig3, candlesCase3.slice(1), COST_PER_SIDE, splitConfig);

  console.log('Backtest:', btOutcome3.rMultiple, btOutcome3.result);
  console.log('Live:', res3.outcome.realizedR, res3.outcome.finalResultStr);

  const rMatch3 = Math.abs(btOutcome3.rMultiple - res3.outcome.realizedR) < 0.0001;
  const statMatch3 = btOutcome3.result === res3.outcome.finalResultStr;

  if (rMatch3 && statMatch3) {
    console.log('✅ CASE 3 (All TPs) PASSED.');
  } else {
    console.error('❌ CASE 3 FAILED.');
    process.exit(1);
  }

  console.log('\n🎉 ALL DETERMINISTIC LIFECYCLE TESTS PASSED!');
}

runTest();
