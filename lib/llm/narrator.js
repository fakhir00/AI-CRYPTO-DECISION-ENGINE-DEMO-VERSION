// ═══════════════════════════════════════════════════════
// LLM Narrator — Generates plain-language rationale
// ═══════════════════════════════════════════════════════
// Takes a fired signal's contributing_factors and prompts
// OpenAI for a 2-3 sentence human-readable explanation.
// NEVER generates price levels — those come from the scoring engine.

/**
 * Generate a narrative explanation for a signal.
 * @param {object} signal - Signal object with contributingFactors
 * @returns {Promise<string>} 2-3 sentence rationale
 */
export async function generateNarrative(signal) {
  if (!signal?.contributing_factors && !signal?.contributingFactors) {
    return 'Signal generated based on multi-factor confluence analysis.';
  }

  const factors = signal.contributing_factors || signal.contributingFactors;
  const factorSummary = Object.entries(factors)
    .map(([cat, data]) => {
      const score = data.score?.toFixed(2) ?? '?';
      const details = (data.factors || []).join('; ');
      return `${cat} (${score}): ${details}`;
    })
    .join('\n');

  const prompt = `You are a crypto market analyst. Given these technical analysis factors for a ${signal.direction?.toUpperCase()} signal on ${signal.symbol}/USDT, write exactly 2-3 sentences explaining why this trade setup exists. Be specific, cite the actual indicator values. Do NOT mention any price levels, entries, targets, or stop-losses — those are handled separately. Do NOT give financial advice.

Factors:
${factorSummary}

Write your 2-3 sentence analysis:`;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.4,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || fallbackNarrative(factors);
  } catch (e) {
    console.warn('[narrator] LLM call failed, using fallback:', e.message);
    return fallbackNarrative(factors);
  }
}

/** Deterministic fallback when the LLM is unavailable. */
function fallbackNarrative(factors) {
  const cats = Object.keys(factors || {});
  const bullish = Object.values(factors || {}).filter(f => (f.score || 0) > 0).length;
  const bearish = cats.length - bullish;
  return `Signal backed by ${bullish} bullish and ${bearish} bearish category scores across ${cats.length} analysis dimensions.`;
}
