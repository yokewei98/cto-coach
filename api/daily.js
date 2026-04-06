const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// --- GitHub helpers ---

async function getFile(path) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
}

async function putFile(path, content, sha, message) {
  const body = { message, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;
  await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

// --- Telegram ---

async function sendTelegram(text) {
  const params = new URLSearchParams();
  params.append('chat_id', String(TELEGRAM_CHAT_ID));
  params.append('text', text);
  params.append('parse_mode', 'Markdown');
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    body: params,
  });
  if (!res.ok) {
    const plain = new URLSearchParams();
    plain.append('chat_id', String(TELEGRAM_CHAT_ID));
    plain.append('text', text.replace(/[*_`\[\]()]/g, ''));
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      body: plain,
    });
  }
}

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
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query + ' leadership');
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoDuration', durationFilter);
  url.searchParams.set('maxResults', '20');
  url.searchParams.set('relevanceLanguage', 'en');
  url.searchParams.set('key', YOUTUBE_API_KEY);
  const res = await fetch(url.toString());
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
  const [mediumIds, longIds] = await Promise.all([
    searchVideos(query, 'medium'),
    searchVideos(query, 'long'),
  ]);
  const allIds = [...new Set([...mediumIds, ...longIds])];
  if (!allIds.length) return null;

  const videos = await getVideoDetails(allIds);
  const valid = videos.filter(v => {
    const secs = parseDurationSeconds(v.contentDetails.duration);
    return secs >= 600 && secs <= 3600;
  });
  if (!valid.length) return null;

  valid.sort((a, b) =>
    parseInt(b.statistics?.viewCount || 0) - parseInt(a.statistics?.viewCount || 0)
  );
  return valid[0];
}

// --- Main handler ---

module.exports = async function handler(req, res) {
  // Allow manual GET trigger or Vercel cron (GET)
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const [ctxFile, logFile] = await Promise.all([
      getFile('context.md'),
      getFile('topics_log.md'),
    ]);

    const context = ctxFile?.content ?? '(No context yet)';
    const topicsLog = logFile?.content ?? '';

    const { query, reason } = await pickTopic(context, topicsLog);
    const video = await findVideo(query);

    if (!video) {
      await sendTelegram('Could not find a suitable YouTube video today. Will try again tomorrow.');
      return res.status(200).json({ ok: true, message: 'no video found' });
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

    // Update topics_log.md
    const today = new Date().toISOString().split('T')[0];
    const updatedLog = topicsLog.trimEnd() + `\n| ${today} | [${title}](${url}) |\n`;
    await putFile('topics_log.md', updatedLog, logFile?.sha ?? null, `log: ${today} YouTube topic`);

    return res.status(200).json({ ok: true, title, url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
