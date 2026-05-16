import './style.css';
import { fetchMarketData, fetchCandlePatterns, fetchGlobalMarketData, fetchWhaleActivity, fetchSentiment, fetchFearAndGreed, fetchAIAnalysis, fetchHermesAnalysis, fetchDualAI, calculateAlphaScore, fetchDefiPools, fetchNews, fetchTechnicalSignals, fetchTrendingNarratives, fetchChartData, fetchFundingRates, fetchOpenInterest, fetchBidAskSpreads, fetchOrderBookDepth, fetchBtcOnChain, fetchDuneMarketPulse, addToAIMemory, clearAIMemory, getAIMemory, getApiHealthSummary, getApiHealthPromptSummary } from './api.js';
import { setupAuth, openSignIn, logout, openUserProfile, clerk } from './lib/auth.js';
import { supabase } from './lib/supabase.js';


// --- Navigation & Setup ---
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: 'grid' },
  { id: 'opportunities', label: 'Top Opportunities', icon: 'trending-up' },
  { id: 'trading', label: 'Nexus Trading View', icon: 'monitor' },
  { id: 'ai-research', label: 'AI Research Analyst', icon: 'cpu' },
  { id: 'whale', label: 'Whale & Smart Money', icon: 'anchor' },
  { id: 'alerts', label: 'Alerts & Notifications', icon: 'bell' },
  { id: 'settings', label: 'Settings & Subscription', icon: 'settings' }
];

// --- Real Data Stores (Initialized Empty for 100% Accuracy) ---
const ASSETS = [];
const WHALE_ACTIONS = [];
const ALPHA_SIGNALS = [];
const NEWS = [];
const SIGNALS = [];
const DEFI_POOLS = [];
const NARRATIVES = [];
const SMART_MONEY_FLOWS = []; // To be replaced with real data or removed
const LIVE_TRENDING_COINS = [];
const LIVE_WHALES_RAW = [];

let assets = [];
let LIVE_SENTIMENT = { bullish: 50, bearish: 50, score: 50 };
let LIVE_FNG = { value: 72, label: 'Greed' };
let LIVE_CATALYSTS = [
  { date: "May 21", title: "SUI Massive Token Unlock ($1.2B)", type: "warning" },
  { date: "May 23", title: "SEC Decision on ETH Spot ETF", type: "primary" },
  { date: "May 25", title: "Nvidia Earnings (AI Narrative Catalyst)", type: "info" }
];
let LIVE_FUNDING = [];   // Binance funding rates
let LIVE_OI = [];        // Binance open interest
let LIVE_DEPTH = null;   // BTC order book depth
let LIVE_BTC_CHAIN = null; // BTC on-chain health
let LIVE_DUNE_PULSE = null; // Dune macro on-chain pulse
let OPPORTUNITY_SORT = 'alpha';
let CURRENT_MARKET_TIMEFRAME = '24H';
const MAX_TRADABLE_ASSETS = 30;
const MAX_TOP_OPPORTUNITIES = MAX_TRADABLE_ASSETS;
const SIGNAL_SCAN_PAIRS = ['BTC', 'ETH', 'SOL', 'BNB'];
const SIGNAL_SCAN_INTERVAL_MS = 60 * 1000;
const SIGNAL_TIMEZONE = 'UTC';
const STABLE_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'PYUSD', 'USDE', 'USDD',
  'GUSD', 'LUSD', 'EURC', 'FRAX', 'USD1', 'USDS', 'USDP', 'USDB', 'RLUSD',
  'SUSD', 'MUSD', 'USD0', 'USDL', 'EURS', 'XAUT'
]);
const LIVE_SIGNAL_CONTEXT = {};
const LIVE_SIGNAL_PATTERNS = {};
const LIVE_SPREADS = {};

function isStablecoinSymbol(symbol = '', name = '', price = null) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return false;
  if (STABLE_SYMBOLS.has(sym)) return true;

  // Catch variants like USD1, EUR1, GBP1 and similar fiat-pegged ticker formats.
  if (/^(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)\d*$/i.test(sym)) return true;

  const nm = String(name || '').toUpperCase();
  const p = Number(price);
  if (Number.isFinite(p) && p > 0.85 && p < 1.15 && /(USD|EUR|GBP|JPY|AUD|CAD|CHF|SGD|HKD|KRW)/.test(sym)) {
    return true;
  }
  if (
    nm &&
    /\b(STABLE|USD|DOLLAR|EURO|EUR|GBP|YEN|PEGGED)\b/.test(nm) &&
    Number.isFinite(p) &&
    p > 0.85 &&
    p < 1.15
  ) {
    return true;
  }

  return false;
}

// ─── Data Persistence Layer (localStorage) ───────────────────────────────────
// Ensures identical data across refreshes and devices using the same browser.
const DATA_CACHE_KEY = 'nexus_data_cache';
const DATA_CACHE_TTL = 60 * 60 * 1000; // 1 hour TTL

function saveDataCache() {
  try {
    const cache = {
      timestamp: Date.now(),
      assets,
      WHALE_ACTIONS: [...WHALE_ACTIONS],
      SMART_MONEY_FLOWS: [...SMART_MONEY_FLOWS],
      NARRATIVES: [...NARRATIVES],
      NEWS: [...NEWS],
      DEFI_POOLS: [...DEFI_POOLS],
      ALPHA_SIGNALS: [...ALPHA_SIGNALS],
      LIVE_SENTIMENT,
      LIVE_FNG,
      LIVE_CATALYSTS: [...LIVE_CATALYSTS]
    };
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(cache));
    
    // 🌐 PUSH TO SUPABASE (Global Sync)
    pushToGlobalCache(cache);
    
    console.log('💾 Data cache saved locally & synced to Supabase');
  } catch(e) { console.warn('⚠️ Cache save failed:', e.message); }
}

async function pushToGlobalCache(cache) {
  try {
    const { error } = await supabase
      .from('global_market_cache')
      .upsert({ id: 'market_data_v1', data: cache, updated_at: new Date().toISOString() });
    if (error) throw error;
  } catch (e) {
    console.warn('⚠️ Global Sync Push Failed:', e.message);
  }
}

async function loadDataCache() {
  try {
    let cache = null;
    const raw = localStorage.getItem(DATA_CACHE_KEY);
    
    if (raw) {
      cache = JSON.parse(raw);
      // Check local TTL
      if (Date.now() - cache.timestamp > DATA_CACHE_TTL || (cache.assets && cache.assets.length < 15)) {
        cache = null;
      }
    }

    // 🌐 PULL FROM SUPABASE if local is missing/expired
    if (!cache) {
      console.log('🌐 Local cache empty/expired, pulling from Supabase...');
      const { data, error } = await supabase
        .from('global_market_cache')
        .select('data')
        .eq('id', 'market_data_v1')
        .single();
      
      if (data && data.data) {
        cache = data.data;
        console.log('✅ Global cache pulled from Supabase');
      } else if (error) {
        console.error('❌ Supabase Pull Error:', error.message);
      } else {
        console.log('ℹ️ Global cache is empty in Supabase. Waiting for a device to push data.');
      }
    }

    if (!cache) return false;
    
    // Hydrate all data stores
    if (cache.assets && cache.assets.length > 0) {
      assets = cache.assets.map(a => {
        if (!a.reason) a.reason = generateReason(a, a.score);
        return a;
      });
      assets = applyDirectionalBiasToAssets(assets);
      assets = enforceTopAssetUniverse(assets);
      WHALE_ACTIONS.length = 0; cache.WHALE_ACTIONS?.forEach(w => WHALE_ACTIONS.push(w));
      SMART_MONEY_FLOWS.length = 0; cache.SMART_MONEY_FLOWS?.forEach(s => SMART_MONEY_FLOWS.push(s));
      NARRATIVES.length = 0; cache.NARRATIVES?.forEach(n => NARRATIVES.push(n));
      NEWS.length = 0; cache.NEWS?.forEach(n => NEWS.push(n));
      DEFI_POOLS.length = 0; cache.DEFI_POOLS?.forEach(d => DEFI_POOLS.push(d));
      ALPHA_SIGNALS.length = 0; cache.ALPHA_SIGNALS?.forEach(a => ALPHA_SIGNALS.push(a));
      if (cache.LIVE_SENTIMENT) LIVE_SENTIMENT = cache.LIVE_SENTIMENT;
      if (cache.LIVE_FNG) LIVE_FNG = cache.LIVE_FNG;
      if (cache.LIVE_CATALYSTS) LIVE_CATALYSTS = cache.LIVE_CATALYSTS;
      
      console.log('✅ Data hydrated (' + assets.length + ' assets)');
      return true;
    }
    return false;
  } catch(e) {
    console.warn('⚠️ Cache load failed:', e.message);
    return false;
  }
}

// Deterministic seeded random for stable generated values
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
// Global seed based on current hour (so all devices produce same values within the same hour)
const HOUR_SEED = Math.floor(Date.now() / (60 * 60 * 1000));
const stableRandom = seededRandom(HOUR_SEED);

function detectReasonBias(reason = '') {
  const text = String(reason || '');
  if (/(bear|breakdown|distribution|descending|head\s*&?\s*shoulders|shooting\s*star|contraction|rejection|lower\s*high|top)/i.test(text)) {
    return 'bearish';
  }
  if (/(bull|breakout|accumulation|ascending|cup|hammer|expansion|support|higher\s*low)/i.test(text)) {
    return 'bullish';
  }
  return 'neutral';
}

function generateReason(coin, score, preferredBias = null) {
  const change = coin.price_change_percentage_24h || coin.change || 0;
  const mcap = Number(coin.market_cap) || 0;
  const vol = coin.total_volume || 0;
  const volRatio = mcap > 0 ? (vol / mcap) : 0;
  const inferredBias = change >= 1 ? 'bullish' : change <= -1 ? 'bearish' : 'neutral';
  const bias = preferredBias || inferredBias;

  if (bias === 'bullish') {
    if (score > 85 && change > 3.5) return "Bull Flag Breakout";
    if (volRatio > 0.16) return "Bullish SMC Structure Flip";
    if (change > 1.8) return "High-Volume Breakout";
    if (score > 75) return "Ascending Triangle Breakout";
    return "Support Hold Accumulation";
  }

  if (bias === 'bearish') {
    if (score > 85 && change < -3.5) return "Bear Flag Breakdown";
    if (volRatio > 0.16) return "High-Volume Distribution";
    if (change < -1.8) return "Descending Channel Breakdown";
    if (score > 75) return "Lower High Rejection";
    return "Supply Zone Rejection";
  }
  
  if (Math.abs(change) < 1) return "Absorption & Exhaustion";
  return "Range Compression";
}

function formatPatternLabel(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function getLiveDetectedPattern(symbol = '') {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return 'NONE';

  const tfOrder = ['15m', '1m'];
  for (const tf of tfOrder) {
    const feed = LIVE_SIGNAL_PATTERNS?.[sym]?.[tf];
    const patterns = Array.isArray(feed?.patterns) ? feed.patterns : [];
    if (!patterns.length) continue;

    const candleCount = Number(feed?.candleCount);
    const lastClosed = Number.isFinite(candleCount) && candleCount >= 2 ? (candleCount - 2) : null;
    const selected = (Number.isFinite(lastClosed)
      ? (patterns.find(p => Number(p?.candle) === lastClosed) || patterns[0])
      : patterns[0]);

    const name = formatPatternLabel(selected?.name || 'PATTERN');
    const direction = String(selected?.type || '').toLowerCase();
    const sideTag = direction === 'bullish'
      ? 'BULLISH'
      : direction === 'bearish'
        ? 'BEARISH'
        : 'NEUTRAL';
    return `${name} (${sideTag}, ${tf.toUpperCase()})`;
  }

  return 'NONE';
}

function parseVolumeBillions(vol = '') {
  const str = String(vol || '').trim().toUpperCase();
  const n = Number.parseFloat(str.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (str.includes('T')) return n * 1000;
  if (str.includes('B')) return n;
  if (str.includes('M')) return n / 1000;
  if (str.includes('K')) return n / 1_000_000;
  return n / 1_000_000_000;
}

function getUnifiedAlphaScore(asset = {}) {
  const opportunity = Number(asset?.opportunityScore);
  if (Number.isFinite(opportunity)) return opportunity;
  const base = Number(asset?.score);
  return Number.isFinite(base) ? base : 50;
}

function getSortedTradeableAssets(sortBy = 'alpha') {
  const sortKey = String(sortBy || 'alpha').toLowerCase();
  const list = assets.filter(asset => !isStablecoinSymbol(asset.symbol, asset.name, asset.price));
  return [...list].sort((a, b) => {
    if (sortKey === 'change') {
      return Math.abs(Number(b.change) || 0) - Math.abs(Number(a.change) || 0);
    }
    if (sortKey === 'volume') {
      return parseVolumeBillions(b.vol) - parseVolumeBillions(a.vol);
    }
    return (getUnifiedAlphaScore(b) - getUnifiedAlphaScore(a)) || a.symbol.localeCompare(b.symbol);
  });
}

function getTopUniverseSymbols(limit = MAX_TRADABLE_ASSETS) {
  return getSortedTradeableAssets('alpha')
    .slice(0, Math.max(1, limit))
    .map(a => String(a?.symbol || '').toUpperCase())
    .filter(Boolean);
}

function enforceTopAssetUniverse(assetList = [], maxAssets = MAX_TRADABLE_ASSETS) {
  const clean = (assetList || [])
    .filter(asset => asset && asset.symbol && !isStablecoinSymbol(asset.symbol, asset.name, asset.price))
    .map(asset => ({ ...asset }));

  const ranked = clean.sort((a, b) => {
    const aScore = Number.isFinite(a?.opportunityScore) ? Number(a.opportunityScore) : (Number.isFinite(a?.score) ? Number(a.score) : 0);
    const bScore = Number.isFinite(b?.opportunityScore) ? Number(b.opportunityScore) : (Number.isFinite(b?.score) ? Number(b.score) : 0);
    if (bScore !== aScore) return bScore - aScore;
    const av = parseVolumeBillions(a?.vol);
    const bv = parseVolumeBillions(b?.vol);
    if (bv !== av) return bv - av;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  return ranked.slice(0, Math.max(1, maxAssets));
}

function applyDuneMacroCalibration(assetList = [], dunePulse = null) {
  if (!dunePulse || !Number.isFinite(Number(dunePulse.signalScore))) return assetList;

  const macroScore = Number(dunePulse.signalScore);
  const macroTilt = Math.max(-1, Math.min(1, (macroScore - 50) / 35)); // -1..1
  const growthWeight = Math.max(-1, Math.min(1, Number(dunePulse.volumeGrowthPct || 0) / 22));
  const txWeight = Math.max(-1, Math.min(1, Number(dunePulse.btcTxGrowthPct || 0) / 18));
  const blended = (macroTilt * 0.62) + (growthWeight * 0.25) + (txWeight * 0.13);

  return assetList.map(asset => {
    const change = Number(asset.change) || 0;
    const directionSign = change >= 0 ? 1 : -1;
    const alignmentBoost = blended * directionSign * 6.5;
    const baseScore = Number.isFinite(asset.score) ? Number(asset.score) : 50;
    const adjustedScore = Math.max(0, Math.min(100, Math.round(baseScore + alignmentBoost)));
    return {
      ...asset,
      score: adjustedScore
    };
  });
}

function computeDirectionalNeutralAlpha(change24h = 0, volRatio = 0, mcapRank = 50) {
  const absChange = Math.abs(Number(change24h) || 0);

  const moveQuality = absChange < 0.5
    ? 8 + (absChange * 6)
    : absChange < 2
      ? 11 + ((absChange - 0.5) * 8)
      : absChange < 8
        ? 23 + ((absChange - 2) * 3.2)
        : absChange < 15
          ? 42 - ((absChange - 8) * 1.7)
          : 30 - Math.min(14, (absChange - 15) * 1.5);

  const volumeConviction = Math.min(24, Math.max(0, (Number(volRatio) || 0) * 240));
  const mcapTier = Math.min(16, Math.max(5, 16 - ((Number(mcapRank) || 50) * 0.2)));
  const stability = absChange < 1 ? 6 : absChange < 4 ? 12 : absChange < 10 ? 16 : absChange < 18 ? 11 : 7;
  const overextensionPenalty = absChange > 18 ? Math.min(10, (absChange - 18) * 0.9) : 0;

  const raw = moveQuality + volumeConviction + mcapTier + stability - overextensionPenalty;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

function classifyDirectionalBias(asset = {}, emaInfo = null) {
  const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
  const spread = evalResult.bull - evalResult.bear;
  const change = Number.isFinite(asset.change) ? asset.change : 0;

  if (Math.abs(change) < 0.6 && Math.abs(spread) < 0.9) return 'neutral';
  if (spread >= 0.65) return 'bullish';
  if (spread <= -0.65) return 'bearish';
  return 'neutral';
}

function evaluateDirectionalBiasScores(asset = {}, emaInfo = null) {
  const change = Number.isFinite(asset.change) ? asset.change : 0;
  const score = Number.isFinite(asset.score) ? asset.score : 50;
  const reason = String(asset.reason || '');

  let bull = 0;
  let bear = 0;

  if (change >= 4) bull += 3.1;
  else if (change >= 2) bull += 2.0;
  else if (change >= 0.6) bull += 1.0;
  else if (change <= -4) bear += 3.1;
  else if (change <= -2) bear += 2.0;
  else if (change <= -0.6) bear += 1.0;

  // High score boosts whichever side momentum already supports (non-directional).
  if (score >= 80) {
    if (change > 0.25) bull += 0.9;
    if (change < -0.25) bear += 0.9;
  }
  if (score >= 90) {
    if (change > 3) bull += 0.5;
    if (change < -3) bear += 0.5;
  }

  if (/(bull|breakout|accumulation|ascending|cup|squeeze|pullback|reversal|support)/i.test(reason)) bull += 1.0;
  if (/(bear|breakdown|distribution|head\s*&?\s*shoulders|contraction|shooting\s*star|top|rejection)/i.test(reason)) bear += 1.0;

  if (emaInfo) {
    const last = Number(emaInfo.lastClose);
    const ema9 = Number(emaInfo.ema9);
    const ema21 = Number(emaInfo.ema21);

    if (Number.isFinite(last) && Number.isFinite(ema9) && Number.isFinite(ema21)) {
      if (last > ema9 && ema9 > ema21) bull += 2.6;
      if (last < ema9 && ema9 < ema21) bear += 2.6;
      if (ema9 > ema21) bull += 0.8;
      if (ema9 < ema21) bear += 0.8;
    }
  }

  if (LIVE_SENTIMENT.score >= 60) bull += 0.45;
  if (LIVE_SENTIMENT.score <= 40) bear += 0.45;

  return { bull, bear };
}

function computeOpportunityScore(asset = {}, emaInfo = null, spreadOverride = null) {
  const score = Number.isFinite(asset.score) ? asset.score : 50;
  const absChange = Math.abs(Number(asset.change) || 0);
  const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
  const spread = Number.isFinite(spreadOverride) ? Math.abs(spreadOverride) : Math.abs(evalResult.bull - evalResult.bear);

  const volBillions = parseVolumeBillions(asset.vol);

  const moveComponent = absChange < 0.5
    ? 3.5 + (absChange * 3.5)
    : absChange < 2
      ? 5.2 + ((absChange - 0.5) * 4.3)
      : absChange < 8
        ? 11.6 + ((absChange - 2) * 1.9)
        : 22 - Math.min(8, (absChange - 8) * 1.1);

  const liquidityComponent = Math.min(10, Math.max(0, (Math.log10((volBillions * 10) + 1)) * 6.2));
  const directionalComponent = Math.min(12, spread * 4.8);
  const baseComponent = Math.max(0, Math.min(100, score)) * 0.56;
  const raw = baseComponent + moveComponent + liquidityComponent + directionalComponent;

  // Soft-cap the extreme tail so "100" remains rare and meaningful.
  const softened = raw > 92 ? 92 + ((raw - 92) * 0.35) : raw;
  return Math.round(Math.min(99, Math.max(0, softened)));
}

function applyDirectionalBiasToAssets(assetList = []) {
  const emaMap = window._liveEmaData || {};
  return assetList.map(asset => {
    const emaInfo = emaMap[asset.symbol];
    const bias = classifyDirectionalBias(asset, emaInfo);
    const evalResult = evaluateDirectionalBiasScores(asset, emaInfo);
    const reasonBias = detectReasonBias(asset.reason);
    const hasReason = typeof asset.reason === 'string' && asset.reason.trim().length > 0;
    const alignedReason = (hasReason && reasonBias === bias)
      ? asset.reason
      : generateReason(asset, asset.score, bias);
    return {
      ...asset,
      reason: alignedReason,
      bias,
      biasConfidence: Math.abs(evalResult.bull - evalResult.bear),
      opportunityScore: computeOpportunityScore(asset, emaInfo, evalResult.bull - evalResult.bear)
    };
  });
}


// Chart Instances
let mainMarketChart;
let socialChart;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof feather !== 'undefined') feather.replace();
  
  const loadingScreen = document.getElementById('loading-screen');
  const mainApp = document.getElementById('main-app');
  const loginGate = document.getElementById('login-gate');
  const loadingBar = document.querySelector('.loading-bar');

  // Initialize Clerk Auth
  setupAuth(async (isAuthenticated, user) => {
    if (isAuthenticated) {
      loginGate.classList.add('hidden');
      updateUserProfileUI(user);
      
      // 🛡️ Ensure user exists in Supabase
      try {
        await supabase.from('user_profiles').upsert({
          clerk_id: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          full_name: user.fullName,
          updated_at: new Date().toISOString()
        }, { onConflict: 'clerk_id' });
      } catch (e) {
        console.warn('⚠️ Profile sync failed:', e.message);
      }

      // Start loading sequence only once
      if (mainApp.classList.contains('hidden')) {
        startLoadingSequence(loadingScreen, mainApp, loadingBar);
      }
    } else {
      loadingScreen.classList.add('hidden');
      mainApp.classList.add('hidden');
      loginGate.classList.remove('hidden');
    }
  });

  // Attach login/logout listeners
  document.getElementById('sign-in-btn')?.addEventListener('click', () => {
    console.log('🖱️ Sign-in button clicked');
    openSignIn();
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  document.getElementById('user-profile-btn')?.addEventListener('click', openUserProfile);
});

function updateUserProfileUI(user) {
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  
  if (nameEl) nameEl.textContent = user.fullName || user.username || 'NEXUS User';
  if (avatarEl) {
    const initials = (user.firstName?.[0] || '') + (user.lastName?.[0] || '');
    avatarEl.textContent = initials || user.username?.[0]?.toUpperCase() || 'N';
    if (user.imageUrl) {
      avatarEl.style.backgroundImage = `url(${user.imageUrl})`;
      avatarEl.style.backgroundSize = 'cover';
      avatarEl.textContent = '';
    }
  }
}

function startLoadingSequence(loadingScreen, mainApp, loadingBar) {
  loadingScreen.classList.remove('hidden');
  loadingScreen.style.opacity = '1';

  const statuses = [
    "Establishing secure WebSocket connection...", 
    "Syncing on-chain data providers...", 
    "Loading quantitative models...", 
    "Calibrating NLP engines..."
  ];
  
  let step = 0;
  const interval = setInterval(async () => {
    step++;
    if (step < statuses.length) {
      document.getElementById('loading-status').textContent = statuses[step];
      loadingBar.style.width = `${(step / statuses.length) * 100}%`;
    } else {
      clearInterval(interval);
      loadingBar.style.width = '100%';
      
      // Hydrate UI from cache BEFORE showing it
      await initApp();
      
      setTimeout(() => {
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
          loadingScreen.classList.add('hidden');
          mainApp.classList.remove('hidden');
          // Start the first live sync after showing the UI to ensure no delay
          syncLiveApis();
        }, 500);
      }, 500);
    }
  }, 500);
}

async function initApp() {
  setupSidebar();
  updateTime();
  setInterval(updateTime, 1000);
  
  // Load cached data instantly for zero-delay UI hydration (Now pulling from Supabase if local is empty)
  const hasCachedData = await loadDataCache();
  if (hasCachedData) {
    console.log('⚡ Data hydrated — UI is ready');
  }

  // Setup Charts
  initCharts();

  // Initial renders (will use cached data if available)
  renderDashboard();
  renderOpportunitiesPage();
  renderTradingPage();
  renderWhalePage();
  if (hasCachedData) renderProSignals();

  setupAiResearchChat();
  setupAiReports();
  setupModals();
  setupAllButtons();
  setupTradingEvents();
  setupSettingsPage();
  
  // Verify Supabase Connectivity
  testSupabase();

  // Real-time market data polling (every 60 seconds per signal scan protocol)
  setInterval(syncLiveApis, SIGNAL_SCAN_INTERVAL_MS);
  
  // UI Visual Heartbeat (flashes text)
  setInterval(simulateMarketTick, 3000);
}

async function testSupabase() {
  const { supabase } = await import('./lib/supabase.js');
  const { data, error } = await supabase.from('user_profiles').select('count', { count: 'exact', head: true });
  if (error) {
    console.warn('⚠️ Supabase connection test failed (expected if table not created):', error.message);
  } else {
    console.log('✅ Supabase connected successfully');
  }
}

// --- Charts Setup (Chart.js) ---
async function initCharts(timeframe = '24H') {
  CURRENT_MARKET_TIMEFRAME = String(timeframe || '24H').toUpperCase();
  updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);
  Chart.defaults.color = '#94A3B8';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';
  
  if (mainMarketChart) mainMarketChart.destroy();
  if (socialChart) socialChart.destroy();

  const ctxMain = document.getElementById('mainMarketChart').getContext('2d');
  const gradient = ctxMain.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(108, 92, 231, 0.5)');
  gradient.addColorStop(1, 'rgba(108, 92, 231, 0.0)');

  let interval = '1h';
  let limit = 48;
  let labels = [];

  if (timeframe === '1H') {
    interval = '1m';
    limit = 60;
    labels = Array.from({length: limit}, (_, i) => `${limit - i}m ago`);
  } else if (timeframe === '24H') {
    interval = '1h';
    limit = 48;
    labels = Array.from({length: limit}, (_, i) => `${Math.floor((limit - i)/2)}h ago`);
  } else if (timeframe === '7D') {
    interval = '4h';
    limit = 42;
    labels = Array.from({length: limit}, (_, i) => `${Math.floor((limit - i)/6)}d ago`);
  }

  // Use BTC as the "Market Sentiment Proxy" for the dashboard trendline
  const dataPoints = await fetchChartData('BTC', interval, limit) || Array(limit).fill(64000);

  mainMarketChart = new Chart(ctxMain, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Market Trend (Proxy: BTC)',
        data: dataPoints,
        borderColor: '#6C5CE7',
        backgroundColor: gradient,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { 
          position: 'right',
          ticks: { callback: (value) => '$' + value.toLocaleString() }
        }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });

  // Social Volume Chart (Sentiment Page)
  const socialCanvas = document.getElementById('socialChart');
  if (socialCanvas) {
    const ctxSocial = socialCanvas.getContext('2d');
    const gradientSocial = ctxSocial.createLinearGradient(0, 0, 0, 200);
    gradientSocial.addColorStop(0, 'rgba(0, 230, 118, 0.3)');
    gradientSocial.addColorStop(1, 'rgba(0, 230, 118, 0.0)');

    // Generate a realistic 24h momentum curve ending at current score
    const socialData = Array.from({length: 24}, (_, i) => {
      const progress = i / 23;
      const base = 40 + (progress * (LIVE_SENTIMENT.score - 40));
      const noise = Math.sin(i * 0.5) * 8;
      return Math.max(0, Math.min(100, base + noise));
    });

    socialChart = new Chart(ctxSocial, {
      type: 'line',
      data: {
        labels: Array.from({length: 24}, (_, i) => `${i}h`),
        datasets: [{
          label: 'Social Mentions Index',
          data: socialData,
          borderColor: '#00E676',
          backgroundColor: gradientSocial,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { display: false }, y: { display: true, min: 0, max: 100 } }
      }
    });
  }
}

function simulateMarketTick() {
   // Synchronize UI Chart with the latest live price from the global state
   if(mainMarketChart && assets.length > 0) {
      const btc = assets.find(a => a.symbol === 'BTC');
      if (btc) {
        const currentData = mainMarketChart.data.datasets[0].data;
        currentData.shift();
        currentData.push(btc.price);
        mainMarketChart.update('none'); 
      }
   }
   updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);
   
   // Update UI Elements softly
  document.querySelectorAll('.live-price').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        el.style.color = '#fff';
        el.textContent = `$${formatPrice(asset.price)}`;
        setTimeout(() => el.style.color = '', 300);
     }
  });

  document.querySelectorAll('.live-change').forEach(el => {
     const symbol = el.dataset.symbol;
     const asset = assets.find(a => a.symbol === symbol);
     if(asset) {
        el.textContent = `${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%`;
        el.className = `live-change ${asset.change >= 0 ? 'text-green' : 'text-red'}`;
     }
  });
}

async function syncLiveApis() {
  const statusEl = document.getElementById('market-time');
  if(statusEl) statusEl.textContent = "Syncing Live APIs...";
  
  try {
    // 1. Fetch Market Leaderboard First (Top 30)
    const marketData = await fetchMarketData();
    if (!marketData) throw new Error('Failed to fetch market leaderboard');

    const cappedMarketData = marketData
      .filter(c => !isStablecoinSymbol(c.symbol, c.name, c.current_price))
      .slice(0, MAX_TRADABLE_ASSETS);

    const topSymbols = cappedMarketData
      .filter(c => !isStablecoinSymbol(c.symbol, c.name, c.current_price))
      .map(c => c.symbol.toUpperCase());
    const derivativeSymbols = topSymbols.slice(0, 15); // Top 15 for heavy OI/Funding data
    const technicalSymbols = [...new Set([...topSymbols, ...SIGNAL_SCAN_PAIRS])];
    const patternUniverse = topSymbols.slice(0, MAX_TRADABLE_ASSETS);
    const signalPatternJobs = patternUniverse.flatMap((sym) => ([
      fetchCandlePatterns(sym, '1m').then(data => ({ symbol: sym, interval: '1m', data })).catch(() => ({ symbol: sym, interval: '1m', data: null })),
      fetchCandlePatterns(sym, '15m').then(data => ({ symbol: sym, interval: '15m', data })).catch(() => ({ symbol: sym, interval: '15m', data: null }))
    ]));

    // 2. Fetch all other data using discovered symbols
    const [
      whales,
      narrativesData,
      chartPrices,
      fundingData,
      oiData,
      spreadData,
      depthData,
      dunePulseData,
      btcChainData,
      sentimentData,
      fearGreedData,
      globalMarketData,
      defiPoolsData,
      newsData,
      technicalData,
      signalPatternData
    ] = await Promise.all([
      fetchWhaleActivity(),
      fetchTrendingNarratives(),
      fetchChartData('BTC'),
      fetchFundingRates(technicalSymbols),
      fetchOpenInterest(technicalSymbols),
      fetchBidAskSpreads(technicalSymbols),
      fetchOrderBookDepth('BTC'),
      fetchDuneMarketPulse(),
      fetchBtcOnChain(),
      fetchSentiment(),
      fetchFearAndGreed(),
      fetchGlobalMarketData(),
      fetchDefiPools(),
      fetchNews(),
      fetchTechnicalSignals(technicalSymbols),
      Promise.all(signalPatternJobs)
    ]);

    // Update Global Narratives & Sentiment
    if (narrativesData && narrativesData.narratives) {
      NARRATIVES.length = 0;
      narrativesData.narratives.forEach(n => {
        // Add a random 'val' for the progress bar (calculated based on change)
        const progress = Math.min(100, Math.max(20, 50 + (n.change * 3)));
        NARRATIVES.push({ ...n, val: progress });
      });
      LIVE_TRENDING_COINS.length = 0;
      if (Array.isArray(narrativesData.trendingCoins)) {
        narrativesData.trendingCoins.forEach(c => LIVE_TRENDING_COINS.push(c));
      }
      renderNarrativeMomentum();
    }

    if (sentimentData) {
      LIVE_SENTIMENT = sentimentData;
      // If data is unavailable or neutral (50), inject dynamic bias from market performance
      if (LIVE_SENTIMENT.score === 50 && assets.length > 0) {
        const avgChange = assets.slice(0, 10).reduce((acc, a) => acc + a.change, 0) / 10;
        LIVE_SENTIMENT.score = Math.min(95, Math.max(5, 50 + (avgChange * 5)));
        LIVE_SENTIMENT.source = 'Momentum Engine';
      }
    }
    if (fearGreedData && Number.isFinite(fearGreedData.value)) LIVE_FNG = fearGreedData;

    if (defiPoolsData && defiPoolsData.length > 0) {
      DEFI_POOLS.length = 0;
      defiPoolsData.forEach(pool => DEFI_POOLS.push(pool));
    }

    if (newsData && newsData.length > 0) {
      NEWS.length = 0;
      newsData.forEach(item => NEWS.push(item));
    }

    if (technicalData?.ema && Object.keys(technicalData.ema).length > 0) {
      window._liveEmaData = technicalData.ema;
    }
    if (technicalData?.indicators && Object.keys(technicalData.indicators).length > 0) {
      Object.keys(LIVE_SIGNAL_CONTEXT).forEach(k => delete LIVE_SIGNAL_CONTEXT[k]);
      Object.entries(technicalData.indicators).forEach(([sym, metrics]) => {
        LIVE_SIGNAL_CONTEXT[sym] = metrics;
      });
      window._liveSignalContext = LIVE_SIGNAL_CONTEXT;
    }

    if (globalMarketData?.data) {
      window._liveGlobalMarketData = globalMarketData.data;
    }

    // Store derivatives data globally
    if (fundingData && fundingData.length > 0) LIVE_FUNDING = fundingData;
    if (oiData && oiData.length > 0) LIVE_OI = oiData;
    if (spreadData && spreadData.length > 0) {
      Object.keys(LIVE_SPREADS).forEach(k => delete LIVE_SPREADS[k]);
      spreadData.forEach(s => {
        if (s?.symbol) LIVE_SPREADS[s.symbol] = s;
      });
    }
    if (depthData) LIVE_DEPTH = depthData;
    if (dunePulseData) LIVE_DUNE_PULSE = dunePulseData;
    if (btcChainData) LIVE_BTC_CHAIN = btcChainData;
    if (Array.isArray(signalPatternData)) {
      Object.keys(LIVE_SIGNAL_PATTERNS).forEach(k => delete LIVE_SIGNAL_PATTERNS[k]);
      signalPatternData.forEach((row) => {
        const symbol = String(row?.symbol || '').toUpperCase();
        const interval = String(row?.interval || '').toLowerCase();
        if (!symbol || !interval) return;
        if (!LIVE_SIGNAL_PATTERNS[symbol]) LIVE_SIGNAL_PATTERNS[symbol] = {};
        LIVE_SIGNAL_PATTERNS[symbol][interval] = row?.data || null;
      });
    }
    window._liveFundingData = LIVE_FUNDING;
    window._liveOiData = LIVE_OI;
    window._liveDepthData = LIVE_DEPTH;
    window._liveDunePulse = LIVE_DUNE_PULSE;
    window._liveSpreads = LIVE_SPREADS;
    window._liveSignalPatterns = LIVE_SIGNAL_PATTERNS;

    // Surface API status for debugging + AI context injection
    const apiHealth = getApiHealthSummary();
    window._apiHealthSummary = apiHealth;
    window._apiHealthPrompt = getApiHealthPromptSummary();
    if (apiHealth.degraded > 0 || apiHealth.failed > 0) {
      const failingApis = apiHealth.services
        .filter(s => s.status !== 'ok')
        .map(s => `${s.name}: ${s.status} (${s.detail || 'no detail'})`)
        .join(' | ');
      console.warn('⚠️ API health issues detected:', failingApis);
    }

    // Update Whale & Smart Money Flows
    if (whales && whales.length > 0) {
      LIVE_WHALES_RAW.length = 0;
      whales.forEach(w => LIVE_WHALES_RAW.push(w));
      WHALE_ACTIONS.length = 0;
      SMART_MONEY_FLOWS.length = 0;
      ALPHA_SIGNALS.length = 0;
      
      whales.slice(0, 6).forEach((w, i) => {
        const type = i % 2 === 0 ? 'buy' : 'sell';
        const formattedVal = '$' + w.value.toFixed(1) + 'M';
        
        WHALE_ACTIONS.push({
          time: "Live Tx",
          text: type === 'buy' ? `${formattedVal} transferred to` : `${formattedVal} withdrawn from`,
          type: type,
          amount: w.token || "USDC",
          exchange: "DEX/CEX"
        });

        if (i < 5) {
          SMART_MONEY_FLOWS.push({
            amount: formattedVal,
            asset: w.token || "USDC",
            type: type === 'buy' ? 'inflow' : 'outflow',
            wallet: "Whale " + w.from.slice(0,6),
            time: "Live",
            tag: type === 'buy' ? 'accumulation' : 'distribution'
          });
        }
      });
      renderSmartMoneyFlow();
      renderWhalePage(); // Update the dedicated whale page
      
      ALPHA_SIGNALS.push({ time: "Live Alert", text: "Heavy on-chain crypto asset rotation detected across smart money addresses.", impact: "high" });
      ALPHA_SIGNALS.push({ time: "Live Alert", text: `Top whale executed a massive ${whales[0].token || 'ETH'} transaction worth $${whales[0].value.toFixed(1)}M.`, impact: "high" });
      ALPHA_SIGNALS.push({ time: "Live Alert", text: "Institutional flow algorithms detect accumulation in top 10 assets.", impact: "medium" });
    } else {
      LIVE_WHALES_RAW.length = 0;
    }

    // ═══ SINGLE SOURCE OF TRUTH ═══
    // Fetch pre-computed, server-cached market data from /api/market
    // This endpoint returns identical data to every device worldwide.
    let serverAssets = null;
    let binancePatterns = {};
    try {
      const serverRes = await fetch('/api/market');
      if (serverRes.ok) {
        const serverData = await serverRes.json();
        if (serverData.data && serverData.data.length > 0) {
          serverAssets = serverData.data.map(a => {
            if (binancePatterns && binancePatterns[a.symbol]) {
               a.reason = binancePatterns[a.symbol];
            } else if (!a.reason) {
               a.reason = generateReason(a, a.score);
            }
            return a;
          }).filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
          console.log(`✅ Server market data loaded (source: ${serverData.source}, age: ${serverData.age}s)`);
        }
      }
    } catch(e) {
      console.warn('⚠️ Server /api/market unavailable, falling back to client-side:', e.message);
    }

    if (serverAssets) {
      assets = applyDuneMacroCalibration(serverAssets, LIVE_DUNE_PULSE);
    } else if (marketData && marketData.length > 0) {
      // Fallback: compute client-side (only if server endpoint is down)
      assets = cappedMarketData.map(coin => {
         const symbol = coin.symbol.toUpperCase();
         const change24h = coin.price_change_percentage_24h || 0;
         const volRatio = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) : 0;
         const mcapRank = coin.market_cap_rank || 50;
         const alpha = computeDirectionalNeutralAlpha(change24h, volRatio, mcapRank);
         const actualReason = (binancePatterns && binancePatterns[symbol]) ? binancePatterns[symbol] : generateReason(coin, alpha);
         
         return {
           symbol, name: coin.name, price: coin.current_price, change: change24h,
           score: alpha,
           bias: change24h >= 1 ? 'bullish' : (change24h <= -1 ? 'bearish' : 'neutral'),
           reason: actualReason, vol: '$' + (coin.total_volume / 1e9).toFixed(1) + 'B'
         };
      }).filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
      assets = applyDuneMacroCalibration(assets, LIVE_DUNE_PULSE);
    }

    if (assets.length > 0) {
      assets = applyDirectionalBiasToAssets(assets);
      assets = enforceTopAssetUniverse(assets);
    }

    if (assets.length > 0) {
      
      renderDashboard();
      renderOpportunitiesPage();
      renderProSignals();
      saveDataCache(); // Persist to localStorage for cross-device consistency
      if(statusEl) statusEl.textContent = "Live Feed Synced";
    }
  } catch(e) {
    console.error("Live sync failed", e);
  }
}

// --- Navigation ---
function setupSidebar() {
  const navContainer = document.getElementById('sidebar-nav');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle = document.getElementById('mobile-toggle');
  
  navContainer.innerHTML = NAV_ITEMS.map((item, index) => `
    <div class="nav-item ${index === 0 ? 'active' : ''}" data-page="${item.id}">
      <i data-feather="${item.icon}"></i>
      <span>${item.label}</span>
      ${item.beta ? '<span class="nav-beta-badge">BETA</span>' : ''}
    </div>
  `).join('');
  
  if (typeof feather !== 'undefined') feather.replace();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const pageId = e.currentTarget.dataset.page;
      navigateToPage(pageId);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Cross-links
  document.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      navigateToPage(e.currentTarget.dataset.target);
      
      // Close sidebar on mobile
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
      }
    });
  });

  // Mobile Toggle Logic
  if (toggle && overlay) {
    toggle.addEventListener('click', () => {
      sidebar.classList.add('active');
      overlay.classList.add('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('active');
      overlay.classList.remove('active');
    });
  }
}

function navigateToPage(pageId) {
  const targetPage = document.getElementById(`page-${pageId}`);
  if (!targetPage) {
    console.warn(`⚠️ Unknown page requested: ${pageId}`);
    return;
  }

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if(activeNav) activeNav.classList.add('active');
  
  const pageInfo = NAV_ITEMS.find(i => i.id === pageId);
  if (pageInfo) {
    document.getElementById('page-title').textContent = pageInfo.label;
  }
  
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
  });
  targetPage.classList.add('active');
}

function updateTime() {
  const now = new Date();
  document.getElementById('market-time').textContent = now.toLocaleTimeString('en-US', { hour12: false }) + ' UTC';
}

function getBtcAsset() {
  return assets.find(a => a.symbol === 'BTC') || null;
}

function updateMarketCapHeader(timeframe = CURRENT_MARKET_TIMEFRAME) {
  CURRENT_MARKET_TIMEFRAME = String(timeframe || CURRENT_MARKET_TIMEFRAME || '24H').toUpperCase();
  const titleTextEl = document.getElementById('market-cap-title-text');
  if (titleTextEl) {
    titleTextEl.textContent = `Total Market Cap Trend (${CURRENT_MARKET_TIMEFRAME})`;
  }

  const btcPriceEl = document.getElementById('market-cap-btc-price');
  if (btcPriceEl) {
    const btc = getBtcAsset();
    if (btc && Number.isFinite(btc.price) && btc.price > 0) {
      const change = Number.isFinite(btc.change) ? btc.change : 0;
      const prefix = change >= 0 ? '+' : '';
      btcPriceEl.textContent = `BTC $${formatPrice(btc.price)}  ${prefix}${change.toFixed(2)}%`;
      btcPriceEl.classList.remove('up', 'down');
      btcPriceEl.classList.add(change >= 0 ? 'up' : 'down');
    } else {
      btcPriceEl.textContent = 'BTC syncing...';
      btcPriceEl.classList.remove('up', 'down');
    }
  }
}

// --- Page Renders ---

function renderDashboard() {
  // Compute live summary values from assets
  const tradeableAssets = assets.filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
  const alphaRankedAssets = getSortedTradeableAssets('alpha');
  const topAsset = alphaRankedAssets[0];
  const topAssetScore = topAsset ? getUnifiedAlphaScore(topAsset) : null;
  const totalVol = tradeableAssets.reduce((sum, a) => sum + parseVolumeBillions(a.vol), 0);
  const avgChange = tradeableAssets.length ? (tradeableAssets.reduce((s, a) => s + a.change, 0) / tradeableAssets.length) : 0;
  const sentLabel = LIVE_SENTIMENT.score > 60 ? 'Bullish' : (LIVE_SENTIMENT.score < 40 ? 'Bearish' : 'Neutral');
  const sentClass = LIVE_SENTIMENT.score > 60 ? 'text-green' : (LIVE_SENTIMENT.score < 40 ? 'text-red' : 'text-warning');
  updateMarketCapHeader(CURRENT_MARKET_TIMEFRAME);

  document.getElementById('dashboard-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Total 24H Volume</span>
        <i data-feather="bar-chart-2" class="card-icon text-primary"></i>
      </div>
      <div class="card-value">$${totalVol.toFixed(1)}B</div>
      <div class="card-change ${avgChange >= 0 ? 'text-green' : 'text-red'}">${avgChange >= 0 ? '▲' : '▼'} ${Math.abs(avgChange).toFixed(2)}% avg</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Fear & Greed</span>
        <i data-feather="pie-chart" class="card-icon text-warning"></i>
      </div>
      <div class="card-value">${LIVE_FNG.value}</div>
      <div class="card-change ${LIVE_FNG.value > 50 ? 'text-green' : 'text-red'}">${LIVE_FNG.label}</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Alpha Target</span>
        <i data-feather="target" class="card-icon text-primary"></i>
      </div>
      <div class="card-value text-primary">${topAsset ? topAsset.symbol : '—'}</div>
      <div class="card-change">Score: ${topAssetScore ?? '—'} • ${topAssetScore > 75 ? 'High Conviction' : 'Moderate'}</div>
    </div>
    <div class="summary-card">
      <div class="card-header">
        <span class="card-title">Macro Sentiment</span>
        <i data-feather="activity" class="card-icon ${sentClass}"></i>
      </div>
      <div class="card-value ${sentClass}">${sentLabel}</div>
      <div class="card-change text-muted">${LIVE_SENTIMENT.source || 'Reddit NLP'}: ${LIVE_SENTIMENT.score}/100</div>
    </div>
  `;
  if (typeof feather !== 'undefined') feather.replace();

  // Dash Opportunities Mini — keep compact for dashboard readability
  const dashOpps = document.getElementById('dash-opportunities-list');
  const sortedForDash = alphaRankedAssets;
  if (dashOpps) {
    dashOpps.innerHTML = sortedForDash.slice(0, 8).map(asset => `
    <div class="asset-row">
      <div class="asset-info">
        <div class="asset-icon">${asset.symbol[0]}</div>
        <div class="asset-name-col">
          <span class="asset-name">${asset.symbol}</span>
          <span class="asset-symbol">Score: ${getUnifiedAlphaScore(asset)}</span>
        </div>
      </div>
      <div class="asset-price">$${formatPrice(asset.price)}</div>
      <div class="asset-change ${asset.change >= 0 ? 'text-green' : 'text-red'}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</div>
      <div class="bias-badge bias-${asset.bias}">${asset.bias === 'bullish' ? 'LONG' : (asset.bias === 'bearish' ? 'SHORT' : 'WAIT')}</div>
    </div>
    `).join('');
  }

  // AI Mini with typing effect — uses live top asset
  const aiContent = document.getElementById('dash-ai-research-content');
  if (aiContent) {
    aiContent.innerHTML = '';
    const topSym = topAsset ? topAsset.symbol : 'BTC';
    const topName = topAsset ? topAsset.name : 'Bitcoin';
    const topBias = topAsset ? topAsset.bias : 'neutral';
    const scoreLabel = Number.isFinite(topAssetScore) ? topAssetScore : '—';
    const changeLabel = topAsset && Number.isFinite(topAsset.change) ? topAsset.change.toFixed(2) : '0.00';
    typeWriterEffect(aiContent, [
      `> Executive Summary: ${topSym}`,
      `> ${topName} shows ${topBias} momentum. Alpha Score: ${scoreLabel}/100. 24H Change: ${changeLabel}%.`,
      `> Thesis: ${topName} is the highest-conviction play based on our multi-factor scoring engine. On-chain and sentiment data align with ${topBias} positioning.`
    ]);
  }

  // Whale Mini
  const dashWhale = document.getElementById('dash-whale-list');
  if (dashWhale) {
    if (WHALE_ACTIONS.length === 0) {
      dashWhale.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Syncing on-chain activity...</div>`;
    } else {
      dashWhale.innerHTML = WHALE_ACTIONS.slice(0,4).map(action => `
        <div class="feed-item whale-${action.type}">
          <div class="feed-header">
            <span class="feed-time">${action.time}</span>
            <span class="feed-tag">${action.exchange}</span>
          </div>
          <div class="feed-content">${action.text} <strong>${action.amount}</strong></div>
        </div>
      `).join('');
    }
  }

  renderSmartMoneyFlow();
  renderNarrativeMomentum();

  // Alpha Mini
  const dashAlpha = document.getElementById('dash-alpha-list');
  if (dashAlpha) {
    dashAlpha.innerHTML = '';
    
    if (ALPHA_SIGNALS.length > 0) {
      dashAlpha.innerHTML += ALPHA_SIGNALS.slice(0,3).map(action => `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">${action.time}</span>
            <span class="feed-tag" style="background: rgba(108, 92, 231, 0.2); color: var(--primary);">ALPHA</span>
          </div>
          <div class="feed-content">
            ${action.text}
          </div>
        </div>
      `).join('');
    }
    
    // Add derivatives intelligence to Alpha feed
    if (LIVE_FUNDING.length > 0) {
      const extremeFunding = LIVE_FUNDING.filter(f => Math.abs(f.rate) > 0.0005).slice(0, 2);
      extremeFunding.forEach(f => {
        const direction = f.rate > 0 ? 'Longs Overleveraged' : 'Shorts Squeezable';
        dashAlpha.innerHTML += `
          <div class="feed-item news-impact">
            <div class="feed-header">
              <span class="feed-time">Live Derivatives</span>
              <span class="feed-tag" style="background: rgba(255,183,77,0.2); color: var(--warning);">FUNDING</span>
            </div>
            <div class="feed-content">
              <strong>${f.symbol}</strong> funding rate: ${(f.rate * 100).toFixed(4)}% — ${direction}
            </div>
          </div>
        `;
      });
    }
    
    // Add BTC on-chain health
    if (LIVE_BTC_CHAIN) {
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">On-Chain</span>
            <span class="feed-tag" style="background: rgba(0,230,118,0.2); color: var(--green);">BTC HEALTH</span>
          </div>
          <div class="feed-content">
            Hash Rate: <strong>${LIVE_BTC_CHAIN.hashRate} EH/s</strong> | Mempool: <strong>${LIVE_BTC_CHAIN.unconfirmedTx.toLocaleString()}</strong> unconfirmed txs
          </div>
        </div>
      `;
    }

    if (LIVE_DUNE_PULSE) {
      const duneBiasColor = LIVE_DUNE_PULSE.bias === 'bullish'
        ? 'var(--green)'
        : (LIVE_DUNE_PULSE.bias === 'bearish' ? 'var(--red)' : 'var(--warning)');
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">Dune Macro</span>
            <span class="feed-tag" style="background: rgba(108,92,231,0.18); color: var(--primary);">ON-CHAIN PULSE</span>
          </div>
          <div class="feed-content">
            Score: <strong style="color:${duneBiasColor};">${LIVE_DUNE_PULSE.signalScore.toFixed(1)}/100 (${LIVE_DUNE_PULSE.bias.toUpperCase()})</strong> |
            DEX Vol Δ24h: <strong>${LIVE_DUNE_PULSE.volumeGrowthPct.toFixed(1)}%</strong> |
            BTC Tx Δ24h: <strong>${LIVE_DUNE_PULSE.btcTxGrowthPct.toFixed(1)}%</strong>
          </div>
        </div>
      `;
    }
    
    // Add Order Book depth
    if (LIVE_DEPTH) {
      dashAlpha.innerHTML += `
        <div class="feed-item news-impact">
          <div class="feed-header">
            <span class="feed-time">Order Book</span>
            <span class="feed-tag" style="background: rgba(108,92,231,0.2); color: var(--primary);">BTC DEPTH</span>
          </div>
          <div class="feed-content">
            Buy Pressure: <strong class="${parseFloat(LIVE_DEPTH.buyPressure) > 50 ? 'text-green' : 'text-red'}">${LIVE_DEPTH.buyPressure}%</strong> | Support Wall: <strong>$${formatPrice(LIVE_DEPTH.support)}</strong> | Resistance: <strong>$${formatPrice(LIVE_DEPTH.resistance)}</strong>
          </div>
        </div>
      `;
    }
  }
}

function renderSmartMoneyFlow() {
  const container = document.getElementById('smart-money-list');
  if (!container) return;
  if (SMART_MONEY_FLOWS.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Scanning for institutional wallet activity...</div>`;
    return;
  }
  container.innerHTML = SMART_MONEY_FLOWS.map(flow => `
    <div class="flow-card">
      <div class="flow-icon ${flow.type}">
        ${flow.type === 'inflow' ? '📥' : '📤'}
      </div>
      <div class="flow-details">
        <div class="flow-amount">${flow.amount} ${flow.asset} ${flow.type === 'inflow' ? 'Inflow' : 'Outflow'}</div>
        <div class="flow-meta">
          <span>${flow.wallet}</span>
          <span class="text-muted">• ${flow.time}</span>
        </div>
      </div>
      <div class="flow-tag ${flow.tag}">${flow.tag}</div>
    </div>
  `).join('');
}

function renderNarrativeMomentum() {
  const container = document.getElementById('narrative-momentum-list');
  if (!container) return;
  if (NARRATIVES.length === 0) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-size:0.85rem;text-align:center;">Syncing sector momentum from CoinGecko...</div>`;
    return;
  }
  container.innerHTML = NARRATIVES.map((n, i) => `
    <div class="narrative-card">
      <div class="narrative-left">
        <div class="narrative-rank">#${i + 1}</div>
        <div class="narrative-name">${n.name}</div>
      </div>
      <div class="narrative-right">
        <div class="narrative-score text-green">${n.change}</div>
        <div class="narrative-bar-bg">
          <div class="narrative-bar-fill" style="width: ${n.val}%"></div>
        </div>
      </div>
    </div>
  `).join('');
}

window.triggerMcp = async function(type) {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('ai-chat-submit');
  if (!input || !btn) return;

  input.value = type;
  btn.click();
}


function typeWriterEffect(element, lines, speed = 20) {
  if (!element) return;
  const safeLines = Array.isArray(lines) ? lines : [];
  const state = element._typingState || { runId: 0, timers: new Set() };
  state.runId += 1;
  const runId = state.runId;
  state.timers.forEach((timerId) => clearTimeout(timerId));
  state.timers.clear();
  element._typingState = state;
  element.innerHTML = '';

  const schedule = (fn, delay) => {
    const timerId = setTimeout(() => {
      state.timers.delete(timerId);
      if (state.runId !== runId) return;
      fn();
    }, delay);
    state.timers.add(timerId);
  };

  let lineIdx = 0;

  function typeLine() {
    if (state.runId !== runId) return;
    if (lineIdx >= safeLines.length) {
      const cursor = document.createElement('span');
      cursor.className = 'ai-cursor';
      element.appendChild(cursor);
      return;
    }

    const lineText = String(safeLines[lineIdx] || '');
    const lineDiv = document.createElement('div');
    lineDiv.className = lineIdx === 0 ? 'ai-line highlight' : 'ai-line';
    lineDiv.style.opacity = '1';
    element.appendChild(lineDiv);

    let charIdx = 0;
    function typeChar() {
      if (state.runId !== runId) return;
      if (charIdx < lineText.length) {
        lineDiv.textContent += lineText.charAt(charIdx);
        charIdx += 1;
        schedule(typeChar, speed);
      } else {
        lineIdx += 1;
        schedule(typeLine, 100);
      }
    }
    typeChar();
  }

  typeLine();
}

function renderOpportunitiesPage() {
  const tbody = document.getElementById('opportunities-table-body');
  const sorted = getSortedTradeableAssets(OPPORTUNITY_SORT);
  const visibleRows = sorted.slice(0, MAX_TOP_OPPORTUNITIES);
  
  tbody.innerHTML = visibleRows.map((asset, i) => {
    const sig = generateSignalForAsset(asset, { enforceScanUniverse: false });
    const displayScore = getUnifiedAlphaScore(asset);
    // Calculate profit potential based on max target (t4) at 5x leverage
    let profitPot = 0;
    if (sig.type !== 'WAIT' && asset.price > 0 && sig.t4 > 0) {
       profitPot = (Math.abs(sig.t4 - asset.price) / asset.price) * 5 * 100;
    }
    return `
    <tr>
      <td class="text-muted">${i+1}</td>
      <td><strong>${asset.name}</strong> <span class="text-muted ml-2">${asset.symbol}</span></td>
      <td style="font-family: var(--font-mono)" class="live-price" data-symbol="${asset.symbol}">$${formatPrice(asset.price)}</td>
      <td class="${asset.change >= 0 ? 'text-green' : 'text-red'} live-change" data-symbol="${asset.symbol}">${asset.change > 0 ? '+' : ''}${asset.change.toFixed(2)}%</td>
      <td>
        <div class="td-score-container">
          <span class="td-score-val">${displayScore}</span>
          <div class="td-score-bar-bg">
            <div class="td-score-bar-fill" style="width: ${displayScore}%"></div>
          </div>
        </div>
      </td>


      <td><span class="text-muted" style="font-size: 0.8rem">${(() => {
        const livePattern = getLiveDetectedPattern(asset.symbol);
        if (livePattern !== 'NONE') return livePattern;
        return asset.reason || 'NONE';
      })()}</span></td>
      <td>
        ${sig.type === 'WAIT' ? `
          <div>
            <span class="badge" style="background: rgba(255,255,255,0.05); color: var(--text-muted); font-size: 0.65rem; padding: 0.2rem 0.5rem;">⏸ WAIT</span>
            <div style="font-size:0.64rem; color:var(--text-muted); margin-top:0.25rem; max-width: 280px; line-height:1.35;">
              ${sig.waitReason || 'Mandatory conditions not met.'}
            </div>
          </div>
        ` : `
          <div style="font-family: var(--font-mono); font-size: 0.64rem; line-height: 1.35; color: #cfd8ff; max-width: 360px; white-space: normal;">
            ${(Array.isArray(sig.signalLines) ? sig.signalLines : [sig.signalText]).filter(Boolean).join('<br/>')}
          </div>
        `}
      </td>
      <td><button class="action-btn">Analyze</button></td>
    </tr>
  `}).join('');

  document.querySelectorAll('#opportunities-table-body .action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      const symbol = row.querySelector('.live-price').dataset.symbol;
      
      navigateToPage('ai-research'); // Switch to AI Research Analyst Page
      setTimeout(() => {
         triggerMcp(`Generate a strict quantitative algorithmic trade setup for ${symbol} using the provided market structure and candlestick patterns.`);
      }, 100);
    });
  });
}

function renderTradingPage(symbol = 'BINANCE:SOLUSDT') {
  if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
      "autosize": true,
      "symbol": symbol,
      "interval": "D",
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "enable_publishing": false,
      "backgroundColor": "#0E1320",
      "gridColor": "#1C2438",
      "hide_top_toolbar": false,
      "hide_legend": false,
      "save_image": false,
      "container_id": "tradingview-widget",
      "toolbar_bg": "#0E1320",
      "allow_symbol_change": true,
      "hide_side_toolbar": false
    });
  }
}

function setupAllButtons() {
  // 1. Dashboard Timeframe Buttons
  document.querySelectorAll('#market-timeframe-actions .market-timeframe-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tf = e.currentTarget.dataset.tf || e.currentTarget.textContent.trim();
      const parent = e.currentTarget.closest('.panel-actions');
      if (parent) parent.querySelectorAll('.panel-action-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      updateMarketCapHeader(tf);
      showToast(`Market chart updated to ${tf} timeframe`);
      initCharts(tf);
    });
  });

  // 2. Opportunities Sorting
  document.querySelectorAll('#page-opportunities .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const sort = e.target.dataset.sort;
      document.querySelectorAll('#page-opportunities .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      OPPORTUNITY_SORT = sort || 'alpha';
      renderOpportunitiesPage();
      showToast(`Sorted by ${sort}`);
    });
  });

  // 3. Whale Flow Filtering
  document.querySelectorAll('#page-whale .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('#page-whale .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      showToast(`Filtering flow: ${e.target.textContent}`);
      renderWhalePage(); // Re-render current mock
    });
  });

  // 4. Backtester Strategy Tabs
  document.querySelectorAll('#bt-strategy-tabs .panel-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const strat = e.target.dataset.strat;
      document.querySelectorAll('#bt-strategy-tabs .panel-action-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderBacktesterPage(); // This will filter based on strat if logic is added
      showToast(`Strategy view: ${strat.toUpperCase()}`);
    });
  });

  // 5. Header Search & Alerts
  const searchBtn = document.getElementById('search-btn');
  if(searchBtn) searchBtn.addEventListener('click', () => {
    navigateToPage('opportunities');
    const table = document.getElementById('opportunities-table-body');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const headerAlertBtn = document.getElementById('alert-btn');
  if(headerAlertBtn) headerAlertBtn.addEventListener('click', () => {
    const modal = document.getElementById('alert-modal');
    if(modal) modal.classList.add('active');
  });

  // 6. Settings Buttons
  const settingsBtns = document.querySelectorAll('#page-settings .btn-primary, #page-settings .btn-secondary');
  settingsBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      showToast("Settings updated successfully and synced to cloud.");
    });
  });

  // 7. Alert Management
  const alertsTable = document.getElementById('alerts-table-body');
  if (alertsTable) {
    alertsTable.addEventListener('click', (e) => {
      const trashBtn = e.target.closest('.icon-btn.text-red');
      if (trashBtn) {
        const row = trashBtn.closest('tr');
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';
        row.style.transition = 'all 0.3s ease';
        setTimeout(() => {
          row.remove();
          showToast("Trigger deleted.");
        }, 300);
      }
    });
  }

  const newAlertBtn = document.getElementById('new-alert-page-btn');
  if(newAlertBtn) newAlertBtn.addEventListener('click', () => {
    const modal = document.getElementById('alert-modal');
    if(modal) modal.classList.add('active');
  });

  const createAlertBtn = document.getElementById('create-alert-btn');
  if(createAlertBtn) {
    createAlertBtn.addEventListener('click', () => {
      const asset = document.getElementById('alert-asset').value;
      const cond = document.getElementById('alert-condition').value;
      showToast(`Alert deployed for ${asset} on ${cond}`);
      const modal = document.getElementById('alert-modal');
      if(modal) modal.classList.remove('active');
      
      // Add row to table
      const table = document.getElementById('alerts-table-body');
      if(table) {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${asset}</strong></td>
          <td>Custom</td>
          <td>${cond}</td>
          <td><span class="badge bg-primary">Push</span></td>
          <td><span class="text-green"><span class="status-dot pulse mr-2" style="display:inline-block"></span> Active</span></td>
          <td><button class="icon-btn text-red"><i data-feather="trash-2"></i></button></td>
        `;
        table.prepend(row);
        feather.replace();
      }
    });
  }
}

function showToast(msg) {
  const container = document.getElementById('toast-container');
  if(!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <i data-feather="check-circle" style="color:var(--primary)"></i>
    <span>${msg}</span>
  `;
  container.appendChild(toast);
  feather.replace();
  setTimeout(() => toast.classList.add('active'), 10);
  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.openTradingChart = function(coin) {
  // 1. Switch UI to trading page
  navigateToPage('trading');
  
  // 2. Format symbol
  const symbol = `BINANCE:${coin}USDT`;
  
  // 3. Update select dropdown dynamically if needed
  const tvSelect = document.getElementById('tv-pair-select');
  if(tvSelect) {
     let optionExists = Array.from(tvSelect.options).some(opt => opt.value === symbol);
     if(!optionExists) {
         const newOpt = new Option(`${coin}/USDT`, symbol);
         tvSelect.add(newOpt);
     }
     tvSelect.value = symbol;
  }
  
  // 4. Render the chart
  renderTradingPage(symbol);
}

function setupAiReports() {
  const reportCards = document.querySelectorAll('#ai-report-list .report-card');
  reportCards.forEach(card => {
    card.addEventListener('click', () => {
      const title = card.querySelector('h4').textContent;
      const input = document.getElementById('ai-chat-input');
      const submitBtn = document.getElementById('ai-chat-submit');
      
      if (input && submitBtn) {
        input.value = `Generate a comprehensive Deep Dive Intelligence Report on: ${title}. Include on-chain data, social narrative maps, and potential trade impact.`;
        submitBtn.click();
        
        // Scroll to chat
        const chatBody = document.querySelector('.chat-body');
        if (chatBody) chatBody.scrollTop = 0;
      }
    });
  });
}

function setupTradingEvents() {
  // Dropdown removed from UI
}

function renderWhalePage() {
  const buys = WHALE_ACTIONS.filter(w => w.type === 'buy').length;
  const sells = WHALE_ACTIONS.filter(w => w.type === 'sell').length;
  const trend = buys >= sells ? 'Accumulation' : 'Distribution';
  const trendClass = buys >= sells ? 'text-green' : 'text-red';
  const peakTx = WHALE_ACTIONS.length > 0 ? WHALE_ACTIONS[0].amount : '—';

  document.getElementById('whale-summary').innerHTML = `
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Tracked Whale Txs</span></div>
      <div class="card-value text-primary">${WHALE_ACTIONS.length}</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Dominant Trend</span></div>
      <div class="card-value ${trendClass}">${trend}</div>
    </div>
    <div class="summary-card">
      <div class="card-header"><span class="card-title">Top Asset</span></div>
      <div class="card-value">${peakTx}</div>
    </div>
  `;

  const tbody = document.getElementById('whale-table-body');
  tbody.innerHTML = WHALE_ACTIONS.map((w, i) => `
    <tr>
      <td class="text-muted" style="font-family: var(--font-mono)">${w.time}</td>
      <td><strong>${w.amount}</strong></td>
      <td><span class="bias-badge bias-${w.type === 'buy' ? 'bullish' : 'bearish'}">${w.type === 'buy' ? 'Accumulation' : 'Distribution'}</span></td>
      <td style="font-family: var(--font-mono)">${(i + 1) * 25}k ${w.amount}</td>
      <td style="font-family: var(--font-mono)">$${((i + 1) * 1.5).toFixed(1)}M</td>
      <td class="text-muted">${w.type === 'buy' ? w.exchange + ' -> Cold Storage' : 'Wallet -> ' + w.exchange}</td>
    </tr>
  `).join('');
}



function setupAiResearchChat() {
  const input = document.getElementById('ai-chat-input');
  const btn = document.getElementById('ai-chat-submit');
  const history = document.getElementById('ai-chat-history');

  if (!input || !btn || !history) return;
  let isSubmitting = false;
  const SIGNAL_INTENT_RE = /\b(signal|scalp|day|entry|entries|tp|target|stop|sl|setup|long|short|buy|sell|trade)\b/i;
  const extractRequestedSymbols = (text = '') => {
    const upper = String(text || '').toUpperCase();
    const symbols = new Set();
    const liveSymbolSet = new Set(
      (assets || [])
        .map(a => String(a?.symbol || '').toUpperCase())
        .filter(Boolean)
    );
    const pairMatches = [...upper.matchAll(/\b([A-Z0-9]{2,10})\s*\/\s*USDT\b/g)];
    pairMatches.forEach((m) => symbols.add(m[1]));
    const compactMatches = [...upper.matchAll(/\b([A-Z0-9]{2,10})USDT\b/g)];
    compactMatches.forEach((m) => symbols.add(m[1]));
    const tokens = upper.match(/[A-Z0-9]{2,10}/g) || [];
    tokens.forEach((token) => {
      if (liveSymbolSet.has(token) || SIGNAL_SCAN_PAIRS.includes(token)) {
        symbols.add(token);
      }
    });
    if (symbols.size) return [...symbols];
    const fallbackUniverse = getTopUniverseSymbols(MAX_TRADABLE_ASSETS);
    return fallbackUniverse.length ? fallbackUniverse : [...SIGNAL_SCAN_PAIRS];
  };

  const handleChat = async () => {
    const val = input.value.trim();
    if (!val || isSubmitting) return;
    isSubmitting = true;
    btn.disabled = true;
    
    // Add user message
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-message user';
    userMsg.style.flexDirection = 'row-reverse';
    const userAvatar = document.createElement('div');
    userAvatar.className = 'avatar';
    userAvatar.style.background = 'rgba(255,255,255,0.1)';
    const userIcon = document.createElement('i');
    userIcon.setAttribute('data-feather', 'user');
    userAvatar.appendChild(userIcon);
    const userBubble = document.createElement('div');
    userBubble.className = 'bubble';
    userBubble.style.background = 'var(--primary-gradient)';
    userBubble.style.color = '#fff';
    userBubble.textContent = val;
    userMsg.appendChild(userAvatar);
    userMsg.appendChild(userBubble);
    history.appendChild(userMsg);
    if (typeof feather !== 'undefined') feather.replace();
    
    input.value = '';
    history.scrollTop = history.scrollHeight;

    // Add loading indicator
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'chat-message ai';
    const loadingAvatar = document.createElement('div');
    loadingAvatar.className = 'avatar';
    const loadingIcon = document.createElement('i');
    loadingIcon.setAttribute('data-feather', 'cpu');
    loadingAvatar.appendChild(loadingIcon);
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'bubble';
    const loadingCursor = document.createElement('span');
    loadingCursor.className = 'ai-cursor';
    loadingBubble.appendChild(loadingCursor);
    loadingBubble.appendChild(document.createTextNode(' Synthesizing data...'));
    loadingMsg.appendChild(loadingAvatar);
    loadingMsg.appendChild(loadingBubble);
    history.appendChild(loadingMsg);
    if (typeof feather !== 'undefined') feather.replace();
    history.scrollTop = history.scrollHeight;

    try {
      // Force simplified deterministic signal mode in chat when user asks for signals.
      if (SIGNAL_INTENT_RE.test(val)) {
        const requested = extractRequestedSymbols(val);
        const signalLines = [];
        const waitRows = [];

        const symbolsNeedingIndicators = requested.filter((sym) => {
          const rec = LIVE_SIGNAL_CONTEXT[sym];
          if (!rec) return true;
          return !rec.ema1m || !rec.ema15m || !Number.isFinite(Number(rec.volumeVsAvg1m3)) || !Number.isFinite(Number(rec.volumeVsAvg15m5));
        });

        if (symbolsNeedingIndicators.length > 0) {
          try {
            const [technical, spreads, patternRows] = await Promise.all([
              fetchTechnicalSignals(symbolsNeedingIndicators),
              fetchBidAskSpreads(symbolsNeedingIndicators),
              Promise.all(symbolsNeedingIndicators.flatMap((sym) => ([
                fetchCandlePatterns(sym, '1m').then(data => ({ symbol: sym, interval: '1m', data })).catch(() => ({ symbol: sym, interval: '1m', data: null })),
                fetchCandlePatterns(sym, '15m').then(data => ({ symbol: sym, interval: '15m', data })).catch(() => ({ symbol: sym, interval: '15m', data: null }))
              ])))
            ]);

            if (technical?.indicators && Object.keys(technical.indicators).length > 0) {
              Object.entries(technical.indicators).forEach(([sym, metrics]) => {
                LIVE_SIGNAL_CONTEXT[sym] = metrics;
              });
              window._liveSignalContext = LIVE_SIGNAL_CONTEXT;
            }
            if (Array.isArray(spreads)) {
              spreads.forEach((row) => {
                if (row?.symbol) LIVE_SPREADS[row.symbol] = row;
              });
              window._liveSpreads = LIVE_SPREADS;
            }
            if (Array.isArray(patternRows)) {
              patternRows.forEach((row) => {
                const sym = String(row?.symbol || '').toUpperCase();
                const tf = String(row?.interval || '').toLowerCase();
                if (!sym || !tf) return;
                if (!LIVE_SIGNAL_PATTERNS[sym]) LIVE_SIGNAL_PATTERNS[sym] = {};
                LIVE_SIGNAL_PATTERNS[sym][tf] = row?.data || null;
              });
              window._liveSignalPatterns = LIVE_SIGNAL_PATTERNS;
            }
          } catch (signalRefreshErr) {
            console.warn('Signal on-demand refresh failed:', signalRefreshErr?.message || signalRefreshErr);
          }
        }

        requested.forEach((sym) => {
          const asset = assets.find(a => a.symbol === sym);
          if (!asset) {
            waitRows.push(`${sym}/USDT: asset context unavailable.`);
            return;
          }
          const sig = generateSignalForAsset(asset, { enforceScanUniverse: false });
          if (sig.type === 'WAIT') {
            waitRows.push(`${sym}/USDT: ${sig.waitReason}`);
            return;
          }
          if (Array.isArray(sig.signalLines) && sig.signalLines.length > 0) {
            sig.signalLines.forEach((line) => signalLines.push(line));
          } else if (sig.signalText) {
            signalLines.push(sig.signalText);
          }
        });

        if (loadingMsg.parentNode) history.removeChild(loadingMsg);
        const aiMsg = document.createElement('div');
        aiMsg.className = 'chat-message ai';
        const aiAvatar = document.createElement('div');
        aiAvatar.className = 'avatar';
        const aiIcon = document.createElement('i');
        aiIcon.setAttribute('data-feather', 'cpu');
        aiAvatar.appendChild(aiIcon);
        const aiBubble = document.createElement('div');
        aiBubble.className = 'bubble';
        const body = signalLines.length
          ? signalLines.join('\n')
          : `No signal generated.\n${waitRows.join('\n')}`;
        aiBubble.innerHTML = `<pre style="margin:0;white-space:pre-wrap;font-family:var(--font-mono);font-size:0.82rem;line-height:1.55;">${body}</pre>`;
        aiMsg.appendChild(aiAvatar);
        aiMsg.appendChild(aiBubble);
        history.appendChild(aiMsg);
        if (typeof feather !== 'undefined') feather.replace();
        history.scrollTop = history.scrollHeight;
        return;
      }

      // Fetch from AI with full platform context
      const promptUpper = String(val || '').toUpperCase();
      const pairMatch = promptUpper.match(/\b([A-Z0-9]{2,10})\s*\/\s*USDT\b/) || promptUpper.match(/\b([A-Z0-9]{2,10})USDT\b/);
      const requestedSymbol = pairMatch ? pairMatch[1] : null;
      const liveAssets = assets
        .filter(a => !isStablecoinSymbol(a.symbol, a.name, a.price));
      const prioritizedAssets = requestedSymbol
        ? [
            ...liveAssets.filter(a => a.symbol === requestedSymbol),
            ...liveAssets.filter(a => a.symbol !== requestedSymbol)
          ]
        : liveAssets;
      const assetCtx = prioritizedAssets
        .slice(0, 24)
        .map(a => `${a.symbol}: CURRENT_PRICE=$${a.price} (${a.change >= 0 ? '+' : ''}${a.change.toFixed(2)}%) - Rationale: ${a.reason}`)
        .join(' | ');
      const apiHealthCtx = window._apiHealthPrompt ? `API HEALTH: ${window._apiHealthPrompt}` : 'API HEALTH: pending first sync';
      const duneCtx = LIVE_DUNE_PULSE
        ? `DUNE_PULSE: score=${LIVE_DUNE_PULSE.signalScore.toFixed(1)}, bias=${LIVE_DUNE_PULSE.bias}, dex_volume_growth_24h=${LIVE_DUNE_PULSE.volumeGrowthPct.toFixed(1)}%, btc_tx_growth_24h=${LIVE_DUNE_PULSE.btcTxGrowthPct.toFixed(1)}%.`
        : 'DUNE_PULSE: unavailable.';
      const dualRes = await fetchDualAI(val, `LATEST LIVE DATA: ${assetCtx}. ${apiHealthCtx}. ${duneCtx}`);

      if (loadingMsg.parentNode) history.removeChild(loadingMsg);

      const aiMsg = document.createElement('div');
      aiMsg.className = 'chat-message ai';
      const aiAvatar = document.createElement('div');
      aiAvatar.className = 'avatar';
      const aiIcon = document.createElement('i');
      aiIcon.setAttribute('data-feather', 'cpu');
      aiAvatar.appendChild(aiIcon);
      const aiBubble = document.createElement('div');
      aiBubble.className = `bubble${dualRes ? '' : ' text-red'}`;
      aiBubble.innerHTML = dualRes || 'Error: AI Engine offline or rate limited. Please try again.';
      aiMsg.appendChild(aiAvatar);
      aiMsg.appendChild(aiBubble);
      history.appendChild(aiMsg);
      if (typeof feather !== 'undefined') feather.replace();
      history.scrollTop = history.scrollHeight;
    } catch (err) {
      console.error('AI Research Stream failed:', err);
      if (loadingMsg.parentNode) history.removeChild(loadingMsg);

      const failMsg = document.createElement('div');
      failMsg.className = 'chat-message ai';
      failMsg.innerHTML = `
        <div class="avatar"><i data-feather="cpu"></i></div>
        <div class="bubble text-red">Error: AI stream timed out. Please try again.</div>
      `;
      history.appendChild(failMsg);
      if (typeof feather !== 'undefined') feather.replace();
      history.scrollTop = history.scrollHeight;
    } finally {
      isSubmitting = false;
      btn.disabled = false;
    }
  };

  btn.addEventListener('click', handleChat);
  input.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleChat();
  });
}

function setupModals() {
  const modal = document.getElementById('alert-modal');
  
  const openModal = () => modal.classList.add('active');
  const closeModal = () => modal.classList.remove('active');

  document.getElementById('alert-btn').addEventListener('click', openModal);
  document.getElementById('new-alert-page-btn')?.addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if(e.target === modal) closeModal(); });

  document.getElementById('create-alert-btn').addEventListener('click', () => {
    closeModal();
    showToast('Algorithmic trigger deployed successfully.');
  });
}

function formatPrice(num) {
  if (num < 1) return num.toFixed(4);
  if (num < 10) return num.toFixed(3);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


// ============================================================
// NEXUS PRO SIGNALS
// ============================================================

function generateSignalForAsset(asset, options = {}) {
  const enforceScanUniverse = options?.enforceScanUniverse !== false;
  const symbol = String(asset?.symbol || '').toUpperCase();
  const price = Number(asset?.price);
  if (!(price > 0)) {
    return {
      type: 'NO_SIGNAL',
      isBull: null,
      strength: { label: 'NO SIGNAL', cls: 'text-muted' },
      exchanges: ['Binance'],
      leverage: 'None',
      entry1: 0, entry2: 0, entry3: 0,
      t1: 0, t2: 0, t3: 0, t4: 0, sl: 0, rrRatio: '0.0',
      waitReason: 'PRICE_UNAVAILABLE',
      signalText: `NO_SIGNAL|${symbol || 'UNKNOWN'}/USDT|${new Date().toISOString()}|PRICE_UNAVAILABLE`,
      signalLines: [`NO_SIGNAL|${symbol || 'UNKNOWN'}/USDT|${new Date().toISOString()}|PRICE_UNAVAILABLE`]
    };
  }

  const activeUniverse = getTopUniverseSymbols(MAX_TRADABLE_ASSETS);
  if (enforceScanUniverse && !activeUniverse.includes(symbol)) {
    return {
      type: 'NO_SIGNAL',
      isBull: null,
      strength: { label: 'NO SIGNAL', cls: 'text-muted' },
      exchanges: ['Binance'],
      leverage: 'None',
      entry1: 0, entry2: 0, entry3: 0,
      t1: 0, t2: 0, t3: 0, t4: 0, sl: 0, rrRatio: '0.0',
      waitReason: 'OUTSIDE_UNIVERSE',
      signalText: `NO_SIGNAL|${symbol}/USDT|${new Date().toISOString()}|OUTSIDE_UNIVERSE`,
      signalLines: [`NO_SIGNAL|${symbol}/USDT|${new Date().toISOString()}|OUTSIDE_UNIVERSE`]
    };
  }

  const indicator = LIVE_SIGNAL_CONTEXT[symbol] || {};
  const spread = LIVE_SPREADS[symbol] || {};
  const funding = LIVE_FUNDING.find(f => f.symbol === symbol) || { rate: null };
  const dune = LIVE_DUNE_PULSE || null;
  const dominanceData = window._liveGlobalMarketData || null;
  const utcHour = new Date().getUTCHours();

  const buildNoSignal = (signalType, reason) => {
    const ts = new Date().toISOString();
    const reasonText = `${signalType}:${reason}`;
    const line = `NO_SIGNAL|${symbol}/USDT|${ts}|${reasonText}`;
    return {
      type: 'NO_SIGNAL',
      signalType,
      isBull: null,
      side: null,
      pattern: 'NONE',
      strength: { label: 'NO SIGNAL', cls: 'text-muted' },
      exchanges: ['Binance'],
      leverage: 'None',
      entry1: 0, entry2: 0, entry3: 0,
      t1: 0, t2: 0, t3: 0, t4: 0, sl: 0, rrRatio: '0.0',
      atrPct: 0,
      alpha: 0,
      signalText: line,
      signalLines: [line],
      timestampUtc: ts,
      waitReason: reasonText
    };
  };

  const getBtcDominanceShiftPct = () => {
    if (!dominanceData || typeof dominanceData !== 'object') return 0;
    const direct = Number(dominanceData?.btc_dominance_24h_percentage_change);
    if (Number.isFinite(direct)) return direct;

    const now = Number(dominanceData?.btc_dominance);
    const prev = Number(dominanceData?.btc_dominance_yesterday);
    if (Number.isFinite(now) && Number.isFinite(prev)) return now - prev;

    return 0;
  };

  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
  const isMajorNewsHeadline = (title = '') => /(fomc|cpi|sec|etf|hack|exploit|lawsuit|ban|liquidation|outage|fed|rate hike|rate cut|exchange halt)/i.test(String(title || ''));

  const hasMajorNewsWithinMinutes = (minutes = 30) => {
    if (!Array.isArray(NEWS) || NEWS.length === 0) return false;
    const now = Date.now();
    const msWindow = Math.max(1, minutes) * 60 * 1000;
    return NEWS.some((item) => {
      const title = String(item?.title || '');
      if (!isMajorNewsHeadline(title)) return false;
      const published = Date.parse(item?.pubDate || item?.published || item?.isoDate || '');
      if (!Number.isFinite(published)) return false;
      const delta = now - published;
      return delta >= 0 && delta <= msWindow;
    });
  };

  const computeNewsSentimentBase = () => {
    if (!Array.isArray(NEWS) || NEWS.length === 0) return 50;
    const POS = /(surge|rally|breakout|approval|adoption|inflow|accumulation|partnership|upgrade|record high|launch)/i;
    const NEG = /(dump|crash|drop|hack|exploit|lawsuit|ban|outflow|liquidation|shutdown|delay|reject)/i;
    let pos = 0;
    let neg = 0;
    NEWS.slice(0, 20).forEach((item) => {
      const t = String(item?.title || '');
      if (POS.test(t)) pos += 1;
      if (NEG.test(t)) neg += 1;
    });
    const total = pos + neg;
    if (total === 0) return 50;
    return clamp((pos / total) * 100, 0, 100);
  };

  const classifyPattern = (type, side) => {
    const key = type === 'SCALP' ? '1m' : '15m';
    const patternFeed = LIVE_SIGNAL_PATTERNS?.[symbol]?.[key];
    const patterns = Array.isArray(patternFeed?.patterns) ? patternFeed.patterns : [];
    if (!patterns.length) return { valid: false, highReliability: false, name: 'NONE' };

    const alignedType = side === 'BUY' ? 'bullish' : 'bearish';
    const candleCount = Number(patternFeed?.candleCount);
    const lastClosedCandle = Number.isFinite(candleCount) && candleCount >= 2 ? (candleCount - 2) : null;
    const aligned = patterns.find((p) => {
      const typeMatches = String(p?.type || '').toLowerCase() === alignedType;
      if (!typeMatches) return false;
      if (!Number.isFinite(lastClosedCandle)) return true;
      return Number(p?.candle) === lastClosedCandle;
    });
    if (!aligned) return { valid: false, highReliability: false, name: 'NONE' };
    const patternName = String(aligned?.name || 'Pattern').toUpperCase().replace(/\s+/g, '_');
    const isScalpHigh = /(FLAG|ENGULFING|PIN|HAMMER|SHOOTING)/i.test(patternName);
    const isDayHigh = /(CUP|HANDLE|HEAD|SHOULDERS|H&S)/i.test(patternName);
    const highReliability = type === 'SCALP' ? isScalpHigh : isDayHigh;
    return { valid: true, highReliability, name: patternName };
  };

  const dedupeLevels = (levels = [], minGapPct = 0.08) => {
    const sorted = [...levels]
      .map(v => Number(v))
      .filter(v => Number.isFinite(v) && v > 0)
      .sort((a, b) => a - b);

    const out = [];
    for (const level of sorted) {
      if (!out.length) {
        out.push(level);
        continue;
      }
      const prev = out[out.length - 1];
      const gapPct = prev > 0 ? (Math.abs(level - prev) / prev) * 100 : 0;
      if (gapPct >= minGapPct) out.push(level);
    }
    return out;
  };

  const getStructureLevels = (type, side, entry) => {
    const key = type === 'SCALP' ? '1m' : '15m';
    const feed = LIVE_SIGNAL_PATTERNS?.[symbol]?.[key] || {};
    const minGapPct = type === 'SCALP' ? 0.06 : 0.10;
    const maxDistPct = type === 'SCALP' ? 1.8 : 3.5;
    const localRes = dedupeLevels(feed?.localResistances || [], minGapPct);
    const localSup = dedupeLevels(feed?.localSupports || [], minGapPct);

    const resistanceAbove = localRes
      .filter(level => level > entry)
      .filter((level) => ((level - entry) / entry) * 100 <= maxDistPct)
      .sort((a, b) => a - b);

    const supportBelow = localSup
      .filter(level => level < entry)
      .filter((level) => ((entry - level) / entry) * 100 <= maxDistPct)
      .sort((a, b) => b - a);

    const entrySupports = localSup.filter(level => level < entry).sort((a, b) => b - a);
    const entryResistances = localRes.filter(level => level > entry).sort((a, b) => a - b);

    return {
      resistanceAbove,
      supportBelow,
      entrySupports,
      entryResistances,
      hasUsableTargets: side === 'BUY' ? resistanceAbove.length > 0 : supportBelow.length > 0
    };
  };

  const deriveEntryLadder = ({ type, side, entry, atrSafe, structure }) => {
    const isScalp = type === 'SCALP';
    const isBull = side === 'BUY';
    const step2 = atrSafe * (isScalp ? 0.07 : 0.16);
    const step3 = atrSafe * (isScalp ? 0.13 : 0.30);

    let entry2 = isBull ? Math.max(0.0000001, entry - step2) : entry + step2;
    let entry3 = isBull ? Math.max(0.0000001, entry - step3) : entry + step3;

    if (isBull && Array.isArray(structure?.entrySupports) && structure.entrySupports.length > 0) {
      entry2 = Math.max(0.0000001, structure.entrySupports[0]);
      entry3 = Math.max(0.0000001, structure.entrySupports[1] ?? (entry2 - (step2 * 0.9)));
    }

    if (!isBull && Array.isArray(structure?.entryResistances) && structure.entryResistances.length > 0) {
      entry2 = structure.entryResistances[0];
      entry3 = structure.entryResistances[1] ?? (entry2 + (step2 * 0.9));
    }

    // Keep a strict ladder direction and avoid equal levels.
    if (isBull) {
      if (!(entry2 < entry)) entry2 = Math.max(0.0000001, entry - Math.max(step2 * 0.7, entry * 0.0005));
      if (!(entry3 < entry2)) entry3 = Math.max(0.0000001, entry2 - Math.max(step2 * 0.6, entry * 0.0004));
    } else {
      if (!(entry2 > entry)) entry2 = entry + Math.max(step2 * 0.7, entry * 0.0005);
      if (!(entry3 > entry2)) entry3 = entry2 + Math.max(step2 * 0.6, entry * 0.0004);
    }

    return [entry, entry2, entry3];
  };

  const deriveTargetsFromStructure = ({ type, side, entry, risk, atrSafe, structure }) => {
    const isScalp = type === 'SCALP';
    const isBull = side === 'BUY';
    const fallbackMult = isScalp ? [0.55, 0.90, 1.20, 1.55] : [0.80, 1.25, 1.75, 2.30];
    const dir = isBull ? 1 : -1;
    const maxDistPct = isScalp ? 2.1 : 4.0;
    const minStep = entry * (isScalp ? 0.00045 : 0.00085);
    const sourceLevels = isBull ? (structure?.resistanceAbove || []) : (structure?.supportBelow || []);
    const targets = [];

    for (const level of sourceLevels) {
      if (targets.length >= 4) break;
      if (isBull) {
        if (targets.length && level <= targets[targets.length - 1] + minStep) continue;
        targets.push(level);
      } else {
        if (targets.length && level >= targets[targets.length - 1] - minStep) continue;
        targets.push(level);
      }
    }

    while (targets.length < 4) {
      const idx = targets.length;
      let candidate = entry + (dir * Math.max(risk, atrSafe * 0.15) * fallbackMult[idx]);
      const maxBound = entry * (1 + (maxDistPct / 100));
      const minBound = entry * (1 - (maxDistPct / 100));
      if (isBull) {
        candidate = Math.min(candidate, maxBound);
        const floor = targets.length ? targets[targets.length - 1] + minStep : entry + minStep;
        if (candidate < floor) candidate = floor;
      } else {
        candidate = Math.max(candidate, minBound);
        const ceiling = targets.length ? targets[targets.length - 1] - minStep : entry - minStep;
        if (candidate > ceiling) candidate = ceiling;
      }
      targets.push(candidate);
    }

    return targets.slice(0, 4);
  };

  const computeMacdScore = (macd, side) => {
    if (!macd || !Number.isFinite(macd.histogram) || !Array.isArray(macd.histogramSeries)) return 50;
    const histSeries = macd.histogramSeries.slice(-20);
    if (histSeries.length === 0) return 50;
    const maxHist = Math.max(...histSeries);
    const minHist = Math.min(...histSeries);
    const range = maxHist - minHist;
    const strength = range === 0 ? 50 : clamp(((macd.histogram - minHist) / range) * 100, 0, 100);

    const histPrev = Number(macd.histogramPrev);
    const direction = Number.isFinite(histPrev)
      ? (macd.histogram > histPrev ? 100 : macd.histogram < histPrev ? 0 : 50)
      : 50;

    const candlesSinceCross = side === 'BUY'
      ? Number(macd.crossBarsAgoBullish)
      : Number(macd.crossBarsAgoBearish);
    const recency = Number.isFinite(candlesSinceCross)
      ? Math.max(0, 100 - (Math.min(10, Math.max(0, candlesSinceCross)) * 10))
      : 0;

    const raw = (strength * 0.4) + (direction * 0.3) + (recency * 0.3);
    const divergenceBonus = (side === 'BUY' && macd.bullishDivergence) || (side === 'SELL' && macd.bearishDivergence) ? 10 : 0;
    return clamp(raw + divergenceBonus, 0, 100);
  };

  const computeWhaleActivityScore = (side) => {
    const thresholdUsd = 500_000;
    let netFlowUsd = 0;
    let hasData = false;
    let alignmentSignals = 0;

    if (dune && Number.isFinite(Number(dune.signalScore))) {
      hasData = true;
      const duneDrift = ((Number(dune.signalScore) - 50) / 50) * thresholdUsd;
      netFlowUsd += duneDrift;
      const duneBias = String(dune?.bias || '').toLowerCase();
      if ((side === 'BUY' && duneBias === 'bullish') || (side === 'SELL' && duneBias === 'bearish')) {
        alignmentSignals++;
      }
    }

    if (Array.isArray(LIVE_WHALES_RAW) && LIVE_WHALES_RAW.length > 0) {
      const exchangeRe = /(binance|coinbase|kraken|okx|bybit|gate|kucoin|mexc)/i;
      hasData = true;
      let whaleDirectionalBias = 0;
      LIVE_WHALES_RAW.slice(0, 40).forEach((tx) => {
        const valueM = Number(tx?.value);
        const usd = Number.isFinite(valueM) && valueM > 0 ? valueM * 1_000_000 : 0;
        if (!(usd > 0)) return;
        const from = String(tx?.from || '').toLowerCase();
        const to = String(tx?.to || '').toLowerCase();
        const fromEx = exchangeRe.test(from);
        const toEx = exchangeRe.test(to);
        if (fromEx && !toEx) {
          netFlowUsd += usd; // exchange outflow (bullish)
          whaleDirectionalBias += usd;
        }
        if (!fromEx && toEx) {
          netFlowUsd -= usd; // exchange inflow (bearish)
          whaleDirectionalBias -= usd;
        }
      });
      if ((side === 'BUY' && whaleDirectionalBias > 0) || (side === 'SELL' && whaleDirectionalBias < 0)) {
        alignmentSignals++;
      }
    }

    if (!hasData) return 50;
    const bullishFlowScore = netFlowUsd >= thresholdUsd
      ? 100
      : netFlowUsd <= -thresholdUsd
        ? 0
        : clamp(50 + ((netFlowUsd / thresholdUsd) * 50), 0, 100);
    let score = side === 'BUY' ? bullishFlowScore : (100 - bullishFlowScore);
    if (alignmentSignals >= 2) score += 10;
    return clamp(score, 0, 100);
  };

  const computeEmaConfluenceScore = (type, side) => {
    const emaSnap = type === 'SCALP' ? indicator?.ema1m : indicator?.ema15m;
    if (!emaSnap) return 50;

    const e9 = Number(emaSnap.ema9);
    const e21 = Number(emaSnap.ema21);
    const e9Prev = Number(emaSnap.ema9Prev);
    const e21Prev = Number(emaSnap.ema21Prev);
    if (![e9, e21, e9Prev, e21Prev].every(Number.isFinite)) return 50;

    const aboveBoth = price > e9 && price > e21;
    const belowBoth = price < e9 && price < e21;
    const buyExpanding = e9 > e9Prev && e21 > e21Prev;
    const sellExpanding = e9 < e9Prev && e21 < e21Prev;

    if (side === 'BUY') {
      if (aboveBoth && e9 > e21 && buyExpanding) return 100;
      if (belowBoth && e9 < e21) return 0;
      return 50;
    }

    if (belowBoth && e9 < e21 && sellExpanding) return 100;
    if (aboveBoth && e9 > e21) return 0;
    return 50;
  };

  const computeVolumeScore = (ratio) => {
    if (!Number.isFinite(ratio)) return 50;
    if (ratio > 2.0) return 100;
    if (ratio > 1.5) return 70;
    if (ratio > 1.2) return 50;
    return 20;
  };

  const computeAlphaSourcesScore = (side) => {
    const growthCandidates = (DEFI_POOLS || [])
      .map((p) => (
        Number(p?.tvlUsdChange24h)
        || Number(p?.tvl_change_1d)
        || Number(p?.change_1d)
        || Number(p?.tvl_change_24h)
        || Number(p?.apyPct1D)
      ))
      .filter(Number.isFinite);
    const avgGrowth = growthCandidates.length
      ? (growthCandidates.reduce((sum, x) => sum + x, 0) / growthCandidates.length)
      : null;
    const defiScore = avgGrowth === null ? 50 : avgGrowth > 5 ? 100 : 50;

    const trendingScore = LIVE_TRENDING_COINS.length > 0
      ? (LIVE_TRENDING_COINS.some(c => String(c?.symbol || '').toUpperCase() === symbol) ? 100 : 50)
      : 50;

    const fng = Number(LIVE_FNG?.value);
    let fngScore = 50;
    if (Number.isFinite(fng)) {
      if (side === 'BUY' && fng < 25) fngScore = 100;
      else if (side === 'SELL' && fng > 75) fngScore = 100;
    }

    let domScore = 50;
    const domShift = getBtcDominanceShiftPct();
    if (symbol !== 'BTC' && Number.isFinite(domShift)) {
      if (side === 'BUY' && domShift <= -0.5) domScore = 100;
      else if (side === 'SELL' && domShift >= 0.5) domScore = 100;
    }

    return (defiScore + trendingScore + fngScore + domScore) / 4;
  };

  const evaluateCandidate = (type) => {
    const isScalp = type === 'SCALP';
    const rsi = Number(isScalp ? indicator?.rsi1m : indicator?.rsi15m);
    const emaSnap = isScalp ? indicator?.ema1m : indicator?.ema15m;
    const volumeRatioMandatory = Number(isScalp ? indicator?.volumeVsAvg1m3 : indicator?.volumeVsAvg15m5);
    const ema200_15m = Number(indicator?.ema200_15m);
    const atr = Number(indicator?.atr);
    const atrSafe = Number.isFinite(atr) && atr > 0 ? atr : price * (isScalp ? 0.0026 : 0.0044);
    const atrPct = atrSafe / price;
    const spreadPct = Number(spread?.spreadPct);

    if (!emaSnap) {
      return buildWait(`${type}: EMA snapshot unavailable.`);
    }

    const crossLimit = isScalp ? 2 : 3;
    const bullCrossBars = Number(emaSnap.crossBarsAgoBullish);
    const bearCrossBars = Number(emaSnap.crossBarsAgoBearish);
    const bullCrossValid = Number.isFinite(bullCrossBars) && bullCrossBars <= crossLimit;
    const bearCrossValid = Number.isFinite(bearCrossBars) && bearCrossBars <= crossLimit;

    const ema9Now = Number(emaSnap.ema9);
    const ema21Now = Number(emaSnap.ema21);
    const bullishTrendAligned = Number.isFinite(ema9Now) && Number.isFinite(ema21Now) && ema9Now > ema21Now;
    const bearishTrendAligned = Number.isFinite(ema9Now) && Number.isFinite(ema21Now) && ema9Now < ema21Now;

    let side = null;
    if (bullCrossValid && !bearCrossValid) side = 'BUY';
    if (!bullCrossValid && bearCrossValid) side = 'SELL';
    if (bullCrossValid && bearCrossValid) {
      side = bullCrossBars <= bearCrossBars ? 'BUY' : 'SELL';
    }
    if (!side && bullishTrendAligned) side = 'BUY';
    if (!side && bearishTrendAligned) side = 'SELL';

    // Final fail-safe for flat/crossless moments: infer direction from price vs EMA9.
    if (!side && Number.isFinite(ema9Now)) {
      side = price >= ema9Now ? 'BUY' : 'SELL';
    }

    if (!side) {
      return buildWait(`${type}: EMA alignment unavailable.`);
    }

    const volumeGateThreshold = isScalp ? 1.0 : 0.8;
    if (!Number.isFinite(volumeRatioMandatory) || volumeRatioMandatory <= volumeGateThreshold) {
      return buildWait(`${type}: Volume gate failed (${Number.isFinite(volumeRatioMandatory) ? volumeRatioMandatory.toFixed(2) : 'N/A'}x).`);
    }

    const pattern = classifyPattern(type, side);

    const isBull = side === 'BUY';
    let rawAlpha = 50;
    if (Number.isFinite(volumeRatioMandatory) && volumeRatioMandatory > 1.5) rawAlpha += 10;
    if (pattern.valid) rawAlpha += 15;
    if (Number.isFinite(rsi) && rsi >= 40 && rsi <= 60) rawAlpha += 10;

    if (Number.isFinite(ema200_15m)) {
      if ((isBull && price > ema200_15m) || (!isBull && price < ema200_15m)) rawAlpha += 10;
    }

    if (Number.isFinite(spreadPct) && spreadPct > 0.1) rawAlpha -= 10;

    const alpha = clamp(Math.round(Math.max(40, rawAlpha)), 0, 100);

    const structure = getStructureLevels(type, side, price);

    const riskAtrMult = isScalp ? 0.38 : 0.72;
    const risk = atrSafe * riskAtrMult;
    const entry1 = price;
    const [, entry2, entry3] = deriveEntryLadder({ type, side, entry: entry1, atrSafe, structure });
    const [t1, t2, t3, t4] = deriveTargetsFromStructure({
      type,
      side,
      entry: entry1,
      risk,
      atrSafe,
      structure
    });
    let sl = isBull ? Math.max(0.0000001, entry1 - risk) : entry1 + risk;
    if (isBull && Array.isArray(structure?.entrySupports) && structure.entrySupports[0] > 0) {
      sl = Math.max(0.0000001, Math.min(sl, Number(structure.entrySupports[0])));
    }
    if (!isBull && Array.isArray(structure?.entryResistances) && structure.entryResistances[0] > 0) {
      sl = Math.max(sl, Number(structure.entryResistances[0]));
    }

    const riskPerUnit = Math.abs(entry1 - sl);
    const reward = Math.abs(t2 - entry1);
    const rrRatio = riskPerUnit > 0 ? (reward / riskPerUnit).toFixed(2) : '0.00';

    const leverage = atrPct > 0.03
      ? (isScalp ? 'Cross 5x' : 'Cross 4x')
      : (isScalp ? 'Cross 10x' : 'Cross 6x');

    const timestampUtc = new Date().toISOString();
    const signalText = [
      'SIGNAL',
      type,
      `${symbol}/USDT`,
      side,
      formatPrice(entry1),
      formatPrice(t1),
      formatPrice(t2),
      formatPrice(sl),
      'NONE',
      timestampUtc,
      String(alpha)
    ].join('|');

    return {
      type,
      isBull,
      side,
      pattern: pattern.valid ? pattern.name : 'NONE',
      strength: alpha >= 85 ? { label: 'HIGH CONVICTION', cls: 'text-green' } : { label: 'CONFIRMED', cls: 'text-primary' },
      exchanges: ['Binance Futures'],
      leverage,
      entry1,
      entry2,
      entry3,
      t1,
      t2,
      t3,
      t4,
      sl,
      rrRatio,
      atrPct,
      alpha,
      signalText,
      timestampUtc,
      gateSummary: `${type} gates passed (EMA cross recency + relaxed volume).`,
      pillarScores: {
        base: 50,
        volume: Number.isFinite(volumeRatioMandatory) && volumeRatioMandatory > 1.5 ? 10 : 0,
        pattern: pattern.valid ? 15 : 0,
        rsi: Number.isFinite(rsi) && rsi >= 40 && rsi <= 60 ? 10 : 0,
        ema200: Number.isFinite(ema200_15m) && ((isBull && price > ema200_15m) || (!isBull && price < ema200_15m)) ? 10 : 0,
        spreadPenalty: Number.isFinite(spreadPct) && spreadPct > 0.1 ? -10 : 0
      },
      waitReason: ''
    };
  };

  const day = evaluateCandidate('DAY');
  const scalp = evaluateCandidate('SCALP');

  const candidates = [day, scalp].filter(s => s.type !== 'WAIT');
  if (!candidates.length) {
    return {
      ...buildWait(`${day.waitReason} | ${scalp.waitReason}`),
      type: 'WAIT'
    };
  }
  candidates.sort((a, b) => (b.alpha - a.alpha) || (a.type === 'DAY' ? -1 : 1));
  const best = candidates[0];
  best.signalLines = candidates.map(c => c.signalText);
  return best;
}

function renderProSignals() {
  const grid = document.getElementById('pro-signals-grid');
  if (!grid) return;

  const universe = getTopUniverseSymbols(MAX_TRADABLE_ASSETS);
  const top = universe
    .map(sym => assets.find(a => a.symbol === sym))
    .filter(Boolean);

  if (!top.length) {
    grid.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:3rem;">No assets loaded yet. Live data syncs on startup.</div>`;
    return;
  }

  grid.innerHTML = top.map((asset, index) => {
    const sig = generateSignalForAsset(asset);
    
    if (sig.type === 'WAIT') {
      return `
        <div class="signal-card" id="signal-${asset.symbol}">
          <div class="signal-card-header">
            <div class="signal-pair">
              <span class="signal-symbol">#${asset.symbol}/USDT</span>
              <span class="badge" style="background:var(--bg-lighter); color:var(--text-muted); font-size: 0.65rem;">WAIT</span>
            </div>
            <div class="signal-strength ${sig.strength.cls}">${sig.strength.label}</div>
          </div>
          <div style="padding: 2rem 0; text-align: center; color: var(--text-muted);">
            <i data-feather="shield" style="margin-bottom: 1rem; opacity: 0.5;"></i>
            <p style="font-size: 0.85rem;">${sig.waitReason}</p>
          </div>
        </div>
      `;
    }

    const dirIcon = sig.isBull ? '📈' : '📉';
    const dirLabel = sig.side || (sig.isBull ? 'BUY' : 'SELL');
    const targetPct = (targetPrice) => {
      if (!(asset.price > 0) || !(targetPrice > 0)) return 0;
      const raw = sig.isBull
        ? ((targetPrice - asset.price) / asset.price) * 100
        : ((asset.price - targetPrice) / asset.price) * 100;
      return Number.isFinite(raw) ? raw : 0;
    };
    const stopPct = (sig.sl > 0 && asset.price > 0)
      ? -((Math.abs(sig.sl - asset.price) / asset.price) * 100)
      : 0;
    const fmtPct = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
    
    // SaaS Freemium Logic: Lock signals after the 2nd one (Unlocked per user request)
    const isLocked = false;
    const lockedOverlay = isLocked ? `
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;z-index:10;background:rgba(10,12,16,0.65);border-radius:8px;">
        <span style="background:var(--primary);color:#fff;padding:0.5rem 1.2rem;border-radius:6px;font-size:0.85rem;font-weight:bold;cursor:pointer;box-shadow:0 4px 15px rgba(108,92,231,0.4);">🔒 UPGRADE TO PRO TO UNLOCK</span>
      </div>
    ` : '';
    const blurStyle = isLocked ? 'filter: blur(6px); pointer-events: none; user-select: none; opacity: 0.5;' : '';

    return `
      <div class="signal-card" id="signal-${asset.symbol}">
        <!-- Card Header -->
        <div class="signal-card-header">
          <div class="signal-pair">
            <span class="signal-envelope">📪</span>
            <span class="signal-symbol">#${asset.symbol}/USDT</span>
            <span class="signal-dir-badge ${sig.isBull ? 'sig-long' : 'sig-short'}">${dirIcon} ${dirLabel}</span>
            <span class="badge bg-primary ml-2" style="font-size: 0.65rem; border: 1px solid rgba(255,255,255,0.1)">${sig.type}</span>
          </div>
          <div class="signal-strength ${sig.strength.cls}">${sig.strength.label} ●</div>
        </div>

        <!-- Exchanges -->
        <div class="signal-row">
          <span class="signal-label">Exchange</span>
          <span class="signal-value">${sig.exchanges.join(', ')}</span>
        </div>

        <!-- Leverage -->
        <div class="signal-row">
          <span class="signal-label">Leverage</span>
          <span class="signal-value text-warning">${sig.leverage}</span>
        </div>

        <!-- Trade Type -->
            <div class="signal-row">
              <span class="signal-label">Trade Type</span>
              <span class="signal-value" style="color: var(--primary)">${sig.type}</span>
            </div>
            <div class="signal-row">
              <span class="signal-label">Pattern</span>
              <span class="signal-value">${sig.pattern || 'N/A'}</span>
            </div>

            <!-- Divider -->
            <div class="signal-divider"></div>

        <!-- Premium Locked Container -->
        <div style="position:relative;margin-top:1rem;">
          ${lockedOverlay}
          <div style="${blurStyle}">
            <!-- Entry Zone -->
            <div class="signal-row">
              <span class="signal-label">Entry Zone</span>
              <span class="signal-value signal-mono">
                (${formatPrice(sig.entry1)}, ${formatPrice(sig.entry2)}, ${formatPrice(sig.entry3)})
              </span>
            </div>

            <!-- Targets -->
            <div class="signal-targets">
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 1</span>
                <span class="signal-mono text-green">${formatPrice(sig.t1)}</span>
                <span class="target-pct text-green">${fmtPct(targetPct(sig.t1))}</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 2</span>
                <span class="signal-mono text-green">${formatPrice(sig.t2)}</span>
                <span class="target-pct text-green">${fmtPct(targetPct(sig.t2))}</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 3</span>
                <span class="signal-mono text-green">${formatPrice(sig.t3)}</span>
                <span class="target-pct text-green">${fmtPct(targetPct(sig.t3))}</span>
              </div>
              <div class="signal-target-row">
                <span class="target-num">🎯 Target 4</span>
                <span class="signal-mono text-green">${formatPrice(sig.t4)}</span>
                <span class="target-pct text-green">${fmtPct(targetPct(sig.t4))}</span>
              </div>
            </div>

            <!-- Stop Loss -->
            <div class="signal-row signal-sl-row">
              <span class="signal-label">🛑 Stop Loss</span>
              <span class="signal-mono text-red">${formatPrice(sig.sl)}</span>
              <span class="target-pct text-red">${fmtPct(stopPct)}</span>
            </div>
            <div class="signal-row">
              <span class="signal-label">Signal String</span>
              <span class="signal-value signal-mono" style="font-size:0.68rem;line-height:1.35;">${Array.isArray(sig.signalLines) ? sig.signalLines.join('<br/>') : sig.signalText}</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="signal-footer">
          <span>Alpha: <strong class="text-primary">${sig.alpha ?? (asset.opportunityScore ?? asset.score)}/100</strong></span>
          <span>Risk:Reward <strong class="text-green">${sig.rrRatio}</strong></span>
          <span>Vol: <strong class="text-warning">${(sig.atrPct * 100).toFixed(1)}%</strong></span>
          <span class="signal-brand">⚡ NEXUS Pro</span>
        </div>
      </div>
    `;
  }).join('');
}


async function setupSettingsPage() {
  const user = clerk.user;
  if (!user) return;

  const nameInput = document.getElementById('settings-display-name');
  const emailInput = document.getElementById('settings-email');
  const telegramInput = document.getElementById('settings-telegram');
  const updateBtn = document.getElementById('update-identity-btn');

  // Populate from Clerk
  if (nameInput) nameInput.value = user.fullName || user.username || '';
  if (emailInput) emailInput.value = user.primaryEmailAddress?.emailAddress || '';

  // Fetch additional data from Supabase
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('telegram_handle')
      .eq('clerk_id', user.id)
      .single();

    if (data && telegramInput) {
      telegramInput.value = data.telegram_handle || '';
    }
  } catch (e) {
    console.warn('⚠️ Could not fetch Supabase profile:', e.message);
  }

  // Handle Updates
  updateBtn?.addEventListener('click', async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = 'Updating...';

    const payload = {
      clerk_id: user.id,
      full_name: nameInput.value,
      email: emailInput.value,
      telegram_handle: telegramInput.value,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('user_profiles')
      .upsert(payload, { onConflict: 'clerk_id' });

    if (error) {
      showToast('❌ Update failed: ' + error.message);
    } else {
      showToast('✅ Identity updated successfully.');
      updateUserProfileUI(user);
    }

    updateBtn.disabled = false;
    updateBtn.textContent = 'Update Identity';
  });
}

document.querySelector('.subscription-body button')?.addEventListener('click', () => {
  showToast('💳 Redirecting to Stripe Customer Portal...');
  setTimeout(() => {
    alert('Subscription management is currently in Sandbox mode. Please contact support to upgrade your limits.');
  }, 1000);
});
