import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@clerk/backend';

// The verified emails allowed to view beta engine signals
const ALLOWED_EMAILS = [
  'fakhir00@gmail.com',
  'fakhirbaig27@gmail.com'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header.' });
    }

    const token = authHeader.replace('Bearer ', '');
    const secretKey = process.env.CLERK_SECRET_KEY;
    
    if (!secretKey) {
      throw new Error('Server configuration error: Missing CLERK_SECRET_KEY.');
    }

    // 1. Cryptographically verify the Clerk session token
    let verifiedPayload;
    try {
      verifiedPayload = await verifyToken(token, { secretKey });
    } catch (tokenErr) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired session token.' });
    }

    const clerkId = verifiedPayload.sub;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized: Token missing subject claim.' });
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server configuration error: Missing Supabase credentials.');
    }

    // Initialize with SERVICE ROLE KEY to bypass RLS for this secure route
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Look up the verified user's email from our DB (which was synced on login)
    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('clerk_id', clerkId)
      .single();

    if (profileErr || !profile?.email) {
      return res.status(403).json({ error: 'Forbidden: No email record found for this verified session.' });
    }

    // 3. Check the allowlist against the cryptographically verified email
    // Fail-closed: if ALLOWED_EMAILS is empty, this naturally blocks everyone.
    if (!ALLOWED_EMAILS.includes(profile.email)) {
      return res.status(403).json({ 
        error: 'Forbidden: Your email is not on the beta allowlist.',
        email: profile.email 
      });
    }

    // 4. Authorized. Fetch the shadow signals.
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

