// Vercel Serverless Function — searches for crystal-clear direct audio streams
const CryptoJS = require('crypto-js');

function cleanText(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function decryptSaavnMediaUrl(encUrl) {
  try {
    const key = CryptoJS.enc.Utf8.parse('38346591');
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encUrl) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 }
    );
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return null;
  }
}

// Fallback curated streams if network/search encounters an issue
const REGIONAL_FALLBACKS = {
  kannada: { title: 'Kannada Melodies', audioUrl: 'https://node-19.zeno.fm/fk3084x861zuv' },
  telugu: { title: 'Telugu Super Hits', audioUrl: 'https://stream.zeno.fm/cv8u190220hvv' },
  hindi: { title: 'Bollywood Classics', audioUrl: 'https://stream.zeno.fm/f3wvbbqmdg8uv' },
  tamil: { title: 'Tamil Top Hits', audioUrl: 'https://stream.zeno.fm/4w9w238v20hvv' },
  english: { title: 'Acoustic / Lo-Fi Beats', audioUrl: 'https://stream.zeno.fm/0r0xa792kwzuv' }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query.q || req.query.query || '';
  if (!query) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    // 1. Search JioSaavn API for lossless direct audio streams
    const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=10&p=1&q=${encodeURIComponent(query)}`;
    const response = await fetch(saavnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        for (const s of data.results) {
          const enc = s.more_info ? s.more_info.encrypted_media_url : null;
          if (enc) {
            const dec = decryptSaavnMediaUrl(enc);
            if (dec) {
              const audioUrl = dec.replace('_96.mp4', '_160.mp4');
              const rawTitle = cleanText(s.title);
              const artist = cleanText(s.more_info.music || s.primary_artists || '');
              return res.status(200).json({
                success: true,
                title: rawTitle,
                artist: artist,
                album: cleanText(s.more_info.album || ''),
                audioUrl: audioUrl,
                query: query
              });
            }
          }
        }
      }
    }

    // 2. Fallback based on query language hints
    const qLower = query.toLowerCase();
    let fb = REGIONAL_FALLBACKS.english;
    if (qLower.includes('kannada') || qLower.includes('kannad')) fb = REGIONAL_FALLBACKS.kannada;
    else if (qLower.includes('telugu')) fb = REGIONAL_FALLBACKS.telugu;
    else if (qLower.includes('hindi') || qLower.includes('bollywood')) fb = REGIONAL_FALLBACKS.hindi;
    else if (qLower.includes('tamil')) fb = REGIONAL_FALLBACKS.tamil;

    return res.status(200).json({
      success: true,
      title: fb.title,
      artist: 'Live Radio',
      album: 'Mirror Vox Music',
      audioUrl: fb.audioUrl,
      query: query
    });
  } catch (err) {
    console.error('Music search error:', err);
    return res.status(200).json({
      success: true,
      title: 'Top Hits Radio',
      artist: 'Mirror Vox',
      album: '',
      audioUrl: 'https://stream.zeno.fm/0r0xa792kwzuv',
      query: query
    });
  }
};
