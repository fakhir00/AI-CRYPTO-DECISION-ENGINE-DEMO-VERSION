import { fetchAllData, backtestSymbol, PRODUCTION_CONFIG } from './lib/backtest/runner.js';
import { computeMetrics } from './lib/backtest/metrics.js';

const START = new Date('2026-01-25T00:00:00Z').getTime();
const END = Date.now();
const { candles, funding } = await fetchAllData('ACE', START, END);
const fullResult = await backtestSymbol({
    symbol: 'ACE', candles, funding, fng: [],
    cfg: PRODUCTION_CONFIG
});
const m = computeMetrics(fullResult.signals);
console.log(`Wins: ${m.wins}, Losses: ${m.losses}, BE: ${m.breakevens}, Expired: ${m.expired}`);
for (const sig of fullResult.signals) {
    const o = sig.outcome;
    const r = o.rMultiple;
    if (Math.abs(r) <= 0.05) {
        console.log(`BE candidate: result=${o.result} R=${r} bars=${o.barsHeld} idx=${sig.candleIndex} date=${new Date(sig.candleTime).toISOString()}`);
    }
}
