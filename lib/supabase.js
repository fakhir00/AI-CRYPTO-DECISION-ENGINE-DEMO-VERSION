import { createClient } from '@supabase/supabase-js';

const getEnv = (key) => {
  if (typeof process !== 'undefined' && process.env[key]) return process.env[key];
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) return import.meta.env[key];
  return '';
};

const supabaseUrl = getEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Missing Supabase environment variables in .env.local. Supabase sync is disabled.');
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : new Proxy({}, {
      get: () => {
        return () => {
          console.warn('⚠️ Supabase method called but environment variables are missing');
          return Promise.resolve({ data: null, error: new Error('Supabase not configured') });
        };
      }
    });

/**
 * Helper to get a Supabase client with the Clerk token for RLS
 * @param {string} clerkToken 
 */
export const getAuthenticatedSupabase = (clerkToken) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('⚠️ getAuthenticatedSupabase called but Supabase environment variables are missing.');
    return supabase;
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
  });
};
