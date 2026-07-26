import { createClient } from '@supabase/supabase-js';
import { getServerEnv, ensureServerEnv } from '../lib/server-env.js';

ensureServerEnv();

const supabaseUrl = getServerEnv('VITE_SUPABASE_URL');
const supabaseKey = getServerEnv('SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in .env or .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function trackShadowProgress() {
  console.log('--- Shadow Mode Progress Report ---\n');

  try {
    const { data, error } = await supabase
      .from('shadow_signals')
      .select('symbol, status, created_at');

    if (error) {
      if (error.code === '42P01') {
        console.error("❌ Table 'shadow_signals' does not exist yet. Did you run the SQL migration?");
      } else {
        console.error("❌ Error fetching shadow signals:", error.message);
      }
      return;
    }

    if (!data || data.length === 0) {
      console.log("No signals logged to shadow_signals yet.");
      return;
    }

    const counts = {};
    const firstSignal = {};
    let total = 0;

    for (const row of data) {
      total++;
      if (!counts[row.symbol]) {
        counts[row.symbol] = { total: 0, open: 0, closed: 0 };
        firstSignal[row.symbol] = row.created_at;
      }
      
      counts[row.symbol].total++;
      
      if (row.status === 'open') {
        counts[row.symbol].open++;
      } else {
        counts[row.symbol].closed++;
      }
      
      if (new Date(row.created_at) < new Date(firstSignal[row.symbol])) {
        firstSignal[row.symbol] = row.created_at;
      }
    }

    console.log(`Total Shadow Signals Logged: ${total}\n`);
    
    // Sort by count descending
    const sortedSymbols = Object.keys(counts).sort((a, b) => counts[b].total - counts[a].total);
    
    console.log('Symbol'.padEnd(10) + ' | ' + 'Total'.padEnd(8) + ' | ' + 'Closed'.padEnd(8) + ' | ' + 'Open'.padEnd(8) + ' | ' + 'Days Active'.padEnd(12) + ' | ' + 'Status');
    console.log('-'.repeat(70));
    
    const now = new Date();
    for (const sym of sortedSymbols) {
      const stats = counts[sym];
      const start = new Date(firstSignal[sym]);
      const diffMs = now - start;
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      const isReady = stats.total >= 30 && days >= 28;
      const statusStr = isReady ? '✅ READY' : '⏳ GATHERING';

      console.log(
        sym.padEnd(10) + ' | ' +
        String(stats.total).padEnd(8) + ' | ' +
        String(stats.closed).padEnd(8) + ' | ' +
        String(stats.open).padEnd(8) + ' | ' +
        String(days + ' days').padEnd(12) + ' | ' +
        statusStr
      );
    }
    
    console.log('\nTarget for completion: Minimum 4 weeks (28 days) AND 30 signals per asset.');

  } catch (err) {
    console.error("Unexpected error:", err);
  }
}

trackShadowProgress();
