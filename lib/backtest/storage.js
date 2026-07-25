// ═══════════════════════════════════════════════════════
// Backtest Storage — Persist results to Supabase
// ═══════════════════════════════════════════════════════

export async function storeResults(results) {
  try {
    const { supabase } = await import('../supabase.js');
    const { error } = await supabase.from('global_market_cache').upsert({
      id: 'backtest_results_v1',
      data: {
        results,
        timestamp: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    console.log('[backtest] Results stored in Supabase');
    return true;
  } catch (e) {
    console.error('[backtest] Failed to store results:', e.message);
    return false;
  }
}

export async function loadResults() {
  try {
    const { supabase } = await import('../supabase.js');
    const { data, error } = await supabase
      .from('global_market_cache')
      .select('data')
      .eq('id', 'backtest_results_v1')
      .single();
    if (error || !data?.data) return null;
    return data.data;
  } catch {
    return null;
  }
}
