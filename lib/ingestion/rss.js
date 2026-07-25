// ═══════════════════════════════════════════════════════
// RSS News — Cointelegraph via RSS2JSON (no API key)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const FEED_URL = 'https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fcointelegraph.com%2Frss';

export async function fetchNews() {
  const raw = await fetchJson(FEED_URL, {}, 10000);
  if (!raw?.items || !Array.isArray(raw.items)) return [];
  return raw.items.slice(0, 15).map(item =>
    createDataPoint('rss', '*', 'news_article', {
      title:       item.title,
      link:        item.link,
      pubDate:     item.pubDate,
      description: (item.description || '').replace(/<[^>]*>/g, '').slice(0, 200),
      categories:  item.categories || [],
      author:      item.author,
      thumbnail:   item.thumbnail || item.enclosure?.link,
    })
  );
}
