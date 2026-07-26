// ═══════════════════════════════════════════════════════
// Signal Logger — Append-only writes to Supabase
// ═══════════════════════════════════════════════════════

/**
 * Write a fired signal to the Supabase database.
 * If signal.is_shadow is true, routes to shadow_signals. Otherwise to signals.
 * Also triggers Telegram delivery logic.
 */
export async function logSignal(signal) {
  try {
    const { supabase } = await import('../supabase.js');
    const { sendTelegramAlert } = await import('./telegram.js');

    const table = signal.is_shadow ? 'shadow_signals' : 'signals';

    const { error } = await supabase.from(table).insert({
      id:                   signal.id,
      symbol:               signal.symbol,
      direction:            signal.direction,
      timestamp:            signal.timestamp,
      entries:              signal.entries,
      take_profits:         signal.take_profits,
      stop_loss:            signal.stop_loss,
      confluence_score:     signal.confluence_score,
      contributing_factors: signal.contributing_factors,
      status:               signal.status || 'open',
      outcome:              signal.outcome || null,
      disclaimer:           signal.disclaimer || 'Not financial advice. For informational purposes only.',
      created_at:           signal.created_at || new Date().toISOString(),
    });
    if (error) throw error;
    console.log(`[signals] Logged signal ${signal.id} (${signal.symbol} ${signal.direction}) to ${table}`);

    // Fire Telegram delivery
    await sendTelegramAlert(signal);

    return true;
  } catch (e) {
    console.error(`[signals] Failed to log signal:`, e.message);
    return false;
  }
}

/**
 * Fetch recent signals from Supabase.
 */
export async function fetchRecentSignals(limit = 20) {
  try {
    const { supabase } = await import('../supabase.js');
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[signals] Failed to fetch signals:', e.message);
    return [];
  }
}

/**
 * Fetch open signals for a specific symbol.
 */
export async function fetchOpenSignals(symbol, isShadow = false) {
  try {
    const table = isShadow ? 'shadow_signals' : 'signals';
    const { supabase } = await import('../supabase.js');
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('symbol', symbol.toUpperCase())
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn(`[signals] Failed to fetch open signals for ${symbol}:`, e.message);
    return [];
  }
}

/**
 * Update an existing signal's outcome and status in Supabase.
 */
export async function updateSignalOutcome(id, outcome, status, isShadow = false) {
  try {
    const table = isShadow ? 'shadow_signals' : 'signals';
    const { supabase } = await import('../supabase.js');
    const { error } = await supabase
      .from(table)
      .update({
        outcome,
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    console.log(`[signals] Updated signal ${id} in ${table} (status: ${status})`);
    return true;
  } catch (e) {
    console.error(`[signals] Failed to update signal ${id}:`, e.message);
    return false;
  }
}
