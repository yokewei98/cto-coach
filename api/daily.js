const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

// --- Generate daily content via Gemini ---

async function generateDailyContent(context, topicsLog) {
  const prompt = `You are a Goals Coach. Write today's daily lesson for Xavier.

Xavier's profile:
${context}

Past topics already covered (do NOT repeat):
${topicsLog}

Topic areas to rotate through:
- Goal-setting frameworks (OKRs, SMART, BHAG, 12-Week Year, Rocks/EOS)
- Psychology of goals (motivation, identity-based habits, intrinsic vs extrinsic)
- Vision & life design (ikigai, life wheel, personal mission, long-term thinking)
- Execution & focus (deep work, time blocking, energy management)
- Accountability systems (habit tracking, reviews, coaching, masterminds)
- Goal-setting for teams and organisations
- Overcoming obstacles (procrastination, fear, limiting beliefs)
- High-performer habits (reflection, journaling, morning routines)
- Measuring progress (leading vs lagging indicators, milestone design)
- Goal psychology research (Locke & Latham, Dweck, Deci & Ryan)

Write a fresh topic NOT in past topics. Return JSON only:
{
  "title": "short punchy title (max 8 words)",
  "body": "paragraph one (3-4 sentences of insight)\\n\\nparagraph two (3-4 sentences of practical application)"
}`;

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

// --- Main handler ---

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const [ctxFile, logFile] = await Promise.all([
      getFile('context.md'),
      getFile('topics_log.md'),
    ]);

    const context = ctxFile?.content ?? '(No context yet)';
    const topicsLog = logFile?.content ?? '';

    const { title, body } = await generateDailyContent(context, topicsLog);

    if (!title || !body) {
      await sendTelegram('Could not generate today\'s lesson. Will try again tomorrow.');
      return res.status(200).json({ ok: true, message: 'generation failed' });
    }

    const message = `*${title}*\n\n${body}`;
    await sendTelegram(message);

    // Update topics_log.md
    const today = new Date().toISOString().split('T')[0];
    const updatedLog = topicsLog.trimEnd() + `\n| ${today} | ${title} |\n`;
    await putFile('topics_log.md', updatedLog, logFile?.sha ?? null, `log: ${today} — ${title}`);

    return res.status(200).json({ ok: true, title });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
