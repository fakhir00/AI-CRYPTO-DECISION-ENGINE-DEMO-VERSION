export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error("OpenAI Serverless Function Error:", error);
    return res.status(500).json({ error: 'Failed to fetch OpenAI' });
  }
}
