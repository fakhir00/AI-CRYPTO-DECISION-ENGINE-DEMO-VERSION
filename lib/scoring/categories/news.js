// ═══════════════════════════════════════════════════════
// Scoring Category: News (RSS event flags)
// ═══════════════════════════════════════════════════════
import { lookup } from '../../ingestion/schema.js';

const DEFAULT_BULLISH = ['etf approved', 'adoption', 'partnership', 'upgrade', 'halving', 'bullish', 'rally', 'breakout', 'institutional'];
const DEFAULT_BEARISH = ['hack', 'exploit', 'regulation', 'ban', 'lawsuit', 'sec', 'crash', 'bearish', 'selloff', 'fraud'];

export function scoreNews(index, symbol, cfg = {}) {
  const bullishKw = cfg.bullish_keywords || DEFAULT_BULLISH;
  const bearishKw = cfg.bearish_keywords || DEFAULT_BEARISH;
  const scanCount = cfg.scan_count ?? 10;

  let score = 0;
  const factors = [];

  // Collect recent news articles from the index
  // News DataPoints use symbol '*' and metric 'news_article'
  const articles = [];
  for (const [key, dp] of index) {
    if (dp.metric === 'news_article' && dp.value) {
      articles.push(dp.value);
    }
    if (articles.length >= scanCount) break;
  }

  if (articles.length === 0) {
    factors.push('No recent news articles');
    return { score: 0, factors };
  }

  // Scan article titles + descriptions for keyword flags
  let bullCount = 0;
  let bearCount = 0;
  const sym = symbol.toLowerCase();

  for (const art of articles) {
    const text = `${art.title || ''} ${art.description || ''}`.toLowerCase();
    // Boost weight if the article mentions this specific symbol
    const symbolRelevant = text.includes(sym) || text.includes(symbol.toLowerCase());
    const weight = symbolRelevant ? 2 : 1;

    for (const kw of bullishKw) {
      if (text.includes(kw)) { bullCount += weight; break; }
    }
    for (const kw of bearishKw) {
      if (text.includes(kw)) { bearCount += weight; break; }
    }
  }

  if (bullCount > bearCount + 2) {
    score += 1.0;
    factors.push(`News skews bullish (${bullCount} bull vs ${bearCount} bear signals)`);
  } else if (bearCount > bullCount + 2) {
    score -= 1.0;
    factors.push(`News skews bearish (${bearCount} bear vs ${bullCount} bull signals)`);
  } else if (bullCount > bearCount) {
    score += 0.3;
    factors.push(`News slightly bullish (${bullCount}b/${bearCount}br)`);
  } else if (bearCount > bullCount) {
    score -= 0.3;
    factors.push(`News slightly bearish (${bearCount}br/${bullCount}b)`);
  } else {
    factors.push(`News neutral (${bullCount}b/${bearCount}br)`);
  }

  return { score: clamp(score, -2, 2), factors };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
