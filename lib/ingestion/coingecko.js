// ═══════════════════════════════════════════════════════
// CoinGecko — Markets, Trending, Categories
// ═══════════════════════════════════════════════════════
import { KEYS, fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const BASE = 'https://api.coingecko.com/api/v3';

function headers() {
  const h = { Accept: 'application/json' };
  if (KEYS.coingecko) h['x-cg-demo-key'] = KEYS.coingecko;
  return h;
}

function cgFetch(path) {
  return fetchJson(`${BASE}${path}`, { headers: headers() }, 10000);
}

// ─── Top Markets by Market Cap ──────────────────────────
export async function fetchMarkets(perPage = 100, page = 1) {
  const raw = await cgFetch(
    `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=1h,24h,7d`
  );
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(c => {
    const sym = String(c.symbol).toUpperCase();
    return [
      createDataPoint('coingecko', sym, 'market_data', {
        name:         c.name,
        price:        c.current_price,
        marketCap:    c.market_cap,
        volume24h:    c.total_volume,
        change1h:     c.price_change_percentage_1h_in_currency,
        change24h:    c.price_change_percentage_24h,
        change7d:     c.price_change_percentage_7d_in_currency,
        ath:          c.ath,
        athChange:    c.ath_change_percentage,
        rank:         c.market_cap_rank,
        image:        c.image,
        id:           c.id,
      }),
    ];
  });
}

// ─── Trending Coins ─────────────────────────────────────
export async function fetchTrending() {
  const raw = await cgFetch('/search/trending');
  if (!raw?.coins) return [];
  return raw.coins.map(({ item }) =>
    createDataPoint('coingecko', String(item.symbol).toUpperCase(), 'trending', {
      name:       item.name,
      rank:       item.score + 1,
      marketCap:  item.data?.market_cap,
      price:      item.data?.price,
      change24h:  item.data?.price_change_percentage_24h?.usd,
      thumb:      item.thumb,
      id:         item.id,
    })
  );
}

// ─── Categories (Narratives / Sectors) ──────────────────
export async function fetchCategories() {
  const raw = await cgFetch('/coins/categories?order=market_cap_desc');
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 25).map(cat =>
    createDataPoint('coingecko', '*', 'category', {
      name:         cat.name,
      marketCap:    cat.market_cap,
      volume24h:    cat.volume_24h,
      change24h:    cat.market_cap_change_24h,
      topCoins:     cat.top_3_coins,
      id:           cat.id,
    })
  );
}

// ─── Global Market Data ─────────────────────────────────
export async function fetchGlobal() {
  const raw = await cgFetch('/global');
  if (!raw?.data) return [];
  const d = raw.data;
  return [
    createDataPoint('coingecko', '*', 'global_market', {
      totalMarketCap:  d.total_market_cap?.usd,
      totalVolume:     d.total_volume?.usd,
      btcDominance:    d.market_cap_percentage?.btc,
      ethDominance:    d.market_cap_percentage?.eth,
      activeCryptos:   d.active_cryptocurrencies,
      change24h:       d.market_cap_change_percentage_24h_usd,
    }),
  ];
}
