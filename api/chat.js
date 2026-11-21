// Modern Vercel Serverless Function — proxies requests to Groq API
// Keeps GROQ_API_KEY secure in Vercel Environment Variables
// Features automatic multi-model fallback across active Groq Developer models

const TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b"
];

const VISION_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b"
];

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'GROQ_API_KEY environment variable is not configured in Vercel settings.' } });
    return;
  }

  try {
    const isVision = JSON.stringify(req.body).includes("image_url");

    // Select the appropriate pool of active Groq models
    const pool = isVision ? VISION_MODELS : TEXT_MODELS;
    const requested = req.body.model;

    // Build the ordered fallback list
    let modelsToTry = [];
    if (requested && pool.includes(requested)) {
      modelsToTry.push(requested);
      for (const m of pool) {
        if (m !== requested) modelsToTry.push(m);
      }
    } else {
      modelsToTry = [...pool];
    }

    let lastData = null;
    let lastStatus = 500;

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      const payload = { ...req.body, model };

      const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      lastStatus = groqResponse.status;
      lastData = await groqResponse.json();

      if (groqResponse.ok) {
        return res.status(200).json(lastData);
      }

      // If rate limited (429) or model deprecated/not found (404/400), try fallback model
      if ((groqResponse.status === 429 || groqResponse.status === 404 || groqResponse.status === 400) && i < modelsToTry.length - 1) {
        console.warn(`Model ${model} returned ${groqResponse.status}. Attempting fallback to ${modelsToTry[i+1]}...`);
        continue;
      }

      // Other error: break and return
      break;
    }

    return res.status(lastStatus).json(lastData);

  } catch (error) {
    res.status(500).json({ error: { message: 'Internal server error: ' + error.message } });
  }
};
