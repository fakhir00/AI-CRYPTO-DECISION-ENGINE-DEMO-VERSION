// ═══════════════════════════════════════════════════════
// Reddit — r/CryptoCurrency Hot Threads (no API key)
// ═══════════════════════════════════════════════════════
import { fetchJson } from './config.js';
import { createDataPoint } from './schema.js';

const HOT_URL = 'https://www.reddit.com/r/CryptoCurrency/hot.json?limit=15';

export async function fetchHotPosts() {
  const raw = await fetchJson(HOT_URL, {
    headers: { 'User-Agent': 'NexusCryptoEngine/1.0' },
  });

  if (!raw?.data?.children) return [];

  const posts = raw.data.children
    .filter(c => c.data && !c.data.stickied)
    .slice(0, 10)
    .map(c => c.data);

  return posts.map(p =>
    createDataPoint('reddit', '*', 'reddit_post', {
      title:     p.title,
      score:     p.score,
      comments:  p.num_comments,
      upvoteRatio: p.upvote_ratio,
      url:       `https://reddit.com${p.permalink}`,
      created:   p.created_utc * 1000,
      author:    p.author,
      flair:     p.link_flair_text,
    })
  );
}
