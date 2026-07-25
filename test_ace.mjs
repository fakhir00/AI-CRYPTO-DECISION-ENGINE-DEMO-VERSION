import { fetchAllData, backtestSymbol, PRODUCTION_CONFIG } from './lib/backtest/runner.js';

const { candles, funding } = await fetchAllData('ACE', 1706140800000, 1721865600000);
const fullResult = await backtestSymbol({
    symbol: 'ACE', candles, funding, fng: [],
    cfg: PRODUCTION_CONFIG
});
for (const sig of fullResult.signals) {
    const o = sig.outcome;
    const r = o.rMultiple;
    if (Math.abs(r) <= 0.05 && o.result !== 'expired' && !o.result.includes('_expired')) {
        console.log(`BE: result=${o.result} R=${r} bars=${o.barsHeld} idx=${sig.candleIndex} date=${new Date(sig.candleTime).toISOString()}`);
    }
}
