// ====================================================
// NEXUS API Engine — Backend & Supabase Client
// ====================================================

const API_HEALTH = {};

function setApiHealth(name, status = 'unknown', detail = '') {
  API_HEALTH[name] = { status, detail, checkedAt: new Date().toISOString() };
}
function markApiOk(name, detail = 'Live data received') { setApiHealth(name, 'ok', detail); }
function markApiDegraded(name, detail = 'Fallback data in use') { setApiHealth(name, 'degraded', detail); }
function markApiFailed(name, detail = 'No data') { setApiHealth(name, 'failed', detail); }

export function getApiHealthSnapshot() { return JSON.parse(JSON.stringify(API_HEALTH)); }
export function getApiHealthSummary() {
  const rows = Object.entries(API_HEALTH).map(([name, info]) => ({ name, ...info }));
  const ok = rows.filter(r => r.status === 'ok').length;
  const degraded = rows.filter(r => r.status === 'degraded').length;
  const failed = rows.filter(r => r.status === 'failed').length;
  return { total: rows.length, ok, degraded, failed, services: rows };
}
export function getApiHealthPromptSummary() {
  const rows = Object.entries(API_HEALTH).map(([name, info]) => `${name}: ${info.status}${info.detail ? ` (${info.detail})` : ''}`);
  return rows.length > 0 ? rows.join(' | ') : 'No API health checks have run yet.';
}

export async function fetchRuntimeApiHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`Health API HTTP ${res.status}`);
    const payload = await res.json();
    markApiOk('NEXUS Runtime Health', `${payload?.summary?.ok || 0}/${payload?.summary?.checked || 0} checks ok`);
    return payload;
  } catch (error) {
    markApiDegraded('NEXUS Runtime Health', error.message);
    return null;
  }
}

// ─── 0. AI Conversation Memory Buffer ────────────────────────────────────────
const AI_MEMORY = {
  history: [],   
  maxPairs: 10,  

  async add(role, content, userId = 'anonymous') {
    this.history.push({ role, content });
    while (this.history.length > this.maxPairs * 2) {
      this.history.shift();
    }
    
    // Sync to Supabase for cross-device consistency
    try {
      const { supabase } = await import('./lib/supabase.js');
      await supabase.from('user_profiles').upsert({
        clerk_id: userId,
        ai_memory: this.history,
        updated_at: new Date().toISOString()
      }, { onConflict: 'clerk_id' });
    } catch (e) {
      console.warn('⚠️ Memory cloud sync failed:', e.message);
    }
    
    try { localStorage.setItem('nexus_ai_memory', JSON.stringify(this.history)); } catch (e) { }
  },

  getMessages() {
    return [...this.history];
  },

  async load(userId = 'anonymous') {
    try {
      const { supabase } = await import('./lib/supabase.js');
      const { data } = await supabase.from('user_profiles').select('ai_memory').eq('clerk_id', userId).single();
      if (data?.ai_memory) {
        this.history = data.ai_memory;
        return;
      }
    } catch (e) { }

    try {
      const saved = localStorage.getItem('nexus_ai_memory');
      if (saved) this.history = JSON.parse(saved);
    } catch (e) { this.history = []; }
  }
};

AI_MEMORY.load();
export function addToAIMemory(role, content) { AI_MEMORY.add(role, content); }
export function clearAIMemory() { AI_MEMORY.clear(); }
export function getAIMemory() { return AI_MEMORY.getMessages(); }

// ====================================================
// 1. Market Data (From Vercel Backend)
// ====================================================
export async function fetchMarketData() {
  try {
    const res = await fetch('/api/market');
    if (!res.ok) throw new Error(`Market API HTTP ${res.status}`);
    const json = await res.json();
    markApiOk('Nexus Core Engine', `Data age: ${json.age || 0}s`);
    return json.data || [];
  } catch (error) {
    markApiFailed('Nexus Core Engine', error.message);
    return [];
  }
}

// ====================================================
// 2. Active Trade Signals (From Supabase)
// ====================================================
export async function fetchActiveSignals() {
  try {
    const { supabase } = await import('./lib/supabase.js');
    const { data, error } = await supabase
      .from('shadow_signals')
      .select('*')
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    markApiOk('Nexus Signals DB', `${data?.length || 0} active signals`);
    return data || [];
  } catch (error) {
    markApiFailed('Nexus Signals DB', error.message);
    return [];
  }
}

// ====================================================
// 3. Cached Auxiliary Data (From Supabase worker cache)
// ====================================================
async function getCachedData(cacheKey) {
  try {
    const { supabase } = await import('./lib/supabase.js');
    const { data, error } = await supabase
      .from('global_market_cache')
      .select('data')
      .eq('id', cacheKey)
      .single();
    if (error) throw error;
    markApiOk(cacheKey, 'Cached data loaded');
    return data?.data || null;
  } catch (error) {
    markApiDegraded(cacheKey, error.message);
    return null;
  }
}

export async function fetchGlobalMarketData() { return await getCachedData('coingecko_global'); }
export async function fetchWhaleActivity() { return await getCachedData('etherscan') || []; }
export async function fetchSentiment() { return await getCachedData('lunarcrush') || []; }
export async function fetchFearAndGreed() { return await getCachedData('alternativeme') || null; }
export async function fetchDefiPools() { return await getCachedData('defillama') || []; }
export async function fetchNews() { return await getCachedData('rss_news') || []; }
export async function fetchTrendingNarratives() { return await getCachedData('coingecko_trending') || []; }
export async function fetchBtcOnChain() { return await getCachedData('blockchain') || []; }
export async function fetchDuneMarketPulse() { return await getCachedData('dune') || null; }

// ====================================================
// 4. Stubs for UI Compatibility
// ====================================================
export async function fetchChartData() { return { labels: [], datasets: [] }; }
export async function fetchFundingRates() { return {}; }
export async function fetchOpenInterest() { return {}; }
export async function fetchOrderBookDepth() { return { asks: [], bids: [] }; }
export async function fetchCandlePatterns() { return []; }
export async function fetchTechnicalSignals() { return {}; }
export async function fetchAIAnalysis() { return '[AI analysis temporarily offline — engine rebuild in progress]'; }
export async function fetchHermesAnalysis() { return null; }
export async function fetchDualAI() { return '<div style="color:#BAC2DE;padding:1rem;">Signal engine is being rebuilt. Check back soon.</div>'; }
export function calculateAlphaScore() { return 50; }
