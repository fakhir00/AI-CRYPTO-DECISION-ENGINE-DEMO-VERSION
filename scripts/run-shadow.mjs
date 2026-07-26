#!/usr/bin/env node
// ═══════════════════════════════════════════════════════
// CLI: Run Shadow Mode (Live Signal Routing)
// ═══════════════════════════════════════════════════════

import { ensureServerEnv } from '../lib/server-env.js';
import { ingestAndScore } from '../lib/scoring/engine.js';
import { logSignal, fetchOpenSignals, updateSignalOutcome } from '../lib/signals/logger.js';
import { createSignal } from '../lib/signals/schema.js';
import { SCORING_CONFIG } from '../lib/config.js';
import { setCooldown } from '../lib/scoring/signal-generator.js';

// Setup environment and overrides for shadow mode
ensureServerEnv();

const SHADOW_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ZEC', 'DOGE', 'TRX', 'SUI'];
const POLL_INTERVAL_MS = 60 * 1000; // 1 minute
const COST_PER_SIDE = 0.0004 + 0.0005; // 0.09%

// ═══════════════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════════════

async function seedCooldowns() {
  console.log('[shadow] Seeding cooldowns from database...');
  try {
    const { supabase } = await import('../lib/supabase.js');
    for (const sym of SHADOW_SYMBOLS) {
      const { data, error } = await supabase
        .from('shadow_signals')
        .select('created_at')
        .eq('symbol', sym)
        .order('created_at', { ascending: false })
        .limit(1);
      
      if (!error && data && data.length > 0) {
        const lastTime = new Date(data[0].created_at).getTime();
        setCooldown(sym, lastTime);
        console.log(`[shadow] Seeded cooldown for ${sym}: ${new Date(lastTime).toISOString()}`);
      }
    }
  } catch (err) {
    console.warn('[shadow] Failed to seed cooldowns:', err);
  }
}

async function sendHeartbeat() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.SHADOW_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const text = `🤖 *[Shadow Worker Started]*\n\nShadow mode polling initialized for 9-asset verified baseline. Monitoring open signals and generating new ones.`;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
    console.log('[shadow] Telegram heartbeat sent.');
  } catch (err) {
    console.warn('[shadow] Heartbeat send failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════
// Lifecycle Management
// ═══════════════════════════════════════════════════════

export async function evaluateOpenSignals(ingestionReport) {
  const klinesBySymbol = {};
  for (const pt of ingestionReport.points) {
    if (pt.metric === 'klines_15m' && pt.symbol !== '*') {
      klinesBySymbol[pt.symbol] = pt.value;
    }
  }

  for (const sym of SHADOW_SYMBOLS) {
    const openSignals = await fetchOpenSignals(sym, true);
    if (!openSignals || openSignals.length === 0) continue;

    const candles = klinesBySymbol[sym] || [];
    if (candles.length === 0) continue;

    for (const sig of openSignals) {
      const lastCheckTime = new Date(sig.updated_at || sig.created_at).getTime();
      const latestCandleTime = candles[candles.length - 1].closeTime || candles[candles.length - 1].openTime;
      
      // Gap warning: 200 candles of 15m is roughly 50 hours (180,000,000 ms). Let's warn if gap > 50h.
      if (latestCandleTime - lastCheckTime > 50 * 60 * 60 * 1000) {
        console.warn(`[WARN] Downtime gap for ${sym} exceeds 50 hours! Some wicks may be missed for signal ${sig.id}.`);
      }

      // Filter candles that occurred *after* our last check
      const missedCandles = candles.filter(c => {
        const cTime = c.closeTime || c.openTime;
        return cTime > lastCheckTime;
      });

      if (missedCandles.length === 0) continue; // Nothing to process yet

      const splitConfig = SCORING_CONFIG.exits?.scale_out_splits || [0.3, 0.3, 0.2, 0.2];
      const result = processMissedCandles(sig, missedCandles, COST_PER_SIDE, splitConfig);

      if (result.statusChanged) {
        const nextStatus = result.closed ? 'closed' : 'open';
        await updateSignalOutcome(sig.id, result.outcome, nextStatus, true);
      }
    }
  }
}

export function processMissedCandles(sig, missedCandles, COST_PER_SIDE, splitConfig) {
  let outcome = sig.outcome || {
    realizedR: 0,
    highestTpLevel: 0,
    remainingSize: 1.0,
    finalResultStr: 'open'
  };

  const isLong = sig.direction === 'long' || sig.direction === 'buy';
  const avgEntry = sig.entries?.[1] || sig.entries?.[0]; // Usually entries[1] is avgEntry
  let currentSl = sig.stop_loss;
  
  const initialRisk = Math.abs(avgEntry - currentSl);
  const effEntry = isLong ? avgEntry * (1 + COST_PER_SIDE) : avgEntry * (1 - COST_PER_SIDE);
  
  if (outcome.highestTpLevel >= 1) {
    currentSl = effEntry;
  }
  
  const tps = sig.take_profits || [];
  if (!avgEntry || !currentSl || tps.length === 0) return { statusChanged: false, closed: false, outcome };
  
  const tpFractions = [];
  let remainingAlloc = 1.0;
  for (let i = 0; i < tps.length; i++) {
    if (i === tps.length - 1) {
      tpFractions.push(remainingAlloc);
    } else {
      const alloc = splitConfig[i] ?? (remainingAlloc / (tps.length - i));
      tpFractions.push(alloc);
      remainingAlloc -= alloc;
    }
  }

  let statusChanged = false;
  let closed = false;

  for (const c of missedCandles) {
    // 1. Check Stop Loss
    if ((isLong && c.low <= currentSl) || (!isLong && c.high >= currentSl)) {
      const effExit = isLong ? currentSl * (1 - COST_PER_SIDE) : currentSl * (1 + COST_PER_SIDE);
      const pnl = isLong ? effExit - effEntry : effEntry - effExit;
      const r = initialRisk > 0 ? pnl / initialRisk : 0;
      outcome.realizedR += r * outcome.remainingSize;
      
      outcome.remainingSize = 0;
      outcome.finalResultStr = outcome.highestTpLevel > 0 ? `tp${outcome.highestTpLevel}_sl` : 'stopped_out';
      
      statusChanged = true;
      closed = true;
      break;
    }

    // 2. Check Take Profits
    for (let t = outcome.highestTpLevel; t < tps.length; t++) {
      if ((isLong && c.high >= tps[t]) || (!isLong && c.low <= tps[t])) {
        const effExit = isLong ? tps[t] * (1 - COST_PER_SIDE) : tps[t] * (1 + COST_PER_SIDE);
        const pnl = isLong ? effExit - effEntry : effEntry - effExit;
        const r = initialRisk > 0 ? pnl / initialRisk : 0;
        
        const frac = tpFractions[t];
        outcome.realizedR += r * frac;
        outcome.remainingSize -= frac;
        
        if (outcome.remainingSize < 0.001) outcome.remainingSize = 0;
        
        outcome.highestTpLevel = t + 1;
        statusChanged = true;
        
        if (outcome.highestTpLevel === 1) {
          currentSl = effEntry;
        }
      } else {
        break; // TPs are ordered
      }
    }
    
    if (outcome.remainingSize <= 0.001) {
      outcome.remainingSize = 0;
      outcome.finalResultStr = `tp${tps.length}_hit`;
      closed = true;
      break;
    }
    
    if (closed) break;
  }

  return { statusChanged, closed, outcome };
}

// ═══════════════════════════════════════════════════════
// Main Loop
// ═══════════════════════════════════════════════════════

async function run() {
  try {
    const cfg = {
      ...SCORING_CONFIG,
      symbols: SHADOW_SYMBOLS
    };
    
    const { signals, ingestionReport } = await ingestAndScore(cfg);
    
    // Evaluate and exit open signals FIRST
    await evaluateOpenSignals(ingestionReport);
    
    // Then log new signals
    for (const rawSig of signals) {
      const sig = createSignal(rawSig);
      
      const openSignals = await fetchOpenSignals(sig.symbol, true);
      const hasShadow = openSignals.some(s => s.direction === sig.direction);
      
      if (!hasShadow) {
        sig.is_shadow = true;
        console.log(`[shadow] Firing NEW shadow signal for ${sig.symbol} (${sig.direction})`);
        await logSignal(sig);
      }
    }
  } catch (err) {
    console.error('[shadow] Error during shadow run:', err);
  }
}

async function start() {
  // Only start the loop if run directly, not if imported for testing
  import.meta.url === `file://${process.argv[1]}` && (async () => {
    console.log(`\n[shadow] Waking up to run shadow evaluation at ${new Date().toISOString()}...`);
    await seedCooldowns();
    await sendHeartbeat();
    run();
    setInterval(run, POLL_INTERVAL_MS);
  })();
}

start();
