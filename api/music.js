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

// Curated blockbuster hits for guaranteed preferred quality when general song is requested
const TOP_HITS_BY_LANG = {
  tamil: [
    'Arabic Kuthu - Halamithi Habibo',
    'Hukum - Thalaivar Alappara',
    'Naa Ready Leo',
    'Kaavaalaa Jailer',
    'Rowdy Baby Maari 2',
    'Vaathi Coming Master',
    'Hayyoda Jawan',
    'Chilla Chilla Thunivu'
  ],
  telugu: [
    'Samajavaragamana Ala Vaikunthapurramuloo',
    'Pushpa Pushpa Telugu',
    'Oo Antava Mawa Pushpa',
    'Butta Bomma',
    'Ramuloo Ramulaa',
    'Naatu Naatu RRR',
    'Inkem Inkem Inkem Kaavaale',
    'Srivalli Pushpa Telugu'
  ],
  kannada: [
    'Belakina Kavithe',
    'Ra Ra Rakkamma Vikrant Rona',
    'Singara Siriye Kantara',
    'Tagaru Banthu Tagaru',
    'Dheera Dheera KGF',
    'Karabuu Pogaru',
    'Salaam Rocky Bhai KGF'
  ],
  hindi: [
    'Kesariya Brahmastra',
    'Tum Hi Ho Aashiqui 2',
    'Apna Bana Le Bhediya',
    'Chaleya Jawan',
    'Raataan Lambiyan Shershaah',
    'Ghungroo War',
    'Tere Vaaste Zara Hatke',
    'Jhoome Jo Pathaan'
  ],
  english: [
    'Believer Imagine Dragons',
    'Shape of You Ed Sheeran',
    'Blinding Lights The Weeknd',
    'Levitating Dua Lipa',
    'Stay The Kid LAROI Justin Bieber',
    'As It Was Harry Styles',
    'Perfect Ed Sheeran'
  ]
};

// Common Indian script song mappings
const SCRIPT_SONG_MAP = [
  { match: /அரபிக்\s*குத்து/i, target: 'Arabic Kuthu - Halamithi Habibo' },
  { match: /ஹுகும்|ஹூக்கும்/i, target: 'Hukum - Thalaivar Alappara' },
  { match: /நா\s*ரெடி/i, target: 'Naa Ready Leo' },
  { match: /காவாலா/i, target: 'Kaavaalaa Jailer' },
  { match: /ரவுடி\s*பேபி/i, target: 'Rowdy Baby Maari 2' },
  { match: /வாத்தி\s*கமிங்/i, target: 'Vaathi Coming Master' },
  { match: /சாமஜவர|సామజవరగమన/i, target: 'Samajavaragamana Ala Vaikunthapurramuloo' },
  { match: /పుష్ప|புஷ்பா/i, target: 'Pushpa Pushpa Telugu' },
  { match: /ఊ\s*అంటావా|ஊ\s*சொல்றியா/i, target: 'Oo Antava Mawa Pushpa' },
  { match: /బుట్ట\s*బొమ్మ/i, target: 'Butta Bomma' },
  { match: /నాటు\s*నాటు|நாட்டு\s*கூத்து/i, target: 'Naatu Naatu RRR' },
  { match: /ಬೆಳಕಿನ\s*ಕವಿತೆ/i, target: 'Belakina Kavithe' },
  { match: /ರಾ\s*ರಾ\s*ರಕ್ಕಮ್ಮ/i, target: 'Ra Ra Rakkamma Vikrant Rona' },
  { match: /ಸಿಂಗಾರ\s*ಸಿರಿಯೆ/i, target: 'Singara Siriye Kantara' },
  { match: /ಟಗರು/i, target: 'Tagaru Banthu Tagaru' },
  { match: /ಧೀರ\s*ಧೀರ/i, target: 'Dheera Dheera KGF' },
  { match: /ಕೇಸರಿಯಾ|கேசரியா|కేసరియా|केसरिया/i, target: 'Kesariya Brahmastra' },
  { match: /तुम\s*ही\s*हो/i, target: 'Tum Hi Ho Aashiqui 2' },
  { match: /अपना\s*बना\s*ले/i, target: 'Apna Bana Le Bhediya' },
  { match: /चलेया/i, target: 'Chaleya Jawan' },
  { match: /रातां\s*लंबियां/i, target: 'Raataan Lambiyan Shershaah' },
  { match: /घुंघरू/i, target: 'Ghungroo War' },
  { match: /झूमे\s*जो\s*पठान/i, target: 'Jhoome Jo Pathaan' }
];

async function searchJioSaavn(searchTerm) {
  const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=8&p=1&q=${encodeURIComponent(searchTerm)}`;
  const response = await fetch(saavnUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (data.results && data.results.length > 0) {
    for (const s of data.results) {
      const enc = s.more_info ? s.more_info.encrypted_media_url : null;
      if (enc) {
        const dec = decryptSaavnMediaUrl(enc);
        if (dec) {
          const audioUrl = dec.replace('_96.mp4', '_160.mp4');
          return {
            title: cleanText(s.title),
            artist: cleanText(s.more_info.music || s.primary_artists || ''),
            album: cleanText(s.more_info.album || ''),
            audioUrl: audioUrl
          };
        }
      }
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const rawQuery = (req.query.q || req.query.query || '').trim();
  if (!rawQuery) {
    return res.status(400).json({ error: 'Query parameter "q" is required' });
  }

  try {
    let targetQuery = rawQuery;

    // 1. Check Indic script mappings first
    for (const m of SCRIPT_SONG_MAP) {
      if (m.match.test(rawQuery)) {
        targetQuery = m.target;
        break;
      }
    }

    // 2. Check if general language request (e.g. "Kannada top hit songs", "Tamil", "Hindi", "Trending")
    const qLower = targetQuery.toLowerCase();
    const isGeneralRequest =
      qLower.includes('top hit songs') ||
      qLower.includes('trending') ||
      /^(play\s+)?(music|song|songs|a\s+song|some\s+song)$/i.test(qLower) ||
      /^(telugu|kannada|hindi|tamil|english)\s*(song|songs|music)?$/i.test(qLower) ||
      /^(பாட்டு|பாடல்|பாட்டு போடு|పాట|పాట పెట్టు|హాಡು|ಹಾಡು ಹಾಕು|गाना|गाना बजाओ)$/.test(rawQuery);

    if (isGeneralRequest) {
      let langKey = 'english';
      if (qLower.includes('tamil') || /[\u0B80-\u0BFF]/.test(rawQuery)) langKey = 'tamil';
      else if (qLower.includes('telugu') || /[\u0C00-\u0C7F]/.test(rawQuery)) langKey = 'telugu';
      else if (qLower.includes('kannada') || /[\u0C80-\u0CFF]/.test(rawQuery)) langKey = 'kannada';
      else if (qLower.includes('hindi') || /[\u0900-\u097F]/.test(rawQuery)) langKey = 'hindi';

      const hits = TOP_HITS_BY_LANG[langKey] || TOP_HITS_BY_LANG.english;
      const randomHit = hits[Math.floor(Math.random() * hits.length)];
      targetQuery = randomHit;
    } else {
      // Clean query wrappers: remove "song", "songs", "music", "play" from edges
      let cleaned = targetQuery
        .replace(/^(?:play|stream|put on|start)\s+/i, '')
        .replace(/\s+(?:song|songs|music|paata|haadu|gaana|paatu|paadal)$/i, '')
        .replace(/^(?:the\s+song\s+|song\s+|music\s+)/i, '')
        .trim();
      if (cleaned.length > 1) {
        targetQuery = cleaned;
      }
    }

    // 3. Search JioSaavn with the refined target query
    let result = await searchJioSaavn(targetQuery);

    // If initial search failed and query was modified, try original
    if (!result && targetQuery !== rawQuery) {
      result = await searchJioSaavn(rawQuery);
    }

    if (result) {
      return res.status(200).json({
        success: true,
        title: result.title,
        artist: result.artist,
        album: result.album,
        audioUrl: result.audioUrl,
        query: rawQuery
      });
    }

    // Fallback: guaranteed stream from top hits
    const fallbackHit = TOP_HITS_BY_LANG.english[0];
    const fbResult = await searchJioSaavn(fallbackHit);
    if (fbResult) {
      return res.status(200).json({
        success: true,
        title: fbResult.title,
        artist: fbResult.artist,
        album: fbResult.album,
        audioUrl: fbResult.audioUrl,
        query: rawQuery
      });
    }

    return res.status(200).json({
      success: true,
      title: 'Top Hits Radio',
      artist: 'Mirror Vox',
      album: '',
      audioUrl: 'https://stream.zeno.fm/0r0xa792kwzuv',
      query: rawQuery
    });
  } catch (err) {
    console.error('Music search error:', err);
    return res.status(200).json({
      success: true,
      title: 'Top Hits Radio',
      artist: 'Mirror Vox',
      album: '',
      audioUrl: 'https://stream.zeno.fm/0r0xa792kwzuv',
      query: rawQuery
    });
  }
};
