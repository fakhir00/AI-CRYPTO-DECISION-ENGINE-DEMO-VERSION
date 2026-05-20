import { getServerEnv } from '../lib/server-env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const groqKey = getServerEnv('GROQ_API_KEY', 'VITE_GROQ_API_KEY');

  if (!groqKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is missing from environment variables.' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("Groq Serverless Function Error:", error);
    return res.status(500).json({ error: 'Failed to fetch Groq Hermes' });
  }
}
