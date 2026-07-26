import { sendTelegramAlert } from '../lib/signals/telegram.js';
import { createSignal } from '../lib/signals/schema.js';

async function runTests() {
  console.log('--- Telegram Routing & Isolation Tests ---\n');
  
  // Dummy raw signal
  const dummyRaw = {
    symbol: 'SHADOW/USDT',
    direction: 'long',
    timestamp: new Date().toISOString(),
    levels: { entries: [1.00], takeProfit: [1.10], stopLoss: 0.90 },
    confluenceScore: 185
  };
  
  // --- Test 1: Fail-Closed Behavior ---
  console.log('=== Test 1: Fail-Closed on Missing Shadow ID ===');
  process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
  delete process.env.SHADOW_TELEGRAM_CHAT_ID; // Explicitly unset
  
  const failClosedSignal = createSignal(dummyRaw);
  failClosedSignal.is_shadow = true;
  
  const res1 = await sendTelegramAlert(failClosedSignal);
  console.log(`Result: ${res1 ? 'SENT' : 'BLOCKED'}\n`);
  
  // --- Test 2: Shadow Routing ---
  console.log('=== Test 2: Shadow Signal Routing ===');
  process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
  process.env.SHADOW_TELEGRAM_CHAT_ID = '-1001234567890'; // Dummy ID
  
  const shadowSignal = createSignal(dummyRaw);
  shadowSignal.is_shadow = true;
  
  const res2 = await sendTelegramAlert(shadowSignal);
  console.log(`(Note: The network call will fail because the token is dummy, but observe the routing log above)\n`);
  
  // --- Test 3: Live Routing ---
  console.log('=== Test 3: Live Signal Routing (Non-Shadow) ===');
  process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
  process.env.SHADOW_TELEGRAM_CHAT_ID = '-1001234567890';
  
  const liveSignal = createSignal(dummyRaw);
  liveSignal.is_shadow = false;
  
  const res3 = await sendTelegramAlert(liveSignal);
  console.log(`Result: ${res3 ? 'ROUTED TO LIVE' : 'BLOCKED'}\n`);
  
  console.log('--- Tests Complete ---');
}

runTests();
