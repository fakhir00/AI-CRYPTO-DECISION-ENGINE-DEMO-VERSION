import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { fetchMultiTimeframeCandles } from '../lib/ccxt-market-data.js';
import { normalizeMomentumConfig, runMomentumBacktest } from '../lib/momentum-strategy.js';

const CONFIG_PATH = new URL('../config/momentum-strategy.yaml', import.meta.url);

function parseArgs(argv = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8');
  return YAML.parse(raw);
}

function fmt(n, digits = 2) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0.00';
  return value.toFixed(digits);
}

const args = parseArgs(process.argv.slice(2));
const rawConfig = await loadConfig();
const config = normalizeMomentumConfig(rawConfig);
const exchangeId = String(args.exchange || rawConfig.exchanges?.[0] || 'binance');
const symbols = args.symbol
  ? [args.symbol]
  : (Array.isArray(rawConfig.symbols) && rawConfig.symbols.length ? rawConfig.symbols : ['BTC/USDT']);
const limit = Number(args.limit || config.fetchLimit || 200);
const timeframes = [config.primaryTimeframe, config.trendTimeframe];

console.log(`Momentum strategy backtest | exchange=${exchangeId} | limit=${limit} | ${timeframes.join('+')}`);

for (const symbol of symbols) {
  try {
    const candles = await fetchMultiTimeframeCandles({ exchangeId, symbol, timeframes, limit });
    const result = runMomentumBacktest(
      symbol,
      candles[config.primaryTimeframe] || [],
      candles[config.trendTimeframe] || [],
      config
    );
    const s = result.summary;
    console.log(`\n${symbol}`);
    console.log(`Trades: ${s.trades}`);
    console.log(`Win Rate: ${fmt(s.winRate)}%`);
    console.log(`Avg R:R: ${fmt(s.avgRR)}`);
    console.log(`Profit Factor: ${Number.isFinite(s.profitFactor) ? fmt(s.profitFactor) : 'Infinity'}`);
    console.log(`Max Drawdown: ${fmt(s.maxDrawdownR)}R`);
    console.log(`Net: ${fmt(s.netR)}R`);
  } catch (error) {
    console.log(`\n${symbol} skipped: ${error.message}`);
  }
}
