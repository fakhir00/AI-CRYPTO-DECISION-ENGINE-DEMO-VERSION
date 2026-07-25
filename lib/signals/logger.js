// ═══════════════════════════════════════════════════════
// Signal Logger — Append-only writes to Supabase
// ═══════════════════════════════════════════════════════

/**
 * Write a fired signal to the Supabase `signals` table.
 * Append-only: never overwrites existing signals.
 */
export async function logSignal(signal) {
  try {
    const { supabase } = await import('../supabase.js');
    const { error } = await supabase.from('signals').insert({
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
      created_at:           signal.created_at || new Date().toISOString(),
    });
    if (error) throw error;
    console.log(`[signals] Logged signal ${signal.id} (${signal.symbol} ${signal.direction})`);
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
export async function fetchOpenSignals(symbol) {
  try {
    const { supabase } = await import('../supabase.js');
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('symbol', symbol.toUpperCase())
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.warn('[signals] Failed to fetch open signals:', e.message);
    return [];
  }
}
