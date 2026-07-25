// ═══════════════════════════════════════════════════════
// Signal Schema — Canonical signal object structure
// ═══════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';

/**
 * Create a canonical signal object from the scoring engine output.
 * This is the single source of truth for what a "signal" looks like
 * across Supabase, dashboard, and Telegram delivery.
 */
export function createSignal(raw) {
  return {
    id:                  uuidv4(),
    symbol:              String(raw.symbol || '').toUpperCase(),
    direction:           raw.direction === 'short' ? 'short' : 'long',
    timestamp:           raw.timestamp || new Date().toISOString(),
    entries:             raw.levels?.entries || [],
    take_profits:        raw.levels?.takeProfit || [],
    stop_loss:           raw.levels?.stopLoss ?? null,
    confluence_score:    raw.confluenceScore ?? 0,
    contributing_factors: raw.contributingFactors || {},
    status:              'open',
    outcome:             null,
    risk_pct:            raw.levels?.riskPct ?? null,
    rr_to_tp2:           raw.levels?.rrToTp2 ?? null,
    atr:                 raw.levels?.atr ?? null,
    atr_pct:             raw.levels?.atrPct ?? null,
    agreeing_categories: raw.agreeingCategories || [],
    narrative:           null,  // filled by LLM narrator in Step 4
    disclaimer:          'Not financial advice. For informational purposes only.',
    created_at:          new Date().toISOString(),
  };
}

/**
 * Format a signal for display (dashboard or Telegram).
 * Returns the exact {COIN}/USDT format specified in requirements.
 */
export function formatSignalText(signal) {
  if (!signal || !signal.symbol) return '';
  const dir = signal.direction === 'short' ? '🔴 SHORT' : '🟢 LONG';
  const entries = (signal.entries || []).map(e => formatPrice(e)).join(' / ');
  const tps = (signal.take_profits || []).map(t => formatPrice(t)).join(' / ');
  const sl = formatPrice(signal.stop_loss);
  const score = (signal.confluence_score * 100).toFixed(0);

  let text = `${dir} ${signal.symbol}/USDT\n`;
  text += `📊 Confluence: ${score}/200\n`;
  text += `🎯 Entries: ${entries}\n`;
  text += `✅ TP: ${tps}\n`;
  text += `🛑 SL: ${sl}\n`;
  if (signal.risk_pct != null) text += `⚠️ Risk: ${signal.risk_pct}% | R:R to TP2: ${signal.rr_to_tp2}\n`;
  if (signal.narrative) text += `\n💬 ${signal.narrative}\n`;
  text += `\n⚠️ ${signal.disclaimer}`;
  return text;
}

function formatPrice(v) {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
