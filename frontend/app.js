/* ============================================================
   JARVIS MIRROR AI — Voice-Only Smart Mirror
   Everything is controlled by voice. No buttons needed.
   ============================================================ */

// ✅ n8n Workflow Automation Engine Configuration (as documented in Research Paper)
const N8N_WEBHOOK_URL = "http://localhost:5678/webhook/mirror-agent";
const USE_N8N_BACKEND = true; // Set to true to route requests through the n8n orchestrator pipeline

// ✅ Direct & Cloud Fallback Configuration (for Vercel deployment where localhost n8n is unreachable)
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// Note: Insert your Groq API key here for local offline dev, or configure GROQ_API_KEY in Vercel environment variables
const GROQ_KEY_LOCAL = localStorage.getItem("GROQ_API_KEY") || "YOUR_GROQ_API_KEY";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_FALLBACK_MODEL = "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";

// Smart AI Dispatcher: Routes through n8n Workflow Automation when available, with resilient proxy fallback
async function callGroqAPI(body) {
  // If n8n mode is enabled on localhost, try the n8n workflow pipeline with a fast 1.5s timeout
  if (USE_N8N_BACKEND && IS_LOCAL) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const n8nRes = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (n8nRes.ok) {
        const n8nData = await n8nRes.json();
        if (n8nData && (n8nData.reply || n8nData.response || (n8nData.choices && n8nData.choices[0]))) {
          return n8nData;
        }
      }
    } catch (e) {
      // Offline or timed out - seamlessly continue to direct AI engine
    }
  }

  // Direct Groq execution (Local / Cloud Serverless Proxy)
  if (IS_LOCAL) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + GROQ_KEY_LOCAL
        },
        body: JSON.stringify(body)
      });
      if (res.ok) return await res.json();
    } catch (_) {}

    // Fallback to proxy
    const fallbackRes = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!fallbackRes.ok) throw new Error("Groq API error: " + fallbackRes.status);
    return await fallbackRes.json();
  } else {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      let errDetail = "";
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) {
          errDetail = typeof errJson.error === 'object' ? (errJson.error.message || JSON.stringify(errJson.error)) : errJson.error;
        } else {
          errDetail = JSON.stringify(errJson);
        }
      } catch (_) {
        errDetail = await res.text();
      }
      throw new Error(`API error (${res.status}): ${errDetail || 'Endpoint not found or offline'}`);
    }
    return await res.json();
  }
}

let voiceMode = 'male';
let recognition = null;
let conversationActive = false;
let isProcessing = false;
let isSpeaking = false;
let speakCount = 0;
let recognitionRunning = false;
let ignoreInput = false;
let fullyAsleep = false;
let conversationHistory = [];
let currentLang = 'en-US';
let currentNewsHeadlines = '';  // Store live headlines so AI can reference them
let currentWeatherInfo = '';    // Store live weather so AI can reference it

// ========== LANGUAGE (voice-controlled) ==========
const LANG_NAMES = {
  'en-US': 'English', 'hi-IN': 'Hindi', 'ta-IN': 'Tamil',
  'te-IN': 'Telugu', 'kn-IN': 'Kannada', 'ml-IN': 'Malayalam'
};

// ========== MULTI-LINGUAL COMMAND DETECTORS ==========
function isWakeWord(text) {
  const check = (text || '').toLowerCase();
  return (
    // English
    check.includes('jarvis') ||
    check.includes('jarvish') ||
    check.includes('javis') ||
    check.includes('jarwis') ||
    check.includes('jervis') ||
    check.includes('charvis') ||
    check.includes('travis') ||
    check.includes('service') ||
    check.includes('wake up') ||
    check.includes('hey jarvis') ||
    check.includes('hey jarvish') ||
    check.includes('hi jarvis') ||
    check.includes('hello jarvis') ||
    // Hindi
    check.includes('जार्विस') ||
    check.includes('जार्विश') ||
    check.includes('जाविस') ||
    check.includes('हे जार्विस') ||
    check.includes('उठो') ||
    // Kannada
    check.includes('ಜಾರ್ವಿಸ್') ||
    check.includes('ಜಾರ್ವಿಶ್') ||
    check.includes('ಜಾವಿಸ್') ||
    check.includes('ಹೇ ಜಾರ್ವಿಸ್') ||
    check.includes('ಎದ್ದೇಳು') ||
    // Telugu & Tamil
    check.includes('జార్విస్') ||
    check.includes('జర్విస్') ||
    check.includes('జావిస్') ||
    check.includes('లే') ||
    check.includes('ஜார்விஸ்') ||
    check.includes('சார்விஸ்') ||
    check.includes('ஜார்வி') ||
    check.includes('சார்விஷ்') ||
    check.includes('எழுந்திரு')
  );
}

function isSleepCommand(text) {
  const t = (text || '').toLowerCase();
  return (
    // English
    t.includes('sleep') ||
    t.includes('bye') ||
    t.includes('goodbye') ||
    t.includes('good bye') ||
    t.includes('stop listening') ||
    t.includes('turn off') ||
    t.includes('go to sleep') ||
    // Hindi (Romanized & Devanagari)
    t.includes('so jao') ||
    t.includes('so ja') ||
    t.includes('alvida') ||
    t.includes('band karo') ||
    t.includes('shant raho') ||
    t.includes('सो जाओ') ||
    t.includes('सो जा') ||
    t.includes('अलविदा') ||
    t.includes('बाय') ||
    t.includes('स्लीप') ||
    t.includes('बंद करो') ||
    // Kannada (Romanized & Kannada script)
    t.includes('malagu') ||
    t.includes('nidre') ||
    t.includes('hogi ba') ||
    t.includes('nillu') ||
    t.includes('ಮುಕ್ತಾಯ') ||
    t.includes('ಮಲಗು') ||
    t.includes('ನಿದ್ರೆ') ||
    t.includes('ಹೋಗಿ ಬಾ') ||
    t.includes('ಬೈ') ||
    t.includes('ಸ್ಲೀಪ್') ||
    // Telugu & Tamil
    t.includes('nidrapo') ||
    t.includes('నిద్రపో') ||
    t.includes('thoongu') ||
    t.includes('தூங்கு')
  );
}

function isStopMusicCommand(text) {
  const s = (text || '').toLowerCase().trim();
  if (!s) return false;

  // If user is asking for recommendations, e.g. "top movies", "top songs", "top news", do NOT stop
  if (
    s.includes('top movie') ||
    s.includes('top song') ||
    s.includes('top news') ||
    s.includes('top headline') ||
    s.includes('top rated') ||
    s.includes('top 10') ||
    s.includes('top 5')
  ) {
    return false;
  }

  return (
    // English
    /\b(stop|top|pause|step|halt|quiet|enough|stopp|taap)\b/i.test(s) ||
    s.includes('music off') ||
    s.includes('turn off music') ||
    s.includes('stop the music') ||
    s.includes('shut up') ||
    // Hindi (Romanized & Devanagari)
    s.includes('band karo') ||
    s.includes('roko') ||
    s.includes('gaana band') ||
    s.includes('ruk jao') ||
    s.includes('बंद करो') ||
    s.includes('रोको') ||
    s.includes('स्टॉप') ||
    s.includes('टॉप') ||
    // Telugu (Romanized & Telugu script)
    s.includes('aapu') ||
    s.includes('paata aapu') ||
    s.includes('aagandi') ||
    s.includes('ఆపు') ||
    s.includes('పాట ఆపు') ||
    s.includes('స్టాప్') ||
    s.includes('టాప్') ||
    // Kannada (Romanized & Kannada script)
    s.includes('nillsu') ||
    s.includes('nillisi') ||
    s.includes('haadu nillsu') ||
    s.includes('ನಿಲ್ಲಿಸು') ||
    s.includes('ಹಾಡು ನಿಲ್ಲಿಸು') ||
    s.includes('ಸ್ಟಾಪ್') ||
    s.includes('ಟಾಪ್') ||
    // Tamil
    s.includes('nirutthu') ||
    s.includes('paattu nirutthu') ||
    s.includes('நிறுத்து') ||
    s.includes('பாட்டு நிறுத்து')
  );
}

// ========== FAST BIDIRECTIONAL LANGUAGE SWITCHING ==========
function checkLanguageSwitch(text) {
  const q = (text || '').toLowerCase().trim();
  if (!q) return false;

  // Never trigger language switch if user is specifically requesting music, songs, or news
  if (
    q.includes('song') || q.includes('music') || q.includes('play') ||
    q.includes('paata') || q.includes('haadu') || q.includes('gaana') ||
    q.includes('paatu') || q.includes('paadal') || q.includes('movie') ||
    q.includes('cinema') || q.includes('film') || q.includes('news') ||
    q.includes('vartha') || q.includes('samachar') ||
    (/[\u0B80-\u0BFF]/.test(q) && (q.includes('பாட்டு') || q.includes('பாடல்'))) ||
    (/[\u0C00-\u0C7F]/.test(q) && q.includes('పాట')) ||
    (/[\u0C80-\u0CFF]/.test(q) && q.includes('ಹಾಡು')) ||
    (/[\u0900-\u097F]/.test(q) && (q.includes('गाना') || q.includes('फिल्म')))
  ) {
    return false;
  }

  // 1. Tamil patterns
  const isTamil =
    q.includes('tamil') || q.includes('tamizh') || q.includes('thamil') ||
    q.includes('தமிழ்') || q.includes('தமில்') || q.includes('தமில') ||
    q.includes('தமில்ல') || q.includes('சுவிட்ச் டு தமிழ்') ||
    q.includes('தமிழுக்கு') || q.includes('தமில பேசு') ||
    q.includes('తమిళం') || q.includes('ತಮಿಳು') || q.includes('तमिल');

  // 2. Telugu patterns
  const isTelugu =
    q.includes('telugu') || q.includes('thelungu') ||
    q.includes('తెలుగు') || q.includes('తెలుంగు') ||
    q.includes('స్విచ్ టు తెలుగు') || q.includes('తెలుగుకి') ||
    q.includes('ತೆಲುಗು') || q.includes('तेलुगु') || q.includes('தெலுங்கு');

  // 3. Kannada patterns
  const isKannada =
    q.includes('kannada') || q.includes('kannad') ||
    q.includes('ಕನ್ನಡ') || q.includes('ಕನ್ನಡ್') ||
    q.includes('ಸ್ವಿಚ್ ಟು ಕನ್ನಡ') || q.includes('ಕನ್ನಡಕ್ಕೆ') ||
    q.includes('కన్నడ') || q.includes('कन्नड़') || q.includes('கன்னடம்');

  // 4. Hindi patterns
  const isHindi =
    q.includes('hindi') || q.includes('hindhi') ||
    q.includes('हिंदी') || q.includes('हिन्दी') ||
    q.includes('स्विच टू हिंदी') || q.includes('हिंदी में') ||
    q.includes('హిందీ') || q.includes('ಹಿಂದಿ') || q.includes('இந்தி');

  // 5. English patterns
  const isEnglish =
    q.includes('english') || q.includes('angrezi') || q.includes('angla') ||
    q.includes('ஆங்கிலம்') || q.includes('இங்கிலீஷ்') ||
    q.includes('சுவிட்ச் டு ஆங்கிலம்') || q.includes('சுவிட்ச் டு இங்கிலீஷ்') ||
    q.includes('ఇంగ్లీష్') || q.includes('ఇంగ్లీషు') || q.includes('ఆంగ్లం') ||
    q.includes('స్విచ్ టు ఇంగ్లీష్') ||
    q.includes('ಇಂಗ್ಲಿಷ್') || q.includes('ಆಂಗ್ಲ') ||
    q.includes('ಸ್ವಿಚ್ ಟು ಇಂಗ್ಲಿಷ್') ||
    q.includes('इंग्लिश') || q.includes('अंग्रेजी') || q.includes('अंग्रेज़ी') ||
    q.includes('स्विच टू इंग्लिश');

  // Action verbs or prepositions indicating intent to switch
  const hasSwitchIntent =
    q.includes('switch') || q.includes('change') || q.includes('turn') ||
    q.includes('speak') || q.includes('talk') || q.includes('bolo') ||
    q.includes('pesu') || q.includes('matladu') || q.includes('mathnadu') ||
    q.includes('in') || q.includes('to') || q.includes('into') || q.includes('lo') ||
    q.includes('mein') || q.includes('dalli') || q.includes('la') || q.includes('ku') ||
    q.includes('சுவிட்ச்') || q.includes('மாற்று') || q.includes('மாத்து') || q.includes('பேசு') ||
    q.includes('స్విచ్') || q.includes('మార్చు') || q.includes('మాట్లాడు') ||
    q.includes('ಸ್ವಿಚ್') || q.includes('ಬದಲಾಯಿಸು') || q.includes('ಮಾತನಾಡು') ||
    q.includes('स्विच') || q.includes('बदलो') || q.includes('बोलो');

  const words = q.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (isTamil && (hasSwitchIntent || wordCount <= 3)) {
    changeLanguage('ta-IN');
    return true;
  }
  if (isTelugu && (hasSwitchIntent || wordCount <= 3)) {
    changeLanguage('te-IN');
    return true;
  }
  if (isKannada && (hasSwitchIntent || wordCount <= 3)) {
    changeLanguage('kn-IN');
    return true;
  }
  if (isHindi && (hasSwitchIntent || wordCount <= 3)) {
    changeLanguage('hi-IN');
    return true;
  }
  if (isEnglish && (hasSwitchIntent || wordCount <= 3)) {
    changeLanguage('en-US');
    return true;
  }

  return false;
}

function changeLanguage(lang) {
  if (!lang || !LANG_NAMES[lang]) return;
  currentLang = lang;
  const langName = LANG_NAMES[lang] || 'English';

  // 1. Update UI Indicator instantly
  const voiceInd = document.getElementById('voice-indicator');
  if (voiceInd) {
    voiceInd.innerText = '🌐 LANG: ' + langName.toUpperCase() + ' | 🔊 VOICE: ' + (voiceMode === 'female' ? 'LISA' : 'MALE');
  }

  // 2. Clear stale history and activate conversation
  conversationHistory = [];
  conversationActive = true;
  setWakeStatus('🟢 JARVIS ACTIVE (' + langName.toUpperCase() + ')');
  showPulse(true);

  // 3. Reconfigure Speech Recognition language instantly
  if (recognition) {
    recognition.lang = currentLang;
    try { recognition.stop(); } catch(e) {}
    recognitionRunning = false;
  }

  // 4. Snappy confirmation
  let switchMsg = "Language switched to " + langName;
  if (lang === 'hi-IN') switchMsg = "भाषा हिंदी में बदल दी गई है";
  else if (lang === 'kn-IN') switchMsg = "ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ";
  else if (lang === 'te-IN') switchMsg = "భాష తెలుగులోకి మార్చబడింది";
  else if (lang === 'ta-IN') switchMsg = "மொழி தமிழுக்கு மாற்றப்பட்டது";

  setAIStatus("🌐 " + langName.toUpperCase());
  setAIResponse(switchMsg);

  // 5. Fast non-blocking speech confirmation and immediate mic start
  speakOnce(switchMsg, () => {
    safeStart(100);
  });
}

// ========== MULTI-LANGUAGE DIRECT AUDIO ENGINE ==========
const MUSIC_VOLUME = 0.9;

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

let musicPlaying = false;
let lastMusicQuery = 'Trending hit songs';
const audio = new Audio();
audio.volume = MUSIC_VOLUME;

audio.onerror = (e) => {
  console.warn("Audio stream error:", e);
  audio.pause();
  audio.src = "";
};
audio.onended = () => { nextSong(); };

// ========== PREFERRED SONG HELPERS ==========
function setPreferredSong(songName) {
  if (!songName) return;
  const cleanSong = songName.trim();
  localStorage.setItem('preferred_song', cleanSong);
  const msg = "Saved " + cleanSong + " as your preferred song!";
  setAIResponse("⭐ " + msg);
  speakOnce(msg);
}

function getPreferredSong(langKey) {
  return localStorage.getItem('preferred_song_' + langKey) || localStorage.getItem('preferred_song');
}

// ========== GENERAL MUSIC REQUEST DETECTOR ==========
function isGeneralMusicRequest(text) {
  const t = (text || '').toLowerCase().trim();
  if (!t) return false;

  // English general requests
  if (
    /^(play\s+)?(music|song|songs|a\s+song|some\s+song|some\s+songs|the\s+music|the\s+song|preferred\s+song|my\s+song|my\s+preferred\s+song|favorite\s+song|my\s+favorite\s+song)$/i.test(t) ||
    /^(start|resume|stream|put\s+on)\s+(music|song|songs|a\s+song)$/i.test(t)
  ) return true;

  // Language-specific general requests
  if (/^(play\s+)?(telugu|kannada|hindi|tamil|english)\s+(song|songs|music)$/i.test(t)) return true;
  if (/^(play\s+)?(song|songs|music)\s+in\s+(telugu|kannada|hindi|tamil|english)$/i.test(t)) return true;

  // Romanized Indic general requests
  if (/^(paatu\s+podu|paattu\s+podu|paata\s+pettu|paata\s+veiy|paata\s+paadu|haadu\s+haaku|gaana\s+bajao|gaana\s+chalao|gana\s+bajao|song\s+podu|song\s+pettu|song\s+haaku|song\s+bajao)$/i.test(t)) return true;

  // Indic scripts general requests
  if (/^(ப்ளே\s*சாங்|பாட்டு\s*போடு|பாடல்\s*போடு|பாடல்\s*இசைக்க|பாட்டு\s*பாடு|ஏதாவது\s*பாட்டு\s*போடு|சாங்\s*ப்ளே\s*பண்ணு|பாட்டு|பாடல்)$/.test(t)) return true;
  if (/^(ప్లే\s*సాంగ్|పాట\s*పెట్టు|పాట\s*ప్లే\s*చేయి|పాట\s*పాడు|ఏదైనా\s*పాట\s*పెట్టు|పాట)$/.test(t)) return true;
  if (/^(ಪ್ಲೇ\s*ಸಾಂಗ್|ಹಾಡು\s*ಹಾಕು|ಹಾಡು\s*ಪ್ಲೇ\s*ಮಾಡು|ಯಾವುದಾದರೂ\s*ಹಾಡು\s*ಹಾಕು|ಹಾಡು\s*ಕೇಳಿಸು|ಹಾಡು)$/.test(t)) return true;
  if (/^(प्ले\s*सॉन्ग|गाना\s*बजाओ|गाना\s*चलाओ|कोई\s*गाना\s*सुनाओ|गाना\s*लगाओ|गाना)$/.test(t)) return true;

  return false;
}

// ========== EXTRACT SPECIFIC SONG QUERY ==========
function extractSpecificSongQuery(text) {
  let q = (text || '').trim();
  // Strip wake words and pleasantries
  q = q.replace(/^(hey\s+)?(jarvis|jarvish|java)\s*,?\s*/i, '');
  q = q.replace(/^(please\s+|can\s+you\s+|will\s+you\s+)?/i, '');

  if (isGeneralMusicRequest(q)) return null;

  // Native script patterns:
  // Tamil: "[song] பாட்டு போடு" / "ப்ளே [song]" / "[song] பாட்டு"
  const taMatch = q.match(/^(?:ப்ளே|போடு)\s+(.+)/i) || q.match(/(.+?)\s+(?:பாட்டு\s*போடு|பாடல்\s*போடு|பாட்டு|பாடல்)$/i);
  if (taMatch && taMatch[1].trim().length > 1 && !isGeneralMusicRequest(taMatch[1])) return taMatch[1].trim();

  // Telugu: "[song] పాట పెట్టు" / "ప్లే [song]" / "[song] పాట"
  const teMatch = q.match(/^(?:ప్లే|పెట్టు)\s+(.+)/i) || q.match(/(.+?)\s+(?:పాట\s*పెట్టు|పాట\s*ప్లే|పాట)$/i);
  if (teMatch && teMatch[1].trim().length > 1 && !isGeneralMusicRequest(teMatch[1])) return teMatch[1].trim();

  // Kannada: "[song] ಹಾಡು ಹಾಕು" / "ಪ್ಲೇ [song]" / "[song] ಹಾಡು"
  const knMatch = q.match(/^(?:ಪ್ಲೇ|ಹಾಕು)\s+(.+)/i) || q.match(/(.+?)\s+(?:ಹಾಡು\s*ಹಾಕು|ಹಾಡು\s*ಪ್ಲೇ|ಹಾಡು)$/i);
  if (knMatch && knMatch[1].trim().length > 1 && !isGeneralMusicRequest(knMatch[1])) return knMatch[1].trim();

  // Hindi: "[song] गाना बजाओ" / "प्ले [song]" / "[song] गाना"
  const hiMatch = q.match(/^(?:प्ले|बजाओ)\s+(.+)/i) || q.match(/(.+?)\s+(?:गाना\s*बजाओ|गाना\s*चलाओ|गाना)$/i);
  if (hiMatch && hiMatch[1].trim().length > 1 && !isGeneralMusicRequest(hiMatch[1])) return hiMatch[1].trim();

  // English prefix: "play <song>", "start <song>", "stream <song>", "put on <song>"
  const playMatch = q.match(/^(?:play|start|put\s+on|sing|stream)\s+(?:the\s+song\s+|song\s+|music\s+|from\s+youtube\s+|on\s+youtube\s+)?(.+)/i);
  if (playMatch && playMatch[1]) {
    let song = playMatch[1].trim();
    song = song.replace(/\s+(on|from)\s+youtube$/i, '');
    song = song.replace(/\s+(please)$/i, '');
    song = song.replace(/\s+(song|songs|music)$/i, '');
    if (song.length > 1 && !isGeneralMusicRequest(song)) return song;
  }

  // English/Romanized suffix: "<song> song play" / "<song> paatu podu" / "<song> gaana bajao"
  const suffixMatch = q.match(/^(.+?)\s+(?:song|music|paata|haadu|gaana|paatu)\s*(?:play|karo|haaku|paadu|podu|pettu)?$/i);
  if (suffixMatch && suffixMatch[1]) {
    let song = suffixMatch[1].trim();
    if (song.length > 1 && !isGeneralMusicRequest(song)) return song;
  }

  return null;
}

// ========== PLAY MUSIC BY LANGUAGE OR PREFERENCE ==========
function playMusicByLanguage(lang) {
  let targetLangKey = 'english';
  const check = (lang || currentLang || '').toLowerCase();

  if (check.includes('tamil') || check.includes('ta') || /[\u0B80-\u0BFF]/.test(check)) targetLangKey = 'tamil';
  else if (check.includes('telugu') || check.includes('te') || /[\u0C00-\u0C7F]/.test(check)) targetLangKey = 'telugu';
  else if (check.includes('kannada') || check.includes('kn') || /[\u0C80-\u0CFF]/.test(check)) targetLangKey = 'kannada';
  else if (check.includes('hindi') || check.includes('hi') || /[\u0900-\u097F]/.test(check)) targetLangKey = 'hindi';

  // Check if user has a custom preferred song configured
  const preferred = getPreferredSong(targetLangKey);
  if (preferred) {
    playDirectMusic(preferred);
    return;
  }

  // Get curated top blockbuster hit
  const hits = TOP_HITS_BY_LANG[targetLangKey] || TOP_HITS_BY_LANG.english;
  const chosen = hits[Math.floor(Math.random() * hits.length)];
  lastMusicQuery = chosen;
  playDirectMusic(chosen);
}

async function playDirectMusic(query) {
  if (!query) return;
  audio.pause();
  audio.src = "";
  lastMusicQuery = query;

  const widget = document.getElementById('music-widget');
  const titleEl = document.getElementById('music-title');
  const statusEl = document.getElementById('music-status');

  if (widget) widget.style.display = 'block';
  if (titleEl) titleEl.innerText = query;
  if (statusEl) statusEl.innerText = "🎵 NOW PLAYING";
  setAIResponse("🎵 Playing: " + query);

  try {
    const res = await fetch(`/api/music?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.success && data.audioUrl) {
      audio.pause();
      audio.src = data.audioUrl;
      audio.volume = MUSIC_VOLUME;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          musicPlaying = true;
          if (titleEl) titleEl.innerText = data.title;
          if (statusEl) statusEl.innerText = "🎵 NOW PLAYING";
          setAIResponse("🎵 Playing: " + data.title);
        }).catch(err => {
          console.warn("Direct audio autoplay blocked by browser policy, will resume on touch:", err);
          musicPlaying = true;
          if (titleEl) titleEl.innerText = data.title;
          if (statusEl) statusEl.innerText = "🎵 NOW PLAYING";
          setAIResponse("🎵 Playing: " + data.title);
        });
      }
    } else {
      throw new Error(data.error || "No audio found");
    }
  } catch (err) {
    console.warn("Music search failed, playing fallback stream:", err);
    // Regional fallback direct streams
    const qLower = (query || '').toLowerCase();
    let fallbackTrack = { title: query, url: "https://stream.zeno.fm/0r0xa792kwzuv" };
    if (qLower.includes('kannada') || qLower.includes('kn')) {
      fallbackTrack = { title: "Kannada Melodies", url: "https://node-19.zeno.fm/fk3084x861zuv" };
    } else if (qLower.includes('telugu') || qLower.includes('te')) {
      fallbackTrack = { title: "Telugu Melody Hits", url: "https://stream.zeno.fm/cv8u190220hvv" };
    } else if (qLower.includes('hindi') || qLower.includes('hi')) {
      fallbackTrack = { title: "Bollywood Hits", url: "https://stream.zeno.fm/f3wvbbqmdg8uv" };
    } else if (qLower.includes('tamil') || qLower.includes('ta')) {
      fallbackTrack = { title: "Tamil Top Hits", url: "https://stream.zeno.fm/4w9w238v20hvv" };
    }
    audio.src = fallbackTrack.url;
    audio.play().catch(e => console.warn("Fallback play error:", e));
    musicPlaying = true;
    if (titleEl) titleEl.innerText = fallbackTrack.title;
    if (statusEl) statusEl.innerText = "🎵 NOW PLAYING";
    setAIResponse("🎵 Playing: " + fallbackTrack.title);
  }
}

// Backward compatibility alias
function playYouTubeMusic(query) {
  return playDirectMusic(query);
}

function stopMusic() {
  audio.pause();
  audio.currentTime = 0;
  audio.src = "";
  musicPlaying = false;
  const widget = document.getElementById('music-widget');
  if (widget) widget.style.display = 'none';
  setAIResponse("⏹ Music stopped!");
}

function pauseMusic() {
  audio.pause();
  musicPlaying = false;
  const statusEl = document.getElementById('music-status');
  if (statusEl) statusEl.innerText = '⏸ PAUSED';
  setAIResponse("⏸ Music paused!");
}

function resumeMusic() {
  if (audio.src) {
    audio.play().catch(e => console.log("Audio error:", e));
    musicPlaying = true;
    const statusEl = document.getElementById('music-status');
    if (statusEl) statusEl.innerText = '🎵 NOW PLAYING';
    setAIResponse("▶ Music resumed!");
  }
}

function nextSong() {
  playMusicByLanguage('');
}

function previousSong() {
  playMusicByLanguage('');
}

function toggleMusic() {
  if (musicPlaying) {
    pauseMusic();
    speakOnce("Music paused!");
  } else {
    if (audio.src && audio.src !== window.location.href) {
      resumeMusic();
      speakOnce("Music resumed!");
    } else {
      playMusicByLanguage('');
      speakOnce("Playing music for you!");
    }
  }
}

// ========== SYSTEM PROMPT (dynamic — includes current language) ==========
function getSystemPrompt() {
  const langName = LANG_NAMES[currentLang] || 'English';
  return {
    role: "system",
    content: `You are Jarvis, a fully capable smart mirror AI assistant. CRITICAL RULES:
1) Remember full conversation history and refer to previous questions.
2) Keep answers concise, natural, and direct (2-3 sentences max) since they are spoken on a mirror.
3) **MOVIE RECOMMENDATIONS & SUGGESTIONS:**
When the user asks for movie suggestions or what to watch:
- Give 3 to 4 top-rated, exciting movies tailored to their requested language or genre (e.g. Kannada, Hindi/Bollywood, Telugu, Tamil, Hollywood/English).
- For Kannada requests: KGF, Kantara, 777 Charlie, Lucia, Dia, Sapta Saagaradaache Ello.
- For Hindi requests: 3 Idiots, Dangal, Stree 2, Zindagi Na Milegi Dobara, Tumbbad.
- For Tamil requests: Vikram, Leo, Jailer, Ponniyin Selvan.
- For Telugu requests: RRR, Baahubali, Pushpa, Kalki 2898 AD.
- For English requests: Inception, Interstellar, The Dark Knight, Oppenheimer.
4) Always be accurate, enthusiastic, and direct. Act as a true personal assistant.
5) Donald Trump is the 47th US President since January 20 2025. Narendra Modi is PM of India since 2014.
6) You CAN play songs in different languages (Hindi, Kannada, Telugu, Tamil, English), suggest movies, analyze outfits, and answer any questions.
7) **YOU MUST REPLY IN ${langName.toUpperCase()} LANGUAGE.** The user's current language is set to ${langName}. Always respond in ${langName}. This is mandatory.
8) NAGARJUNA COLLEGE (NCET) KNOWLEDGE BASE:
- Full name: Nagarjuna College of Engineering and Technology (NCET), Devanahalli, Bangalore, Karnataka, India. Est. 2001 under NES/NCC Ltd. Autonomous under VTU, NAAC A+ Grade, NBA Accredited.
9) LIVE DATA ON SCREEN:
Current Weather: ${currentWeatherInfo || 'Not loaded yet'}
Today's Top Headlines: ${currentNewsHeadlines || 'Headlines not loaded yet'}`
  };
}

// ========== RESPONSE CLEANER ==========
function cleanResponse(data) {
  let text = '';
  if (typeof data === 'object') {
    if (data.reply) text = data.reply;
    else if (data.response) text = data.response;
    else if (data.choices && data.choices[0] && data.choices[0].message) {
      text = data.choices[0].message.content || '';
    } else {
      text = JSON.stringify(data);
    }
  } else if (typeof data === 'string') {
    text = data;
  }
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\{"?\s*answer\s*"?\s*:\s*"/i, '')
    .replace(/^\{"?\s*suggestions\s*"?\s*:\s*"/i, '')
    .replace(/"\s*\}$/i, '')
    .replace(/\\n/g, ' ')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ========== CLOCK ==========
function updateClock() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  document.getElementById('clock').innerText = hours + ':' + minutes;
  document.getElementById('date').innerText = now.toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric',
    month: 'long', day: 'numeric'
  }).toUpperCase();
}
updateClock();
setInterval(updateClock, 1000);

function getCurrentDateTime() {
  return new Date().toLocaleString('en-IN');
}

// ========== NEWS (Real headlines via Google News RSS) ==========
async function fetchNews() {
  document.getElementById('news-items').innerText = 'Fetching latest news...';
  try {
    const rssUrl = encodeURIComponent('https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en');
    const res = await fetch('https://api.rss2json.com/v1/api.json?rss_url=' + rssUrl + '&count=4');
    const data = await res.json();
    if (data.status === 'ok' && data.items && data.items.length > 0) {
      const headlinesList = data.items.slice(0, 4).map((item, i) => {
        let title = item.title;
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 0) title = title.substring(0, dashIdx);
        if (title.length > 60) title = title.substring(0, 57) + '...';
        return (i + 1) + '. ' + title;
      });
      const headlines = headlinesList.join('\n');
      document.getElementById('news-items').innerText = headlines;
      currentNewsHeadlines = data.items.slice(0, 4).map((item, i) => {
        let title = item.title;
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 0) title = title.substring(0, dashIdx);
        return (i + 1) + '. ' + title;
      }).join('\n');
    } else {
      loadBackupNews();
    }
  } catch(e) {
    console.log("News fetch error:", e);
    loadBackupNews();
  }
}

function loadBackupNews() {
  document.getElementById('news-items').innerText =
    '1. Jarvis AI Mirror Ready!\n2. Say Jarvis to start\n3. Ask about your outfit\n4. Say Play Music!';
}

fetchNews();
setInterval(fetchNews, 300000);

// ========== WEATHER ==========
async function fetchWeather() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      await fetchWeatherData(`${position.coords.latitude},${position.coords.longitude}`);
    }, () => {
      fetchWeatherData('');
    });
  } else {
    fetchWeatherData('');
  }
}

async function fetchWeatherData(locationQuery) {
  try {
    const res = await fetch(`https://wttr.in/${locationQuery}?format=j1`);
    const data = await res.json();
    const temp = data.current_condition[0].temp_C;
    const desc = data.current_condition[0].weatherDesc[0].value;
    const emoji = getWeatherEmoji(desc);

    let area = 'BANGALORE';
    if (data.nearest_area && data.nearest_area[0] && data.nearest_area[0].areaName[0]) {
      area = data.nearest_area[0].areaName[0].value;
    }

    document.getElementById('weather').innerText = emoji + ' ' + temp + '°C';
    document.getElementById('weather-desc').innerText = desc.toUpperCase();
    document.getElementById('weather-city').innerText = area.toUpperCase();
    currentWeatherInfo = temp + '°C, ' + desc + ', Location: ' + area;
  } catch(e) {
    document.getElementById('weather').innerText = '🌤 26°C';
    document.getElementById('weather-desc').innerText = 'CLEAR';
    document.getElementById('weather-city').innerText = 'BANGALORE';
  }
}
fetchWeather();
setInterval(fetchWeather, 600000);

function getWeatherEmoji(desc) {
  desc = (desc || '').toLowerCase();
  if (desc.includes('sunny') || desc.includes('clear')) return '☀️';
  if (desc.includes('cloud')) return '☁️';
  if (desc.includes('rain')) return '🌧️';
  if (desc.includes('storm')) return '⛈️';
  if (desc.includes('snow')) return '❄️';
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) return '🌫️';
  if (desc.includes('wind')) return '💨';
  return '🌤';
}

// ========== SPEECH RECOGNITION (Voice Control Engine) ==========
function setupRecognition() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    setAIResponse("❌ Use Chrome browser!");
    return;
  }

  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
  recognition.lang = currentLang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => {
    recognitionRunning = true;
    if (!conversationActive) {
      setWakeStatus('😴 SAY "JARVIS"');
    }
  };

  recognition.onresult = (event) => {
    let finalTranscript = '';
    let interimTranscript = '';
    let allText = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript;
      } else {
        interimTranscript += res[0].transcript;
      }
      for (let j = 0; j < res.length; j++) {
        allText += ' ' + res[j].transcript;
      }
    }

    const heard = (finalTranscript || interimTranscript).trim();
    const check = (heard + ' ' + allText).toLowerCase();

    // 1. INSTANT STOP FOR MUSIC (Works anytime in < 50ms)
    if (musicPlaying && isStopMusicCommand(check)) {
      stopMusic();
      return;
    }

    // 2. STOP / INTERRUPT JARVIS MID-SPEECH
    if (conversationActive && (isSpeaking || isProcessing)) {
      if (isStopMusicCommand(check) || check.includes('skip') || check.includes('cancel')) {
        interruptAndListen();
        return;
      }
    }

    // 3. INSTANT LANGUAGE SWITCH (Works ANYTIME — whether awake or asleep!)
    if (checkLanguageSwitch(heard) || checkLanguageSwitch(check)) {
      if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
      return;
    }

    if (ignoreInput || isSpeaking || isProcessing) return;

    // Show heard speech in real time
    if (heard) {
      document.getElementById('transcript').innerText = '👂 ' + heard;
    }

    // Wake word detection (when asleep)
    if (!conversationActive) {
      if (isWakeWord(check)) {
        if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
        activateConversation();
      }
      return;
    }

    // Ultra-Fast Listening: Process immediately if final transcript arrives
    if (finalTranscript.trim()) {
      if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
      processTranscript(finalTranscript.trim());
      return;
    }

    // Snappy Interim Debouncer: If user stops speaking for 650ms, process question!
    // Eliminates Chrome's 2.5-second dead silence wait
    if (interimTranscript.trim() && conversationActive && !isProcessing && !isSpeaking) {
      if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
      const textToRun = interimTranscript.trim();
      silenceDebounceTimer = setTimeout(() => {
        if (conversationActive && !isProcessing && !isSpeaking) {
          processTranscript(textToRun);
        }
      }, 650);
    }
  };

  function processTranscript(rawText) {
    if (silenceDebounceTimer) clearTimeout(silenceDebounceTimer);
    if (!rawText || !rawText.trim() || isProcessing || isSpeaking) return;

    const t = rawText.trim().toLowerCase();

    // Sleep commands
    if (isSleepCommand(t)) {
      goToSleep();
      return;
    }

    // Language switch commands
    if (checkLanguageSwitch(t)) {
      return;
    }

    // Stop music command in transcript
    if (musicPlaying && isStopMusicCommand(t)) {
      stopMusic();
      return;
    }

    // Setting preferred song
    const prefSetMatch = t.match(/(?:my\s+favorite\s+song\s+is|my\s+preferred\s+song\s+is|set\s+preferred\s+song\s+to|set\s+favorite\s+song\s+to)\s+(.+)/i);
    if (prefSetMatch && prefSetMatch[1]) {
      setPreferredSong(prefSetMatch[1]);
      return;
    }

    // Specific song requests (e.g. "play Arabic Kuthu", "play Believer", "play Kesariya", "play Samajavaragamana")
    const specificSong = extractSpecificSongQuery(rawText.trim());
    if (specificSong) {
      playDirectMusic(specificSong);
      return;
    }

    // Multi-Language general music requests (e.g. "play song", "பாட்டு போடு", "गाना बजाओ", "ಹಾಡು ಹಾಕು", "పాట పెట్టు")
    if (isGeneralMusicRequest(t)) {
      playMusicByLanguage('');
      return;
    }

    // Voice switch commands
    if (t.includes('lisa') || t.includes('female voice') || t.includes('switch to female') || t.includes('change to female')) {
      switchVoice('female');
      return;
    }
    if (t.includes('male voice') || t.includes('switch to male') || t.includes('change to male')) {
      switchVoice('male');
      return;
    }

    // Music navigation & volume commands
    if (t.includes('stop music') || t.includes('stop song') || t.includes('music off')) {
      stopMusic();
      speakOnce("Music stopped!");
      return;
    }
    if (t.includes('pause music') || t.includes('pause song')) {
      pauseMusic();
      speakOnce("Music paused!");
      return;
    }
    if (t.includes('resume music') || t.includes('continue music') || t.includes('unpause')) {
      resumeMusic();
      speakOnce("Music resumed!");
      return;
    }
    if (t.includes('next song') || t.includes('next music') || t.includes('skip song')) {
      nextSong();
      speakOnce("Playing next song!");
      return;
    }
    if (t.includes('previous song') || t.includes('last song')) {
      previousSong();
      speakOnce("Playing previous song!");
      return;
    }
    if (t.includes('volume up') || t.includes('louder')) {
      audio.volume = Math.min(1, audio.volume + 0.2);
      speakOnce("Volume increased!");
      return;
    }
    if (t.includes('volume down') || t.includes('quieter')) {
      audio.volume = Math.max(0.05, audio.volume - 0.2);
      speakOnce("Volume decreased!");
      return;
    }

    handleQuestion(rawText.trim());
  }
  };

  recognition.onerror = (event) => {
    recognitionRunning = false;
    console.warn("Speech recognition error:", event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setWakeStatus('❌ MIC PERMISSION NEEDED');
      setAIResponse('❌ Please allow microphone access in your browser settings!');
      return;
    }
    if (!fullyAsleep && !isSpeaking && !isProcessing) {
      safeStart(300);
    }
  };

  recognition.onend = () => {
    recognitionRunning = false;
    if (!fullyAsleep && !isSpeaking && !isProcessing) {
      safeStart(150);
    }
  };
}

function interruptAndListen() {
  if (currentTTSAudio) {
    try {
      currentTTSAudio.pause();
      currentTTSAudio.src = "";
    } catch(e) {}
    currentTTSAudio = null;
  }
  window.speechSynthesis.cancel();
  isSpeaking = false;
  isProcessing = false;
  ignoreInput = false;
  speakCount++;
  setWakeStatus('🟢 JARVIS ACTIVE...');
  setAIStatus('🎤 LISTENING...');
  showPulse(true);
  document.getElementById('transcript').innerText = '👂 Ask your question...';
  safeStart(100);
}

let restartTimer = null;
function safeStart(delay = 150) {
  if (recognitionRunning || fullyAsleep || isSpeaking || isProcessing) return;
  if (!recognition) setupRecognition();
  if (!recognition) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (recognitionRunning || fullyAsleep || isSpeaking || isProcessing) return;
    try {
      recognition.start();
    } catch(e) {}
  }, delay);
}

function safeStop() {
  if (restartTimer) clearTimeout(restartTimer);
  if (!recognitionRunning) return;
  try { recognition.stop(); } catch(e) {}
}

// ========== ACTIVATE / SLEEP ==========
function activateConversation() {
  if (conversationActive) return;
  fullyAsleep = false;
  conversationActive = true;
  isProcessing = false;
  conversationHistory = [];
  const langName = LANG_NAMES[currentLang] || 'English';
  setWakeStatus('🟢 JARVIS ACTIVE (' + langName.toUpperCase() + ')');
  showPulse(true);
  document.getElementById('transcript').innerText = '👂 "Jarvis" detected!';
  speakOnce("At your service! How can I help you?");
}

function goToSleep() {
  conversationActive = false;
  isProcessing = false;
  isSpeaking = false;
  ignoreInput = true;
  fullyAsleep = false; // Keep mic active to listen for wake word

  speakCount++;
  conversationHistory = [];
  window.speechSynthesis.cancel();
  safeStop();

  showPulse(false);
  setWakeStatus('😴 SAY "JARVIS"');
  setAIResponse('Ready to assist you!');
  setAIStatus('🤖 JARVIS AI MIRROR');
  document.getElementById('transcript').innerText = '';

  let byeMsg = "Goodbye! Say Jarvis when you need me!";
  if (currentLang === 'hi-IN') byeMsg = "अलविदा! जब भी ज़रूरत हो, जार्विस बोलें!";
  else if (currentLang === 'kn-IN') byeMsg = "ವಿದಾಯ! ನಿಮಗೆ ಅಗತ್ಯವಿದ್ದಾಗ ಜಾರ್ವಿಸ್ ಎಂದು ಹೇಳಿ!";
  else if (currentLang === 'te-IN') byeMsg = "సెలవు! మీకు అవసరమైనప్పుడు జార్విస్ అని చెప్పండి!";
  else if (currentLang === 'ta-IN') byeMsg = "விடைபெறுகிறேன்! தேவைப்படும்போது ஜார்விஸ் என்று சொல்லுங்கள்!";

  speakOnce(byeMsg, () => {
    setTimeout(() => {
      ignoreInput = false;
      safeStart(200);
    }, 300);
  });
}

// ========== QUESTION HANDLER (voice-driven) ==========
function handleQuestion(question) {
  const q = question.toLowerCase();

  // Sleep command fallback
  if (isSleepCommand(q)) {
    goToSleep();
    return;
  }

  // Stop music fallback
  if (isStopMusicCommand(q)) {
    stopMusic();
    speakOnce("Music stopped!");
    return;
  }

  // Language switch commands
  if (checkLanguageSwitch(q)) {
    return;
  }

  // Voice switch commands
  if (q.includes('lisa') || q.includes('female voice') || q.includes('switch to female') || q.includes('change to female')) {
    switchVoice('female');
    return;
  }
  if (q.includes('male voice') || q.includes('switch to male') || q.includes('change to male')) {
    switchVoice('male');
    return;
  }

  // Outfit / style check (triggers camera capture)
  if (
    q.includes('outfit') ||
    q.includes('dress') ||
    q.includes('wearing') ||
    q.includes('clothes') ||
    q.includes('how do i look') ||
    q.includes('style') ||
    q.includes('hair') ||
    q.includes('scan') ||
    q.includes('look at me') ||
    q.includes('check my outfit') ||
    q.includes('what am i wearing')
  ) {
    speakOnce("Let me take a look at your outfit!");
    setTimeout(() => captureAndAnalyze(), 1500);
    return;
  }

  // Everything else queries Groq AI engine
  sendToN8n(question);
}

// ========== SEND TO GROQ AI DIRECTLY ==========
async function sendToN8n(question) {
  isProcessing = true;
  showLoading(true);
  setAIStatus("⏳ PROCESSING...");
  showPulse(false);
  safeStop();

  const questionWithTime = question +
    " (Current date and time: " + getCurrentDateTime() + ")";

  conversationHistory.push({
    role: "user",
    content: questionWithTime
  });

  if (conversationHistory.length > 10) {
    conversationHistory = conversationHistory.slice(-10);
  }

  const messages = [getSystemPrompt(), ...conversationHistory];

  try {
    const data = await callGroqAPI({
      model: GROQ_MODEL,
      messages: messages,
      max_tokens: 120,
      temperature: 0.6
    });

    showLoading(false);

    let finalText = cleanResponse(data);
    if (!finalText) finalText = "I processed your request.";

    conversationHistory.push({
      role: "assistant",
      content: finalText
    });

    setAIStatus("🤖 JARVIS SAYS");
    setAIResponse(finalText);
    speakOnce(finalText);

  } catch (err) {
    showLoading(false);
    isProcessing = false;
    ignoreInput = false;
    conversationHistory.pop();

    // Fallback for Movie Suggestions if API is offline
    const isMovieQuery = /movie|cinema|film|picture|chitra|watch|suggest/i.test(question);
    if (isMovieQuery) {
      const fallbackMovieResponse = getCuratedMovieSuggestions(currentLang, question);
      conversationHistory.push({
        role: "assistant",
        content: fallbackMovieResponse
      });
      setAIStatus("🤖 JARVIS SAYS");
      setAIResponse(fallbackMovieResponse);
      speakOnce(fallbackMovieResponse);
      setTimeout(() => safeStart(), 800);
      return;
    }

    let displayMsg = err.message;
    let voiceMsg = err.message;

    if (displayMsg.includes('429')) {
      displayMsg = "Rate limit reached on AI engine. Retrying in a moment...";
      voiceMsg = "I'm temporarily rate limited. Please ask me again in just a moment!";
    }

    setAIResponse("❌ " + displayMsg);
    speakOnce(voiceMsg);
    setTimeout(() => safeStart(), 1000);
  }
}

function getCuratedMovieSuggestions(lang, query) {
  const q = (query || '').toLowerCase();
  if (q.includes('kannada') || lang === 'kn-IN') {
    return "🎬 Top Kannada Movies to watch:\n1. KGF Chapter 1 & 2 - Epic action blockbuster\n2. Kantara - Phenomenal folklore thriller\n3. 777 Charlie - Heartwarming emotional journey\n4. Sapta Saagaradaache Ello - Acclaimed romantic drama";
  }
  if (q.includes('telugu') || lang === 'te-IN') {
    return "🎬 Top Telugu Movies to watch:\n1. RRR - High-octane historical action\n2. Baahubali - Grand cinematic epic\n3. Pushpa: The Rise - Intense rustic action\n4. Kalki 2898 AD - Futuristic sci-fi spectacle";
  }
  if (q.includes('hindi') || q.includes('bollywood') || lang === 'hi-IN') {
    return "🎬 Top Bollywood Movies to watch:\n1. 3 Idiots - Timeless comedy-drama\n2. Dangal - Inspiring sports masterpiece\n3. Stree 2 - Blockbuster horror-comedy\n4. Zindagi Na Milegi Dobara - Iconic friendship road-trip";
  }
  if (q.includes('tamil') || lang === 'ta-IN') {
    return "🎬 Top Tamil Movies to watch:\n1. Vikram - Gritty action thriller\n2. Leo - High-voltage action drama\n3. Jailer - Superstar mass entertainer\n4. Ponniyin Selvan - Grand historic epic";
  }
  return "🎬 Top Acclaimed Movies to watch:\n1. Inception - Mind-bending sci-fi thriller\n2. Interstellar - Cosmic emotional masterpiece\n3. The Dark Knight - Legendary superhero drama\n4. Oppenheimer - Gripping historical biopic";
}

// ========== CAPTURE & ANALYZE OUTFIT ==========
async function captureAndAnalyze() {
  isProcessing = true;
  showLoading(true);
  showPulse(false);
  safeStop();
  setAIStatus("📸 SCANNING OUTFIT...");
  setAIResponse("📸 Capturing your image...");

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');

  if (video.readyState < 2) {
    showLoading(false);
    isProcessing = false;
    setAIResponse("❌ Camera not ready! Try again.");
    safeStart();
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.style.display = 'block';

  canvas.toBlob(async (blob) => {
    if (!blob) {
      showLoading(false);
      isProcessing = false;
      setAIResponse("❌ Could not capture image!");
      safeStart();
      return;
    }

    const base64 = await blobToBase64(blob);
    const imageData = base64.split(',')[1];

    if (!imageData) {
      showLoading(false);
      isProcessing = false;
      setAIResponse("❌ Image encoding failed!");
      safeStart();
      return;
    }

    try {
      const data = await callGroqAPI({
        model: GROQ_VISION_MODEL,
        messages: [
          getSystemPrompt(),
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze my outfit in this image. Tell me if it looks good, suggest improvements, and recommend accessories based on current weather. Keep it to 3 sentences max.' },
              { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageData } }
            ]
          }
        ]
      });

      showLoading(false);
      canvas.style.display = 'none';
      setAIStatus("✅ OUTFIT SCAN COMPLETE");

      let text = cleanResponse(data) || "Your outfit looks great!";

      conversationHistory.push({
        role: "assistant",
        content: "Outfit analysis: " + text
      });

      setAIResponse(text);
      speakOnce(text);

    } catch (err) {
      showLoading(false);
      canvas.style.display = 'none';
      isProcessing = false;
      ignoreInput = false;
      setAIResponse("❌ " + err.message);
      console.error("Outfit fetch error:", err);
      safeStart();
    }
  }, 'image/jpeg', 0.8);
}

// ========== SPEAK (TTS) — Mic stays ON so user can interrupt ==========
let currentTTSAudio = null;

function cleanTextForTTS(text) {
  if (!text) return '';
  return text
    .replace(/[*#_~`>]/g, '')
    .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectRegionalLang(text) {
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn'; // Kannada
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Hindi
  if (currentLang === 'ta-IN') return 'ta';
  if (currentLang === 'te-IN') return 'te';
  if (currentLang === 'kn-IN') return 'kn';
  if (currentLang === 'hi-IN') return 'hi';
  return null;
}

function speakOnce(text, onComplete) {
  speakCount++;
  const myCount = speakCount;

  // Cancel any existing TTS (speech synthesis and cloud audio)
  if (currentTTSAudio) {
    try {
      currentTTSAudio.pause();
      currentTTSAudio.src = "";
    } catch(e) {}
    currentTTSAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch(e) {}
  }

  const clean = cleanTextForTTS(text);
  if (!clean) {
    isSpeaking = false;
    isProcessing = false;
    ignoreInput = false;
    safeStart(100);
    if (onComplete) onComplete();
    return;
  }

  ignoreInput = true;
  isSpeaking = true;
  if (musicPlaying) audio.volume = 0.2;

  let completed = false;
  const finishSpeech = () => {
    if (completed || myCount !== speakCount) return;
    completed = true;
    isSpeaking = false;
    isProcessing = false;
    ignoreInput = false;
    if (musicPlaying) audio.volume = MUSIC_VOLUME;
    if (conversationActive) {
      const langName = LANG_NAMES[currentLang] || 'English';
      setWakeStatus('🟢 JARVIS ACTIVE (' + langName.toUpperCase() + ')');
      showPulse(true);
      const tr = document.getElementById('transcript');
      if (tr) tr.innerText = '';
    }
    safeStart(150);
    if (onComplete) onComplete();
  };

  // Strict watchdog timer: guarantees the mic is NEVER locked, maximum 3.5s speech lock
  const watchdogTime = Math.max(2000, Math.min(4500, clean.length * 60));
  const watchdogTimer = setTimeout(finishSpeech, watchdogTime);

  // Check if text is in a regional Indian language (Tamil, Telugu, Kannada, Hindi)
  const regionalCode = detectRegionalLang(clean);
  const code = regionalCode || (currentLang !== 'en-US' ? currentLang.split('-')[0] : null);

  if (code && code !== 'en') {
    const encoded = encodeURIComponent(clean.slice(0, 190));
    const directUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${code}&client=tw-ob&q=${encoded}`;
    const proxyUrl = `/api/tts?tl=${code}&q=${encoded}`;

    const tryAudio = (url, fallback) => {
      const cloudAudio = new Audio(url);
      cloudAudio.volume = 1.0;
      currentTTSAudio = cloudAudio;

      cloudAudio.onended = () => {
        clearTimeout(watchdogTimer);
        finishSpeech();
      };
      cloudAudio.onerror = fallback;
      cloudAudio.play().catch(fallback);
    };

    tryAudio(directUrl, () => {
      tryAudio(proxyUrl, () => {
        playBrowserTTS(clean, null, myCount, () => {
          clearTimeout(watchdogTimer);
          finishSpeech();
        });
      });
    });
    return;
  }

  // English SpeechSynthesis
  playBrowserTTS(clean, null, myCount, () => {
    clearTimeout(watchdogTimer);
    finishSpeech();
  });
}

function playBrowserTTS(text, targetVoiceOverride, myCount, onComplete) {
  setTimeout(() => {
    if (myCount !== speakCount) {
      if (onComplete) onComplete();
      return;
    }

    if (!('speechSynthesis' in window)) {
      if (onComplete) onComplete();
      return;
    }

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.volume = 1;
    utter.lang = currentLang;

    const voices = window.speechSynthesis.getVoices();
    let targetVoice = targetVoiceOverride || voices.find(v => v.lang === currentLang || v.lang.replace('_', '-') === currentLang);

    if (currentLang === 'en-US' || currentLang.startsWith('en')) {
      if (voiceMode === 'female') {
        utter.pitch = 1.8;
        const fv = voices.find(v =>
          v.name.toLowerCase().includes('lisa') ||
          v.name.toLowerCase().includes('zira') ||
          v.name.toLowerCase().includes('samantha') ||
          v.name.toLowerCase().includes('victoria') ||
          v.name.toLowerCase().includes('karen')
        );
        if (fv) targetVoice = fv;
      } else {
        utter.pitch = 0.8;
        const mv = voices.find(v =>
          v.name.toLowerCase().includes('david') ||
          v.name.toLowerCase().includes('mark') ||
          v.name.toLowerCase().includes('james') ||
          v.name.toLowerCase().includes('daniel')
        );
        if (mv) targetVoice = mv;
      }
    }

    if (targetVoice) {
      utter.voice = targetVoice;
    }

    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true;
      if (onComplete) onComplete();
    };

    utter.onend = cleanup;
    utter.onerror = cleanup;

    // Safety timeout for browser utterance (especially on regional voices)
    setTimeout(cleanup, 3500);

    try {
      window.speechSynthesis.speak(utter);
    } catch(e) {
      cleanup();
    }
  }, 50);
}

    window.speechSynthesis.speak(utter);
  }, 100);
}

// ========== VOICE SWITCH (voice-controlled) ==========
function switchVoice(mode) {
  voiceMode = mode;
  if (mode === 'female') {
    document.getElementById('voice-indicator').innerText = '🌐 LANG: ' + (LANG_NAMES[currentLang] || 'English').toUpperCase() + ' | 🔊 VOICE: LISA';
    document.getElementById('voice-indicator').style.color = '#ff69b4';
    speakOnce("Hi! I am Lisa your Jarvis mirror assistant!");
  } else {
    document.getElementById('voice-indicator').innerText = '🌐 LANG: ' + (LANG_NAMES[currentLang] || 'English').toUpperCase() + ' | 🔊 VOICE: MALE';
    document.getElementById('voice-indicator').style.color = '#888';
    speakOnce("Hello! Switched to male voice!");
  }
}

// ========== HELPERS ==========
function setWakeStatus(msg) {
  document.getElementById('wake-status').innerText = msg;
}
function setAIStatus(msg) {
  document.getElementById('ai-status').innerText = msg;
}
function setAIResponse(msg) {
  document.getElementById('ai-response').innerText = msg;
}
function showPulse(show) {
  document.getElementById('pulseRing').style.display = show ? 'block' : 'none';
}
function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'block' : 'none';
}
function blobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ========== STARTUP (100% Hands-Free Auto Start) ==========
let mirrorStarted = false;

function startMirror() {
  if (mirrorStarted) return;
  mirrorStarted = true;

  const mirrorEl = document.getElementById('main-mirror');
  if (mirrorEl) mirrorEl.style.display = 'block';

  // START SPEECH RECOGNITION IMMEDIATELY (Don't wait for camera)
  setupRecognition();
  safeStart(100);

  fetchWeather();
  fetchNews();

  // Initialize camera in parallel (audio: false ensures mic is never stolen!)
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      })
      .then(stream => {
        const video = document.getElementById('video');
        if (video) video.srcObject = stream;
        window.stream = stream;
      })
      .catch(err => {
        console.warn("Camera optional/denied:", err);
      });
  }
}

// 100% Hands-free Auto-start immediately on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startMirror);
} else {
  startMirror();
}
window.addEventListener('load', startMirror);

// Passive interaction listener (silently unlocks Web Audio if browser held it back)
document.addEventListener('click', () => {
  if (!recognitionRunning) safeStart(50);
}, { passive: true });
document.addEventListener('touchstart', () => {
  if (!recognitionRunning) safeStart(50);
}, { passive: true });

// Preload available SpeechSynthesis voices
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// Make startMirror available globally
window.startMirror = startMirror;
