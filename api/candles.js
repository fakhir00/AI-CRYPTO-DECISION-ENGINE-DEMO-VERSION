// ═══════════════════════════════════════════════════════════════
// NEXUS Candlestick Pattern Recognition Engine
// Fetches OHLCV from Binance and detects institutional patterns
// ═══════════════════════════════════════════════════════════════

// Cache: symbol+interval → { patterns, timestamp }
const cache = {};
const CACHE_TTL = 60 * 1000; // 1 minute

// ── Pattern Detection Helpers ──────────────────────────────────

function bodySize(o, c) { return Math.abs(c - o); }
function upperWick(o, c, h) { return h - Math.max(o, c); }
function lowerWick(o, c, l) { return Math.min(o, c) - l; }
function range(h, l) { return h - l; }
function isBull(o, c) { return c > o; }
function isBear(o, c) { return c < o; }

// ── Market Structure & Volatility ──────────────────────────────
function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;
  
  let trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i-1];
    const tr1 = cur.high - cur.low;
    const tr2 = Math.abs(cur.high - prev.close);
    const tr3 = Math.abs(cur.low - prev.close);
    trueRanges.push(Math.max(tr1, tr2, tr3));
  }
  
  const recentTRs = trueRanges.slice(-period);
  return recentTRs.reduce((a, b) => a + b, 0) / period;
}

function getMarketStructure(candles) {
  if (candles.length === 0) return { swingHigh: 0, swingLow: 0 };
  let maxHigh = candles[0].high;
  let minLow = candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].high > maxHigh) maxHigh = candles[i].high;
    if (candles[i].low < minLow) minLow = candles[i].low;
  }
  return { swingHigh: maxHigh, swingLow: minLow };
}

function detectPatterns(candles) {
  const patterns = [];

  for (let i = 2; i < candles.length; i++) {
    const prev2 = candles[i - 2];
    const prev  = candles[i - 1];
    const cur   = candles[i];

    const [po2, ph2, pl2, pc2] = [prev2.open, prev2.high, prev2.low, prev2.close];
    const [po,  ph,  pl,  pc ] = [prev.open,  prev.high,  prev.low,  prev.close];
    const [co,  ch,  cl,  cc ] = [cur.open,   cur.high,   cur.low,   cur.close];

    const body   = bodySize(co, cc);
    const rng    = range(ch, cl);
    const uWick  = upperWick(co, cc, ch);
    const lWick  = lowerWick(co, cc, cl);
    const pBody  = bodySize(po, pc);
    const pRng   = range(ph, pl);

    // ── Doji (indecision) ──
    if (rng > 0 && body / rng < 0.1) {
      patterns.push({
        name: 'Doji',
        type: 'neutral',
        description: 'Market indecision — wait for confirmation before entering.',
        candle: i
      });
    }

    // ── Hammer (bullish reversal at bottom) ──
    if (lWick > body * 2 && uWick < body * 0.5 && isBull(co, cc)) {
      patterns.push({
        name: 'Hammer',
        type: 'bullish',
        description: 'Buyers rejected lower prices strongly — potential reversal to the upside.',
        candle: i
      });
    }

    // ── Hanging Man (bearish reversal at top) ──
    if (lWick > body * 2 && uWick < body * 0.5 && isBear(co, cc)) {
      patterns.push({
        name: 'Hanging Man',
        type: 'bearish',
        description: 'Same shape as Hammer but in an uptrend — potential reversal to the downside.',
        candle: i
      });
    }

    // ── Shooting Star (bearish) ──
    if (uWick > body * 2 && lWick < body * 0.5 && isBear(co, cc)) {
      patterns.push({
        name: 'Shooting Star',
        type: 'bearish',
        description: 'Sellers rejected higher prices — bearish rejection from a key level.',
        candle: i
      });
    }

    // ── Inverted Hammer (bullish) ──
    if (uWick > body * 2 && lWick < body * 0.5 && isBull(co, cc)) {
      patterns.push({
        name: 'Inverted Hammer',
        type: 'bullish',
        description: 'Buyers pushing for higher prices after a downtrend — potential bullish reversal.',
        candle: i
      });
    }

    // ── Bullish Engulfing ──
    if (isBear(po, pc) && isBull(co, cc) && co < pc && cc > po) {
      patterns.push({
        name: 'Bullish Engulfing',
        type: 'bullish',
        description: 'Strong bullish candle completely engulfs prior bearish candle — high-conviction long setup.',
        candle: i
      });
    }

    // ── Bearish Engulfing ──
    if (isBull(po, pc) && isBear(co, cc) && co > pc && cc < po) {
      patterns.push({
        name: 'Bearish Engulfing',
        type: 'bearish',
        description: 'Strong bearish candle completely engulfs prior bullish candle — high-conviction short setup.',
        candle: i
      });
    }

    // ── Bullish Harami ──
    if (isBear(po, pc) && isBull(co, cc) && co > pc && cc < po && body < pBody * 0.6) {
      patterns.push({
        name: 'Bullish Harami',
        type: 'bullish',
        description: 'Small bullish candle inside a large bearish candle — sellers losing momentum.',
        candle: i
      });
    }

    // ── Bearish Harami ──
    if (isBull(po, pc) && isBear(co, cc) && co < pc && cc > po && body < pBody * 0.6) {
      patterns.push({
        name: 'Bearish Harami',
        type: 'bearish',
        description: 'Small bearish candle inside a large bullish candle — buyers losing momentum.',
        candle: i
      });
    }

    // ── Morning Star (bullish 3-candle) ──
    if (
      isBear(po2, pc2) && bodySize(po2, pc2) > pRng * 0.5 &&
      bodySize(po, pc) < pBody * 0.3 &&
      isBull(co, cc) && cc > (po2 + pc2) / 2
    ) {
      patterns.push({
        name: 'Morning Star',
        type: 'bullish',
        description: '3-candle bullish reversal: strong bear → indecision → strong bull. Institutional grade entry signal.',
        candle: i
      });
    }

    // ── Evening Star (bearish 3-candle) ──
    if (
      isBull(po2, pc2) && bodySize(po2, pc2) > pRng * 0.5 &&
      bodySize(po, pc) < pBody * 0.3 &&
      isBear(co, cc) && cc < (po2 + pc2) / 2
    ) {
      patterns.push({
        name: 'Evening Star',
        type: 'bearish',
        description: '3-candle bearish reversal: strong bull → indecision → strong bear. Institutional grade short signal.',
        candle: i
      });
    }

    // ── Three White Soldiers (bullish) ──
    if (
      i >= 3 &&
      isBull(candles[i-2].open, candles[i-2].close) &&
      isBull(po, pc) &&
      isBull(co, cc) &&
      pc > candles[i-2].close &&
      cc > pc
    ) {
      patterns.push({
        name: 'Three White Soldiers',
        type: 'bullish',
        description: 'Three consecutive strong bullish candles — sustained buying pressure, strong trend continuation.',
        candle: i
      });
    }

    // ── Three Black Crows (bearish) ──
    if (
      i >= 3 &&
      isBear(candles[i-2].open, candles[i-2].close) &&
      isBear(po, pc) &&
      isBear(co, cc) &&
      pc < candles[i-2].close &&
      cc < pc
    ) {
      patterns.push({
        name: 'Three Black Crows',
        type: 'bearish',
        description: 'Three consecutive strong bearish candles — sustained selling pressure, strong trend continuation.',
        candle: i
      });
    }

    // ── Pin Bar (strong rejection) ──
    const tailPct = Math.max(uWick, lWick) / (rng || 1);
    if (tailPct > 0.65 && body < rng * 0.25) {
      const dir = uWick > lWick ? 'bearish' : 'bullish';
      patterns.push({
        name: `Pin Bar (${dir === 'bullish' ? 'Bullish' : 'Bearish'})`,
        type: dir,
        description: `Strong ${dir === 'bullish' ? 'support' : 'resistance'} rejection — price swept a level and snapped back hard.`,
        candle: i
      });
    }
  }

  // Return only the 3 most recent patterns (last candles are most relevant)
  return patterns.slice(-5).reverse();
}

// ── Main Handler ──────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const symbol   = (req.query.symbol   || 'BTCUSDT').toUpperCase();
  const interval = (req.query.interval || '4h');

  const cacheKey = `${symbol}_${interval}`;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].ts < CACHE_TTL) {
    return res.status(200).json({ source: 'cache', ...cache[cacheKey].data });
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=50`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Binance HTTP ${response.status}`);

    const raw = await response.json();

    // Binance kline format: [openTime, open, high, low, close, volume, ...]
    const candles = raw.map(k => ({
      time:   k[0],
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    const patterns = detectPatterns(candles);
    const atr = calculateATR(candles, 14);
    const structure = getMarketStructure(candles);
    const currentPrice = candles[candles.length - 1].close;

    const result = {
      symbol,
      interval,
      candleCount: candles.length,
      currentPrice,
      atr,
      swingHigh: structure.swingHigh,
      swingLow: structure.swingLow,
      patterns,
      // Summary for easy AI injection
      summary: patterns.length > 0
        ? patterns.map(p => `${p.name} (${p.type}): ${p.description}`).join(' | ')
        : 'No significant candlestick pattern detected on this timeframe.'
    };

    cache[cacheKey] = { ts: Date.now(), data: result };

    return res.status(200).json({ source: 'fresh', ...result });
  } catch (err) {
    console.error('Candle API Error:', err.message);
    if (cache[cacheKey]) {
      return res.status(200).json({ source: 'stale-cache', ...cache[cacheKey].data });
    }
    return res.status(500).json({ error: 'Failed to fetch candle data', details: err.message });
  }
}
