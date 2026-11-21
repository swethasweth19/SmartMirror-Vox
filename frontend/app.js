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
const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";

// Smart AI Dispatcher: Routes through n8n Workflow Automation when available, with resilient proxy fallback
async function callGroqAPI(body) {
  // If n8n mode is enabled on localhost, try the n8n workflow pipeline
  if (USE_N8N_BACKEND && IS_LOCAL) {
    try {
      const n8nRes = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (n8nRes.ok) {
        const n8nData = await n8nRes.json();
        if (n8nData && (n8nData.reply || n8nData.response || (n8nData.choices && n8nData.choices[0]))) {
          return n8nData;
        }
      }
    } catch (e) {
      console.log("n8n offline or unrouted, using direct AI engine fallback:", e);
    }
  }

  // Direct Groq execution (Local / Cloud Serverless Proxy)
  if (IS_LOCAL) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY_LOCAL
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error("Groq API error: " + res.status);
    return await res.json();
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
    check.includes('ஜார்விஸ்')
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
    // English (including common mishearings on phones like "top", "stop", "step", "stopp")
    /\b(stop|top|pause|step|halt|quiet|enough|stopp|taap)\b/i.test(s) ||
    s.includes('music off') ||
    s.includes('turn off music') ||
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
    s.includes('நிறுத்து')
  );
}

function checkLanguageSwitch(text) {
  const q = (text || '').toLowerCase().trim();
  if (!q) return false;

  // Ignore if user is asking for a song, music, movie, or news
  if (
    q.includes('song') || q.includes('music') || q.includes('play') ||
    q.includes('paata') || q.includes('haadu') || q.includes('gaana') ||
    q.includes('paatu') || q.includes('movie') || q.includes('cinema') ||
    q.includes('news') || q.includes('vartha') || q.includes('samachar')
  ) {
    return false;
  }

  // English triggers (Romanized + Telugu + Kannada + Hindi + Tamil scripts)
  const isEnglish =
    q.includes('english') || q.includes('angrezi') || q.includes('angla') ||
    q.includes('ఇంగ్లీష్') || q.includes('ఇంగ్లీషు') || q.includes('ఆంగ్లం') ||
    q.includes('ಇಂಗ್ಲಿಷ್') || q.includes('ಆಂಗ್ಲ') ||
    q.includes('इंग्लिश') || q.includes('अंग्रेजी') || q.includes('अंग्रेज़ी') ||
    q.includes('ஆங்கிலம்');

  // Telugu triggers
  const isTelugu =
    q.includes('telugu') ||
    q.includes('తెలుగు') ||
    q.includes('ತೆಲುಗು') ||
    q.includes('तेलुगु') ||
    q.includes('தெலுங்கு');

  // Kannada triggers
  const isKannada =
    q.includes('kannada') ||
    q.includes('ಕನ್ನಡ') ||
    q.includes('కన్నడ') ||
    q.includes('कन्नड़') ||
    q.includes('கன்னடம்');

  // Hindi triggers
  const isHindi =
    q.includes('hindi') ||
    q.includes('हिंदी') || q.includes('हिन्दी') ||
    q.includes('హిందీ') ||
    q.includes('ಹಿಂದಿ') ||
    q.includes('இந்தி');

  // Tamil triggers
  const isTamil =
    q.includes('tamil') ||
    q.includes('தமிழ்') ||
    q.includes('తమిళం') ||
    q.includes('ತಮಿಳು') ||
    q.includes('तमिल');

  // Action verbs or prepositions indicating language switch across all languages:
  const hasAction =
    q.includes('speak') || q.includes('talk') || q.includes('switch') || q.includes('change') ||
    q.includes('bolo') || q.includes('mathnadu') || q.includes('matladu') || q.includes('pesu') ||
    q.includes('in') || q.includes('lo') || q.includes('dalli') || q.includes('mein') || q.includes('la') ||
    q.includes('please') || q.includes('jarvis') ||
    q.includes('మాట్లాడు') || q.includes('మార్చు') || q.includes('లో') || // Telugu
    q.includes('ಮಾತನಾಡು') || q.includes('ಬದಲಾಯಿಸು') || q.includes('ನಲ್ಲಿ') || // Kannada
    q.includes('बोलो') || q.includes('बदलो') || q.includes('में') || // Hindi
    q.includes('பேசு') || q.includes('மாற்று'); // Tamil

  const wordCount = q.split(/\s+/).length;

  if (isEnglish && (hasAction || wordCount <= 3)) {
    changeLanguage('en-US');
    return true;
  }
  if (isTelugu && (hasAction || wordCount <= 3)) {
    changeLanguage('te-IN');
    return true;
  }
  if (isKannada && (hasAction || wordCount <= 3)) {
    changeLanguage('kn-IN');
    return true;
  }
  if (isHindi && (hasAction || wordCount <= 3)) {
    changeLanguage('hi-IN');
    return true;
  }
  if (isTamil && (hasAction || wordCount <= 3)) {
    changeLanguage('ta-IN');
    return true;
  }

  return false;
}

function changeLanguage(lang) {
  currentLang = lang;
  const langName = LANG_NAMES[lang] || 'English';
  document.getElementById('voice-indicator').innerText = '🌐 LANG: ' + langName.toUpperCase() + ' | 🔊 VOICE: ' + (voiceMode === 'female' ? 'LISA' : 'MALE');
  if (recognition) {
    recognition.lang = currentLang;
    safeStop();
    setTimeout(() => safeStart(200), 400);
  }

  let switchMsg = "Language switched to " + langName;
  if (lang === 'hi-IN') switchMsg = "भाषा हिंदी में बदल दी गई है";
  else if (lang === 'kn-IN') switchMsg = "ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ";
  else if (lang === 'te-IN') switchMsg = "భాష తెలుగులోకి మార్చబడింది";
  else if (lang === 'ta-IN') switchMsg = "மொழி தமிழுக்கு மாற்றப்பட்டது";

  setAIResponse(switchMsg);
  speakOnce(switchMsg);
}

// ========== MULTI-LANGUAGE MUSIC PLAYER ==========
const MUSIC_VOLUME = 0.9;

const musicPlaylists = {
  telugu: [
    { title: "Telugu Melody Hits", url: "https://a1.asurahosting.com:9580/radio.mp3", lang: "Telugu" },
    { title: "AP9FM Telugu Beats", url: "https://stream.ap9fm.in/radio/8000/radio.mp3", lang: "Telugu" },
    { title: "Telugu Hits Radio", url: "https://stream.zeno.fm/f3wvbbqmdg8uv", lang: "Telugu" }
  ],
  kannada: [
    { title: "Radio City Kannada Hits", url: "https://stream.zeno.fm/m3q5v4dvyc9uv", lang: "Kannada" },
    { title: "Sakkath Kannada Melodies", url: "https://stream.zeno.fm/m3q5v4dvyc9uv", lang: "Kannada" }
  ],
  hindi: [
    { title: "Hits of Bollywood Hindi", url: "https://stream.zeno.fm/8ty8szwpwfeuv", lang: "Hindi" },
    { title: "Radio Mirchi Bollywood", url: "https://eu8.fastcast4u.com/proxy/clyedupq/stream", lang: "Hindi" }
  ],
  tamil: [
    { title: "Tamil Radio Hits", url: "https://eu8.fastcast4u.com/proxy/clyedupq/stream", lang: "Tamil" }
  ],
  english: [
    { title: "Chill Lofi Beat", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", lang: "English" },
    { title: "Ambient Dreams Acoustic", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", lang: "English" },
    { title: "Morning Vibes Pop", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", lang: "English" },
    { title: "Evening Calm Groove", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", lang: "English" },
    { title: "Focus Mode Synth", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", lang: "English" }
  ]
};

let currentPlaylist = [
  ...musicPlaylists.hindi,
  ...musicPlaylists.kannada,
  ...musicPlaylists.english,
  ...musicPlaylists.telugu,
  ...musicPlaylists.tamil
];

let currentSongIndex = 0;
let musicPlaying = false;
const audio = new Audio();
audio.volume = MUSIC_VOLUME;

audio.onerror = (e) => {
  console.warn("Audio stream error:", e);
  audio.pause();
  audio.src = "";
};
audio.onended = () => { nextSong(); };

function playSong(song) {
  if (!song) song = currentPlaylist[currentSongIndex];
  audio.pause();
  audio.removeAttribute('crossorigin');
  audio.src = song.url;
  audio.volume = MUSIC_VOLUME;
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      musicPlaying = true;
      document.getElementById('music-widget').style.display = 'block';
      document.getElementById('music-title').innerText = song.title + (song.lang ? ' (' + song.lang + ')' : '');
      document.getElementById('music-status').innerText = '🎵 NOW PLAYING';
      setAIResponse("🎵 Playing: " + song.title);
    }).catch(e => {
      console.warn("Audio playback failed:", e);
    });
  }
}

let lastMusicQuery = 'Trending hit songs';

function playMusicByLanguage(lang) {
  lang = (lang || '').toLowerCase();
  let query = 'Trending hit songs';

  if (lang.includes('kannada') || lang === 'kn-in' || lang === 'kn') {
    query = 'Kannada top hit songs';
  } else if (lang.includes('hindi') || lang.includes('bollywood') || lang === 'hi-in' || lang === 'hi') {
    query = 'Bollywood top hit songs';
  } else if (lang.includes('telugu') || lang === 'te-in' || lang === 'te') {
    query = 'Telugu top melody hit songs';
  } else if (lang.includes('tamil') || lang === 'ta-in' || lang === 'ta') {
    query = 'Tamil top hit songs';
  } else if (lang.includes('english') || lang.includes('lofi') || lang.includes('pop')) {
    query = 'English top hit songs';
  } else {
    // Default based on current language setting
    if (currentLang === 'kn-IN') query = 'Kannada top hit songs';
    else if (currentLang === 'hi-IN') query = 'Bollywood top hit songs';
    else if (currentLang === 'te-IN') query = 'Telugu top melody hit songs';
    else if (currentLang === 'ta-IN') query = 'Tamil top hit songs';
    else query = 'Trending hit songs';
  }

  lastMusicQuery = query;
  playYouTubeMusic(query);
}

function extractSpecificSongQuery(text) {
  let q = (text || '').trim();
  // Strip wake words and pleasantries
  q = q.replace(/^(hey\s+)?(jarvis|jarvish|java)\s*,?\s*/i, '');
  q = q.replace(/^(please\s+|can\s+you\s+|will\s+you\s+)?/i, '');

  // If general requests, route to language playlists
  const generalPatterns = [
    /^(play\s+)?(music|song|songs|a\s+song|some\s+music|some\s+songs|the\s+music|the\s+song)$/i,
    /^(play\s+)?(telugu|kannada|hindi|tamil|english)\s+(song|songs|music)$/i,
    /^(play\s+)?(song|songs|music)\s+in\s+(telugu|kannada|hindi|tamil|english)$/i,
    /^(telugu|kannada|hindi|tamil|english)\s+(song|songs|music)$/i,
    /^(haadu\s+haaku|gaana\s+bajao|paata\s+paadu|paata\s+veiy)$/i
  ];
  for (const pat of generalPatterns) {
    if (pat.test(q.toLowerCase().trim())) return null;
  }

  // Pattern: "play <song name>" or "play song <song name>" or "play from youtube <song name>"
  const playMatch = q.match(/^(?:play|start|put\s+on|sing|stream)\s+(?:the\s+song\s+|song\s+|music\s+|from\s+youtube\s+|on\s+youtube\s+)?(.+)/i);
  if (playMatch && playMatch[1]) {
    let song = playMatch[1].trim();
    song = song.replace(/\s+(on|from)\s+youtube$/i, '');
    song = song.replace(/\s+(please)$/i, '');
    if (song.length > 1) return song;
  }

  // Suffix pattern: "<song name> song play"
  const suffixMatch = q.match(/^(.+?)\s+(?:song|music|paata|haadu|gaana)\s+(?:play|karo|haaku|paadu)$/i);
  if (suffixMatch && suffixMatch[1]) return suffixMatch[1].trim();

  return null;
}

async function playYouTubeMusic(query) {
  if (!query) return;
  audio.pause();
  audio.src = "";
  lastMusicQuery = query;

  const widget = document.getElementById('music-widget');
  const titleEl = document.getElementById('music-title');
  const statusEl = document.getElementById('music-status');
  const container = document.getElementById('youtube-player-container');
  const frame = document.getElementById('youtube-frame');

  if (widget) widget.style.display = 'block';
  if (titleEl) titleEl.innerText = "🔍 " + query;
  if (statusEl) statusEl.innerText = "⏳ SEARCHING YOUTUBE...";
  setAIResponse("🔍 Searching YouTube for: " + query + "...");

  try {
    const res = await fetch(`/api/youtube?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.success && data.embedUrl) {
      if (frame) frame.src = data.embedUrl;
      if (titleEl) titleEl.innerText = data.title;
      if (statusEl) statusEl.innerText = "▶ YOUTUBE MUSIC";
      musicPlaying = true;
      setAIResponse("🎵 Playing: " + data.title);
    } else {
      throw new Error(data.error || "No video found");
    }
  } catch (err) {
    console.warn("YouTube search failed:", err);
    setAIResponse("⚠️ Couldn't find video for " + query);
    if (widget) widget.style.display = 'none';
  }
}

function stopMusic() {
  audio.pause();
  audio.currentTime = 0;
  audio.src = ""; // Flushes radio audio buffer
  const yf = document.getElementById('youtube-frame');
  if (yf) yf.src = "";
  const yc = document.getElementById('youtube-player-container');
  if (yc) yc.style.display = 'none';
  musicPlaying = false;
  const widget = document.getElementById('music-widget');
  if (widget) widget.style.display = 'none';
  setAIResponse("⏹ Music stopped!");
}

function pauseMusic() {
  audio.pause();
  const yf = document.getElementById('youtube-frame');
  if (yf && yf.contentWindow) {
    yf.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
  }
  musicPlaying = false;
  document.getElementById('music-status').innerText = '⏸ PAUSED';
  setAIResponse("⏸ Music paused!");
}

function resumeMusic() {
  const yf = document.getElementById('youtube-frame');
  if (yf && yf.contentWindow && yf.src) {
    yf.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
  } else {
    audio.play().catch(e => console.log("Audio error:", e));
  }
  musicPlaying = true;
  document.getElementById('music-status').innerText = '🎵 NOW PLAYING';
  setAIResponse("▶ Music resumed!");
}

function nextSong() {
  const query = (lastMusicQuery || 'Trending hit songs') + ' hits';
  playYouTubeMusic(query);
}

function previousSong() {
  const query = (lastMusicQuery || 'Trending hit songs');
  playYouTubeMusic(query);
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
2) If user says 'tell me more', 'explain', 'brief it' - give more details in 4-5 sentences.
3) For standard factual questions, give concise answers in 2-3 sentences.
4) **MOVIE RECOMMENDATIONS & SUGGESTIONS:**
When the user asks for movie suggestions, recommendations, or what to watch:
- Give 3 to 4 top-rated, exciting movies tailored to their requested language or genre (e.g. Kannada, Hindi/Bollywood, Telugu, Tamil, Hollywood/English, Action, Comedy, Romance, Thriller, Sci-Fi).
- For Kannada movie requests, suggest acclaimed blockbusters like: KGF (Chapter 1 & 2), Kantara, 777 Charlie, Lucia, Dia, Sapta Saagaradaache Ello, or Ugramm.
- For Hindi/Bollywood requests, suggest top films like: 3 Idiots, Dangal, Stree 2, Zindagi Na Milegi Dobara, Tumbbad, or Sholay.
- For English/Hollywood requests, suggest acclaimed titles like: Inception, Interstellar, The Dark Knight, Oppenheimer, or Avengers.
- Format each with the movie title and a short 1-line reason why it is worth watching.
5) Always be accurate, enthusiastic, and direct. Act as a true personal assistant.
6) When checking an outfit, you must evaluate if the outfit suits the person based on real styling logic, suggest improvements, and MOST IMPORTANTLY: suggest accessories based on weather (e.g., if it's sunny, say "take an umbrella to block the sun" or "wear sunglasses"; if it's cold, suggest a jacket). Always proactively add these practical suggestions!
7) Donald Trump is the 47th US President since January 20 2025.
8) Narendra Modi is PM of India since 2014.
9) You CAN play songs in different languages (Hindi, Kannada, Telugu, Tamil, English), suggest movies, analyze outfits, and answer any questions.
10) Never say you cannot do something - always help and give great recommendations!
11) **YOU MUST REPLY IN ${langName.toUpperCase()} LANGUAGE.** The user's current language is set to ${langName}. Always respond in ${langName}. If the user speaks in ${langName}, you MUST reply in ${langName}. This is mandatory.
12) NAGARJUNA COLLEGE (NCET) KNOWLEDGE BASE - Answer any question about this college using these facts:
- Full name: Nagarjuna College of Engineering and Technology (NCET)
- Website: https://ncet.co.in
- Location: Devanahalli, Bangalore, Karnataka, India
- Established: 2001
- Founded by: Sri J.V. Ranga Raju (leading industrialist and philanthropist) under Nagarjuna Education Society (NES), established 1995, under NCC Ltd
- Affiliated to: Visvesvaraya Technological University (VTU)
- Autonomous institute under VTU
- Accreditations: NAAC A+ Grade, NBA Accredited, ISO 9001:2008 Certified, Approved by AICTE and UGC (Govt of India), Recognised by Govt of Karnataka, NIRF Ranking (Innovation Category)
- UG Programs (B.E.): Computer Science Engineering, Information Science, Mechanical Engineering, Civil Engineering, Electronics & Communication Engineering
- PG Programs (M.Tech): VLSI, Machine Design, Computer Science, Structural Engineering, Construction Technology
- Management: MBA (HR, Marketing, Finance), MCA
- Also offers PhD programmes
- Admissions: UG via KCET, COMEDK or Management Quota; PG via PGCET or GATE
- Placements 2024-25: Highest package INR 14 LPA, Average package INR 4.5 LPA
- Hostels: 10 hostels total (3 for girls), separate boys and girls hostels with mess
- Campus: Wi-Fi enabled smart classrooms, advanced labs, library, auditorium, innovation hubs, sports infrastructure, transport services, tech clubs
- Scholarships: State/national scholarships, SSP, NSP, fee reimbursement, Pragati scholarship (girls), PMSSS (J&K students)
- CSE Department: 20+ full-time faculty, high faculty-to-student ratio, focus on C programming, web design, data structures, ML, IoT, distributed systems, computer security
- Events: Hosts VTU Youth Festival Yuvothsava, technical fests, workshops, seminars
- Instagram: @ncet_official
- The college is known as one of the best engineering colleges in Bangalore/Karnataka

13) LIVE DATA ON SCREEN RIGHT NOW (use this to answer questions about current news, weather, etc.):
Current Weather: ${currentWeatherInfo || 'Not loaded yet'}
Today's Top Headlines:
${currentNewsHeadlines || 'Headlines not loaded yet'}
When user asks about any headline or news shown on screen, explain it using the headline information above. Do NOT say you cannot access real-time data — the headlines above ARE real-time and currently displayed on the mirror screen.`
  };
}

// ========== RESPONSE CLEANER ==========
function cleanResponse(data) {
  let text = '';
  if (typeof data === 'object') {
    if (data.answer) text = data.answer;
    else if (data.suggestions) text = data.suggestions;
    else if (data.choices && data.choices[0]) {
      text = data.choices[0].message.content;
    } else {
      text = JSON.stringify(data);
    }
  } else if (typeof data === 'string') {
    text = data;
  }
  text = text
    .replace(/^\{"?\s*answer\s*"?\s*:\s*"/i, '')
    .replace(/^\{"?\s*suggestions\s*"?\s*:\s*"/i, '')
    .replace(/"\s*\}$/i, '')
    .replace(/\\n/g, ' ')
    .replace(/\\/g, '')
    .trim();
  return text;
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
      // Store full titles so AI can answer questions about them
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

    let area = 'UNKNOWN';
    if (data.nearest_area && data.nearest_area[0] && data.nearest_area[0].areaName[0]) {
      area = data.nearest_area[0].areaName[0].value;
    }

    if (locationQuery.includes(',')) {
      try {
        const [lat, lon] = locationQuery.split(',');
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
        const geoData = await geoRes.json();
        if (geoData && geoData.address) {
          const addr = geoData.address;
          area = addr.amenity || addr.village || addr.suburb || addr.town || addr.city || area;
        }
      } catch(ge) {
        console.log("Reverse geocoding error", ge);
      }
    }

    document.getElementById('weather').innerText = emoji + ' ' + temp + '°C';
    document.getElementById('weather-desc').innerText = desc.toUpperCase();
    document.getElementById('weather-city').innerText = area.toUpperCase();
    // Store weather so AI can reference it
    currentWeatherInfo = temp + '°C, ' + desc + ', Location: ' + area;
  } catch(e) {
    document.getElementById('weather').innerText = '🌤 --°C';
    document.getElementById('weather-desc').innerText = 'UNAVAILABLE';
    document.getElementById('weather-city').innerText = 'OFFLINE';
  }
}
fetchWeather();
setInterval(fetchWeather, 600000);

function getWeatherEmoji(desc) {
  desc = desc.toLowerCase();
  if (desc.includes('sunny') || desc.includes('clear')) return '☀️';
  if (desc.includes('cloud')) return '☁️';
  if (desc.includes('rain')) return '🌧️';
  if (desc.includes('storm')) return '⛈️';
  if (desc.includes('snow')) return '❄️';
  if (desc.includes('fog') || desc.includes('mist') || desc.includes('haze')) return '🌫️';
  if (desc.includes('wind')) return '💨';
  return '🌤';
}

// ========== SPEECH SYNTHESIS (voices) ==========
window.speechSynthesis.onvoiceschanged = () => {
  window.speechSynthesis.getVoices();
};

// ========== SPEECH RECOGNITION ==========
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

    // 1. INSTANT STOP FOR MUSIC (Works anytime music is playing! Responds in < 50ms)
    if (musicPlaying && isStopMusicCommand(check)) {
      stopMusic();
      return;
    }

    // 2. "Stop" interrupts Jarvis mid-speech — works even while he's talking
    if (conversationActive && (isSpeaking || isProcessing)) {
      if (isStopMusicCommand(check) || check.includes('skip') || check.includes('cancel')) {
        interruptAndListen();
        return;
      }
    }

    if (ignoreInput || isSpeaking || isProcessing) return;

    // Show heard speech in real time so user knows mic is hearing them
    if (heard) {
      document.getElementById('transcript').innerText = '👂 ' + heard;
    }

    // Wake word detection (when asleep) — uses INTERIM and FINAL results for instant response
    if (!conversationActive) {
      if (isWakeWord(check)) {
        activateConversation();
      }
      return;
    }

    // Process final transcript
    if (finalTranscript.trim() && !isProcessing && !isSpeaking) {
      const t = finalTranscript.trim().toLowerCase();

      // Sleep commands
      if (isSleepCommand(t)) {
        goToSleep();
        return;
      }

      // Language switch commands
      if (checkLanguageSwitch(t)) {
        return;
      }

      // Stop music command in final transcript
      if (musicPlaying && isStopMusicCommand(t)) {
        stopMusic();
        return;
      }

      // Check for specific song requests (YouTube search, e.g. "play Arabic Kuthu", "play Believer")
      const specificSong = extractSpecificSongQuery(t);
      if (specificSong) {
        playYouTubeMusic(specificSong);
        return;
      }

      // Multi-Language Music commands (handles "play song in telugu", "play telugu song", "play telugu", etc.)
      const isMusicRequest =
        t.includes('song') ||
        t.includes('music') ||
        t.includes('play') ||
        t.includes('gaana') ||
        t.includes('haadu') ||
        t.includes('paata') ||
        t.includes('paatu');

      if (isMusicRequest) {
        if (t.includes('telugu') || t.includes('తెలుగు') || t.includes('paata')) {
          playMusicByLanguage('telugu');
          return;
        }
        if (t.includes('kannada') || t.includes('ಕನ್ನಡ') || t.includes('haadu')) {
          playMusicByLanguage('kannada');
          return;
        }
        if (t.includes('hindi') || t.includes('हिंदी') || t.includes('bollywood') || t.includes('gaana')) {
          playMusicByLanguage('hindi');
          return;
        }
        if (t.includes('tamil') || t.includes('தமிழ்') || t.includes('paatu')) {
          playMusicByLanguage('tamil');
          return;
        }
        if (t.includes('english') || t.includes('lofi') || t.includes('pop')) {
          playMusicByLanguage('english');
          return;
        }
        if (
          t.includes('play music') ||
          t.includes('play song') ||
          t.includes('start music') ||
          t.includes('play some music') ||
          t.includes('play a song') ||
          t.includes('music on') ||
          t.includes('play the music') ||
          t.includes('play the song') ||
          t.includes('play songs') ||
          t.includes('haadu haaku')
        ) {
          playMusicByLanguage('');
          return;
        }
      }
      if (
        t.includes('stop music') ||
        t.includes('stop song') ||
        t.includes('music off') ||
        t.includes('turn off music') ||
        t.includes('stop the music')
      ) {
        stopMusic();
        speakOnce("Music stopped!");
        return;
      }
      if (t.includes('pause music') || t.includes('pause song')) {
        pauseMusic();
        speakOnce("Music paused!");
        return;
      }
      if (
        t.includes('resume music') ||
        t.includes('continue music') ||
        t.includes('play again') ||
        t.includes('unpause')
      ) {
        resumeMusic();
        speakOnce("Music resumed!");
        return;
      }
      if (
        t.includes('next song') ||
        t.includes('next music') ||
        t.includes('skip song') ||
        t.includes('next track')
      ) {
        nextSong();
        speakOnce("Playing next song!");
        return;
      }
      if (
        t.includes('previous song') ||
        t.includes('last song') ||
        t.includes('previous track')
      ) {
        previousSong();
        speakOnce("Playing previous song!");
        return;
      }
      if (
        t.includes('volume up') ||
        t.includes('louder') ||
        t.includes('turn up')
      ) {
        audio.volume = Math.min(1, audio.volume + 0.2);
        speakOnce("Volume increased!");
        return;
      }
      if (
        t.includes('volume down') ||
        t.includes('quieter') ||
        t.includes('turn down')
      ) {
        audio.volume = Math.max(0.05, audio.volume - 0.2);
        speakOnce("Volume decreased!");
        return;
      }

      handleQuestion(finalTranscript.trim());
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
    if (event.error === 'no-speech') {
      // Normal pause/silence timeout
      if (!fullyAsleep && !isSpeaking && !isProcessing) {
        safeStart(200);
      }
      return;
    }
    if (!fullyAsleep && !isSpeaking && !isProcessing) {
      safeStart(400);
    }
  };

  recognition.onend = () => {
    recognitionRunning = false;
    if (!fullyAsleep && !isSpeaking && !isProcessing) {
      safeStart(200);
    }
  };
}

function interruptAndListen() {
  if (currentTTSAudio) {
    currentTTSAudio.pause();
    currentTTSAudio.src = "";
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
  safeStart(200);
}

let restartTimer = null;
function safeStart(delay = 200) {
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
  setWakeStatus('🟢 JARVIS ACTIVE...');
  showPulse(true);
  document.getElementById('transcript').innerText = '👂 "Jarvis" detected!';
  speakOnce("At your service! How can I help you?");
}

function goToSleep() {
  conversationActive = false;
  isProcessing = false;
  isSpeaking = false;
  ignoreInput = true;
  fullyAsleep = false;  // Keep mic running to listen for wake word

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

  const utter = new SpeechSynthesisUtterance(byeMsg);
  utter.rate = 1.0;
  utter.volume = 1;
  utter.lang = currentLang;
  utter.onend = () => {
    isSpeaking = false;
    setTimeout(() => {
      ignoreInput = false;
      safeStart(300); // Restart mic to listen for wake word
    }, 500);
  };
  utter.onerror = () => {
    isSpeaking = false;
    ignoreInput = false;
    safeStart(300);
  };
  isSpeaking = true;
  window.speechSynthesis.speak(utter);
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

  // Multi-Language Music commands via question handler
  if (q.includes('kannada song') || q.includes('kannada music') || q.includes('kannada haadu') || q.includes('play kannada')) {
    playMusicByLanguage('kannada');
    return;
  }
  if (q.includes('hindi song') || q.includes('bollywood song') || q.includes('hindi music') || q.includes('play hindi') || q.includes('gaana bajao') || q.includes('hindi gaana')) {
    playMusicByLanguage('hindi');
    return;
  }
  if (q.includes('telugu song') || q.includes('telugu music') || q.includes('play telugu')) {
    playMusicByLanguage('telugu');
    return;
  }
  if (q.includes('tamil song') || q.includes('tamil music') || q.includes('play tamil')) {
    playMusicByLanguage('tamil');
    return;
  }
  if (q.includes('english song') || q.includes('lofi song') || q.includes('play english') || q.includes('play pop')) {
    playMusicByLanguage('english');
    return;
  }
  if (q.includes('play song') || q.includes('play music') || q.includes('haadu haaku')) {
    playMusicByLanguage('');
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

  // Everything else goes to n8n
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
    // ✅ Call Groq API (uses proxy on Vercel, direct on localhost)
    const data = await callGroqAPI({
      model: GROQ_MODEL,
      messages: messages
    });

    showLoading(false);

    let finalText = "";
    if (data.reply) {
      finalText = data.reply;
    } else if (data.response) {
      finalText = data.response;
    } else if (data.choices && data.choices[0] && data.choices[0].message) {
      finalText = data.choices[0].message.content;
    } else {
      finalText = "I processed your request.";
    }

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

    // Smart fallback for Movie Suggestions if API is temporarily rate-limited or offline
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
      setTimeout(() => safeStart(), 1000);
      return;
    }

    let displayMsg = err.message;
    let voiceMsg = err.message;

    if (displayMsg.includes('429')) {
      displayMsg = "Rate limit reached on AI engine. Retrying in a few seconds...";
      voiceMsg = "I'm temporarily rate limited. Please ask me again in just a moment!";
    }

    setAIResponse("❌ " + displayMsg);
    speakOnce(voiceMsg);
    setTimeout(() => safeStart(), 1500);
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
      // ✅ Call Groq for outfit analysis (uses proxy on Vercel)
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
      
      let text = "";
      if (data.reply) {
        text = data.reply;
      } else if (data.response) {
        text = data.response;
      } else if (data.choices && data.choices[0] && data.choices[0].message) {
        text = data.choices[0].message.content;
      } else {
        text = "Your outfit looks great!";
      }

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

// ========== SPEAK (TTS) — mic stays ON so user can say "stop" ==========
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
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn'; // Kannada
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Hindi
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil
  if (currentLang === 'te-IN') return 'te';
  if (currentLang === 'kn-IN') return 'kn';
  if (currentLang === 'hi-IN') return 'hi';
  if (currentLang === 'ta-IN') return 'ta';
  return null;
}

function speakOnce(text) {
  speakCount++;
  const myCount = speakCount;

  // Cancel any existing TTS (speech synthesis and cloud audio)
  if (currentTTSAudio) {
    currentTTSAudio.pause();
    currentTTSAudio.src = "";
    currentTTSAudio = null;
  }
  window.speechSynthesis.cancel();

  const clean = cleanTextForTTS(text);
  if (!clean) return;

  // DON'T stop mic — keep it running so user can say "stop" to interrupt
  ignoreInput = true;
  isSpeaking = true;
  if (musicPlaying) audio.volume = 0.2;

  // Keep mic alive during speech for interrupt detection
  if (!recognitionRunning) {
    safeStart();
  }

  // Watchdog timer: on Android Chrome, utter.onend sometimes fails to fire
  const watchdogTime = Math.max(3000, Math.min(14000, clean.length * 120));
  setTimeout(() => {
    if (isSpeaking && myCount === speakCount) {
      isSpeaking = false;
      isProcessing = false;
      ignoreInput = false;
      if (musicPlaying) audio.volume = MUSIC_VOLUME;
      if (conversationActive) {
        setWakeStatus('🟢 JARVIS ACTIVE...');
        showPulse(true);
      }
      safeStart(200);
    }
  }, watchdogTime);

  // Check if text is in a regional Indian language (Telugu, Kannada, Hindi, Tamil)
  const regionalCode = detectRegionalLang(clean);

  if (regionalCode) {
    // Check if device browser has a genuine native voice for this language
    const voices = window.speechSynthesis.getVoices();
    const nativeBrowserVoice = voices.find(v => (v.lang || '').toLowerCase().startsWith(regionalCode));

    if (!nativeBrowserVoice) {
      // Use Google's crystal-clear, authentic native speaker TTS stream
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${regionalCode}&client=tw-ob&q=${encodeURIComponent(clean.slice(0, 190))}`;
      const cloudAudio = new Audio(ttsUrl);
      cloudAudio.volume = 1.0;
      currentTTSAudio = cloudAudio;

      const finishSpeech = () => {
        if (myCount === speakCount) {
          isSpeaking = false;
          isProcessing = false;
          if (musicPlaying) audio.volume = MUSIC_VOLUME;
          setTimeout(() => {
            ignoreInput = false;
            if (conversationActive) {
              setWakeStatus('🟢 JARVIS ACTIVE...');
              showPulse(true);
              document.getElementById('transcript').innerText = '';
            }
            safeStart();
          }, 300);
        }
      };

      cloudAudio.onended = finishSpeech;
      cloudAudio.onerror = (e) => {
        console.warn("Cloud TTS error, trying browser fallback:", e);
        playBrowserTTS(clean, null, myCount);
      };

      cloudAudio.play().catch(e => {
        console.warn("Cloud TTS play blocked, trying browser fallback:", e);
        playBrowserTTS(clean, null, myCount);
      });
      return;
    }
  }

  // Browser SpeechSynthesis (for English or when native browser voice exists)
  playBrowserTTS(clean, null, myCount);
}

function playBrowserTTS(text, targetVoiceOverride, myCount) {
  setTimeout(() => {
    if (myCount !== speakCount) {
      isSpeaking = false;
      ignoreInput = false;
      if (musicPlaying) audio.volume = MUSIC_VOLUME;
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

    utter.onend = () => {
      isSpeaking = false;
      isProcessing = false;
      if (musicPlaying) audio.volume = MUSIC_VOLUME;
      setTimeout(() => {
        ignoreInput = false;
        if (conversationActive) {
          setWakeStatus('🟢 JARVIS ACTIVE...');
          showPulse(true);
          document.getElementById('transcript').innerText = '';
        }
        safeStart();
      }, 600);
    };

    utter.onerror = () => {
      isSpeaking = false;
      isProcessing = false;
      ignoreInput = false;
      if (musicPlaying) audio.volume = MUSIC_VOLUME;
      safeStart();
    };

    window.speechSynthesis.speak(utter);
  }, 100);
}

// ========== VOICE SWITCH (voice-controlled) ==========
function switchVoice(mode) {
  voiceMode = mode;
  if (mode === 'female') {
    document.getElementById('voice-indicator').innerText = '🔊 VOICE: LISA';
    document.getElementById('voice-indicator').style.color = '#ff69b4';
    speakOnce("Hi! I am Lisa your Jarvis mirror assistant!");
  } else {
    document.getElementById('voice-indicator').innerText = '🔊 VOICE: MALE';
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

// Make startMirror available globally
window.startMirror = startMirror;
