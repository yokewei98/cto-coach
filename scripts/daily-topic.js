const fs = require('fs');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Pick topic via Gemini ---

async function pickTopic(context, topicsLog) {
  const prompt = `You are a CTO coach. Based on Xavier's profile and past topics, choose ONE specific YouTube search query for today's video recommendation.

Xavier's profile:
${context}

Past topics covered:
${topicsLog}

Requirements:
- Pick a topic NOT already in past topics
- Make it specific (e.g. "engineering team OKRs", "technical debt strategy CTO", "board communication engineering leader")
- Optimized as a YouTube search query (5-10 words)
- Also return a one-sentence reason why this matters to Xavier right now

Return JSON only: {"query": "...", "reason": "..."}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, responseMimeType: 'application/json' },
      }),
    }
  );
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(raw);
}

// --- YouTube helpers ---

function parseDurationSeconds(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || 0) * 3600) + (parseInt(match[2] || 0) * 60) + parseInt(match[3] || 0);
}

function formatDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '';
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function searchVideos(query, durationFilter) {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', query + ' leadership');
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('videoDuration', durationFilter);
  searchUrl.searchParams.set('maxResults', '20');
  searchUrl.searchParams.set('relevanceLanguage', 'en');
  searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

  const res = await fetch(searchUrl.toString());
  const data = await res.json();
  return data.items?.map(i => i.id.videoId).filter(Boolean) ?? [];
}

async function getVideoDetails(ids) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.set('part', 'contentDetails,snippet,statistics');
  url.searchParams.set('id', ids.join(','));
  url.searchParams.set('key', YOUTUBE_API_KEY);

  const res = await fetch(url.toString());
  const data = await res.json();
  return data.items ?? [];
}

async function findVideo(query) {
  // Search both medium (4-20min) and long (>20min) to cover 10min-1hr range
  const [mediumIds, longIds] = await Promise.all([
    searchVideos(query, 'medium'),
    searchVideos(query, 'long'),
  ]);

  const allIds = [...new Set([...mediumIds, ...longIds])];
  if (!allIds.length) return null;

  const videos = await getVideoDetails(allIds);

  // Filter: 10min (600s) to 1hr (3600s)
  const valid = videos.filter(v => {
    const secs = parseDurationSeconds(v.contentDetails.duration);
    return secs >= 600 && secs <= 3600;
  });

  if (!valid.length) return null;

  // Pick highest view count
  valid.sort((a, b) =>
    parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
  );
  return valid[0];
}

// --- Telegram ---

async function sendTelegram(text) {
  const params = new URLSearchParams();
  params.append('chat_id', TELEGRAM_CHAT_ID);
  params.append('text', text);
  params.append('parse_mode', 'Markdown');
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    body: params,
  });
  if (!res.ok) {
    const plain = new URLSearchParams();
    plain.append('chat_id', TELEGRAM_CHAT_ID);
    plain.append('text', text.replace(/[*_`\[\]()]/g, ''));
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      body: plain,
    });
  }
}

// --- Main ---

async function main() {
  const context = fs.existsSync('context.md') ? fs.readFileSync('context.md', 'utf-8') : '(No context yet)';
  const topicsLog = fs.existsSync('topics_log.md') ? fs.readFileSync('topics_log.md', 'utf-8') : '';

  console.log('Picking topic via Gemini...');
  const { query, reason } = await pickTopic(context, topicsLog);
  console.log(`Query: ${query}`);
  console.log(`Reason: ${reason}`);

  console.log('Searching YouTube...');
  const video = await findVideo(query);
  if (!video) {
    await sendTelegram('Could not find a suitable YouTube video today. Will try again tomorrow.');
    process.exit(1);
  }

  const title = video.snippet.title;
  const channel = video.snippet.channelTitle;
  const duration = formatDuration(video.contentDetails.duration);
  const url = `https://youtu.be/${video.id}`;

  const message =
    `*Today's CTO Watch*\n\n` +
    `*${title}*\n` +
    `${channel} · ${duration}\n\n` +
    `${reason}\n\n` +
    `${url}`;

  await sendTelegram(message);
  console.log('Sent to Telegram.');

  // Append to topics_log.md
  const today = new Date().toISOString().split('T')[0];
  let log = topicsLog.trimEnd();
  log += `\n| ${today} | [${title}](${url}) |\n`;
  fs.writeFileSync('topics_log.md', log);
  console.log('topics_log.md updated.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
