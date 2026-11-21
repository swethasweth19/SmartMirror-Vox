// Vercel Serverless Function — searches YouTube and returns the best video ID & title
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
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' song')}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const html = await response.text();

    let videoId = null;
    let title = query;

    // Pattern 1: "videoId":"XXXXXXXXXXX"
    const videoIdMatch = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (videoIdMatch && videoIdMatch[1]) {
      videoId = videoIdMatch[1];
    }

    // Pattern 2: /watch?v=XXXXXXXXXXX
    if (!videoId) {
      const watchMatch = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
      if (watchMatch && watchMatch[1]) {
        videoId = watchMatch[1];
      }
    }

    // Pattern 3: Extract title
    const titleMatch = html.match(/"title":\{"runs":\[\{"text":"([^"]+)"\}\]/);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1];
    }

    if (!videoId) {
      return res.status(404).json({ error: 'No video found for query' });
    }

    return res.status(200).json({
      success: true,
      videoId,
      title,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`
    });
  } catch (err) {
    console.error('YouTube search error:', err);
    return res.status(500).json({ error: err.message || 'Failed to search YouTube' });
  }
};
