// Vercel Serverless Function — High-performance low-latency Neural TTS stream proxy
// Provides crystal-clear native pronunciation for Tamil, Telugu, Kannada, Hindi, and English
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const text = (req.query.text || req.query.q || '').trim();
  const lang = (req.query.lang || req.query.tl || 'en').trim();

  if (!text) {
    return res.status(400).json({ error: 'Text query parameter is required' });
  }

  try {
    const cleanText = text.slice(0, 200);
    const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;

    const response = await fetch(googleTtsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'TTS upstream error' });
    }

    const audioBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(500).json({ error: 'Internal TTS error: ' + err.message });
  }
};
