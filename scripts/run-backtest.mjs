#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// CLI: Run Backtest
// ═══════════════════════════════════════════════════════
// Usage: node scripts/run-backtest.mjs [--symbols BTC,ETH,SOL] [--months 6]

import { backtestSymbol } from '../lib/backtest/runner.js';
import { storeResults } from '../lib/backtest/storage.js';

const args = process.argv.slice(2);
const getArg = (flag, fallback) => {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const symbols = getArg('--symbols', 'BTC,ETH,SOL').split(',').map(s => s.trim().toUpperCase());
const months = parseInt(getArg('--months', '6'), 10);

console.log(`\n🧪 Starting backtest: ${symbols.join(', ')} | ${months} months of 15m data\n`);

const allResults = [];

for (const symbol of symbols) {
  try {
    const result = await backtestSymbol({
      symbol,
      monthsBack: months,
      cfg: {},
      onProgress: ({ symbol: s, progress }) => {
        process.stdout.write(`\r  ${s}: ${progress}% complete`);
      },
    });
    console.log(''); // newline after progress
    allResults.push(result);

    // Print summary
    const m = result.metrics;
    if (m) {
      console.log(`  📊 ${symbol}: ${m.totalSignals} signals | Win: ${m.winRate}% | Avg R: ${m.avgRMultiple} | Max DD: ${m.maxDrawdown}R | PF: ${m.profitFactor} | Freq: ${m.signalFrequency}`);
      if (m.tpDistribution && Object.keys(m.tpDistribution).length > 0) {
        console.log(`  🎯 TP distribution: ${JSON.stringify(m.tpDistribution)}`);
      }
    }
  } catch (e) {
    console.error(`  ❌ ${symbol} failed:`, e.message);
    allResults.push({ symbol, error: e.message });
  }
}

// Store results
console.log('\n💾 Storing results...');
await storeResults(allResults);

console.log('\n✅ Backtest complete. Review results before proceeding to Step 6.\n');
console.log('⛔ CHECKPOINT: Do NOT wire signal delivery until you have reviewed these metrics.');
console.log('   Share this output with the project owner for sign-off.\n');
