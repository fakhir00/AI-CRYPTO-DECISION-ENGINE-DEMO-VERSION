// ═══════════════════════════════════════════════════════
// Signal Tracker — Monitors open signals, marks outcomes
// ═══════════════════════════════════════════════════════

/**
 * Check an open signal against the current price and update its status.
 * Returns the updated signal object.
 */
export function evaluateOutcome(signal, currentPrice) {
  if (!signal || signal.status !== 'open' || !currentPrice) return signal;

  const price = Number(currentPrice);
  const isLong = signal.direction === 'long';
  const sl = Number(signal.stop_loss);
  const tps = (signal.take_profits || []).map(Number);

  // Check stop-loss
  if (sl && ((isLong && price <= sl) || (!isLong && price >= sl))) {
    return {
      ...signal,
      status: 'closed',
      outcome: { result: 'stopped_out', exitPrice: price, exitTime: new Date().toISOString() },
    };
  }

  // Check take-profits (from highest to lowest)
  for (let i = tps.length - 1; i >= 0; i--) {
    const tp = tps[i];
    if (tp && ((isLong && price >= tp) || (!isLong && price <= tp))) {
      return {
        ...signal,
        status: 'closed',
        outcome: { result: `tp${i + 1}_hit`, exitPrice: price, exitTime: new Date().toISOString(), tpLevel: i + 1 },
      };
    }
  }

  return signal; // Still open
}

/**
 * Update a signal's status in Supabase.
 */
export async function closeSignal(signalId, outcome) {
  try {
    const { supabase } = await import('../supabase.js');
    const { error } = await supabase
      .from('signals')
      .update({ status: 'closed', outcome })
      .eq('id', signalId);
    if (error) throw error;
    console.log(`[tracker] Closed signal ${signalId}: ${outcome.result}`);
    return true;
  } catch (e) {
    console.error(`[tracker] Failed to close signal:`, e.message);
    return false;
  }
}
