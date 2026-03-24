const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function sendTelegram(chatId, text) {
  const params = new URLSearchParams();
  params.append('chat_id', String(chatId));
  params.append('text', text);
  params.append('parse_mode', 'Markdown');
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    body: params,
  });
}

async function getContextFile() {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/context.md`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: 'application/vnd.github.v3+json' } }
  );
  const data = await res.json();
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
}

async function updateContextFile(content, sha, commitMessage) {
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/context.md`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        sha,
      }),
    }
  );
}

async function updateWithGemini(currentContext, userMessage) {
  const prompt = `You manage a CTO coaching context file for Xavier Tan (a CTO in Kuala Lumpur).

Current context.md:
${currentContext}

Xavier just sent this message to his coaching bot:
"${userMessage}"

Your job:
- Understand the message — it could be personal background, current challenges, learning goals, topics to avoid, or feedback on past topics
- Update context.md to naturally incorporate this new information
- Do not remove existing information unless Xavier explicitly says to

Return your response in exactly this format — nothing else:
SUMMARY: <one sentence describing what you updated>
---
<full updated context.md content>`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    }
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const match = text.match(/SUMMARY:\s*(.+)\n---\n([\s\S]+)/);
  if (match) return { summary: match[1].trim(), updatedContext: match[2].trim() };
  return { summary: 'Context updated', updatedContext: text };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body ?? {};
  if (!message?.text) return res.status(200).end();

  const chatId = message.chat.id;
  const text = message.text;

  // Security: only respond to Xavier
  if (chatId !== TELEGRAM_CHAT_ID) return res.status(200).end();

  if (text === '/start') {
    await sendTelegram(chatId, "👋 Hi Xavier! I'm your CTO Coach assistant.\n\nTell me anything — your background, current challenges, what you want to learn, or what topics to avoid — and I'll update your coaching profile.\n\nYour daily topic will arrive at 8 AM every morning.");
    return res.status(200).end();
  }
  if (text.startsWith('/')) return res.status(200).end();

  try {
    await sendTelegram(chatId, '⏳ Updating your context...');
    const { content, sha } = await getContextFile();
    const { summary, updatedContext } = await updateWithGemini(content, text);
    await updateContextFile(updatedContext, sha, `context: ${summary}`);
    await sendTelegram(chatId, `✅ *Profile updated*\n\n${summary}`);
  } catch (err) {
    console.error(err);
    await sendTelegram(chatId, '❌ Something went wrong updating your context. Please try again.');
  }

  res.status(200).end();
};
