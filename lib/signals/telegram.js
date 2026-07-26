// ═══════════════════════════════════════════════════════
// Telegram Delivery Service
// ═══════════════════════════════════════════════════════

import { formatSignalText } from './schema.js';
import { getServerEnv, ensureServerEnv } from '../server-env.js';

/**
 * Routes a signal to Telegram.
 * If signal.is_shadow is true, it routes EXCLUSIVELY to the private test channel.
 */
export async function sendTelegramAlert(signal) {
  ensureServerEnv();
  const botToken = getServerEnv('TELEGRAM_BOT_TOKEN');
  const shadowChatId = getServerEnv('SHADOW_TELEGRAM_CHAT_ID');

  if (!botToken) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN is not set. Skipping delivery.');
    return false;
  }

  const messageText = formatSignalText(signal);

  if (signal.is_shadow) {
    if (!shadowChatId) {
      console.error('[Telegram] FAIL-CLOSED: Shadow signal detected but SHADOW_TELEGRAM_CHAT_ID is not set. Aborting delivery to prevent leakage.');
      return false;
    }
    
    console.log(`[Telegram] Shadow signal detected. Routing exclusively to private test channel: ${shadowChatId}`);
    return await sendMessage(botToken, shadowChatId, messageText);
  }

  // Live signal logic: would normally fan out to users based on telegram_handle
  console.log(`[Telegram] Live signal detected. Would fan out to users...`);
  // Fan-out logic goes here in the future
  return true;
}

async function sendMessage(botToken, chatId, text) {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML' // Optional, formatting works without it usually if plain text
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`[Telegram] Failed to send message: ${errorData}`);
      return false;
    }

    console.log(`[Telegram] Successfully sent message to ${chatId}`);
    return true;
  } catch (e) {
    console.error(`[Telegram] Error sending message:`, e.message);
    return false;
  }
}
