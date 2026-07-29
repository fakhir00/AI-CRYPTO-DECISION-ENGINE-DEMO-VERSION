import { createClient } from '@supabase/supabase-js';

// Simple allowlist (modify as needed)
const ALLOWED_EMAILS = [
  'fakhir00@gmail.com',
  'fakhirbaig@gmail.com'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-email');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userEmail = req.headers['x-user-email'];
    
    // Validate email against allowlist (or allow all if ALLOWED_EMAILS is empty)
    if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(userEmail)) {
      return res.status(403).json({ 
        error: 'Forbidden: Your email is not on the beta allowlist.',
        email: userEmail 
      });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase Service Role Key configuration in Vercel.');
    }

    // Initialize with SERVICE ROLE KEY to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from('shadow_signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      count: data.length,
      data: data
    });
  } catch (error) {
    console.error('Beta Shadow Signals API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
