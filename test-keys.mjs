import fs from 'fs';

async function testKeys() {
  const envFile = fs.readFileSync('/Users/fakhirbaig/Documents/GitHub/AI CRYPTO DECISION ENGINE — DEMO VERSION/.env', 'utf8');
  const openaiKey = envFile.match(/OPENAI_API_KEY=(.*)/)[1].trim();
  const groqKey = envFile.match(/GROQ_API_KEY=(.*)/)[1].trim();

  console.log("Testing OpenAI...");
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{role: 'user', content: 'test'}]
      })
    });
    const data = await res.json();
    console.log("OpenAI Response:", data.error ? data.error : "SUCCESS");
  } catch(e) { console.log(e.message); }

  console.log("Testing Groq...");
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{role: 'user', content: 'test'}]
      })
    });
    const data = await res.json();
    console.log("Groq Response:", data.error ? data.error : "SUCCESS");
  } catch(e) { console.log(e.message); }
}

testKeys();
