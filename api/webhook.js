const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);
const GITHUB_PAT = process.env.GITHUB_PAT;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Telegram ---

async function sendTelegram(chatId, text) {
  const params = new URLSearchParams();
  params.append('chat_id', String(chatId));
  params.append('text', text);
  params.append('parse_mode', 'Markdown');
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    body: params,
  });
  // If Markdown parse fails, retry as plain text
  if (!res.ok) {
    const plain = new URLSearchParams();
    plain.append('chat_id', String(chatId));
    plain.append('text', text.replace(/[*_`]/g, ''));
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      body: plain,
    });
  }
}

// --- GitHub file helpers ---

async function getFile(path) {
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    { headers: { Authorization: `Bearer ${GITHUB_PAT}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return {
    content: Buffer.from(data.content, 'base64').toString('utf-8'),
    sha: data.sha,
  };
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

async function deleteFile(path, sha, message) {
  await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${GITHUB_PAT}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sha }),
  });
}

// --- Get last delivered topic from topics_log.md ---

async function getLastTopic() {
  const file = await getFile('topics_log.md');
  if (!file) return null;
  const rows = file.content.split('\n').filter(l => l.startsWith('|') && !l.includes('Date') && !l.includes('---'));
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const cols = last.split('|').filter(Boolean);
  return cols.length >= 2 ? `${cols[0]?.trim()} — ${cols[1]?.trim()}` : null;
}

// --- Gemini with JSON output ---

async function processMessage(currentContext, lastTopic, userMessage) {
  const topicLine = lastTopic
    ? `The last daily topic delivered to Xavier was: "${lastTopic}". If he refers to "it", "that", "the topic", "today's topic" etc., he means this.`
    : 'No daily topic has been delivered yet.';

  const systemPrompt = `You are Xavier Tan's personal CTO coach. Xavier is a CTO in Kuala Lumpur, Malaysia.

What you know about Xavier:
${currentContext}

${topicLine}

Xavier sent you: "${userMessage}"

Respond as a sharp, direct, experienced CTO coach. Be specific — not generic. Max 4 sentences unless the question genuinely needs more depth.

Decide your MODE:
- "chat": Xavier is asking a question, discussing ideas, or thinking out loud. Just reply. Do NOT touch his profile.
- "propose": Xavier shared something profile-worthy (team size, company context, challenges, goals) without explicitly asking to save it. Reply as a coach AND end with "Want me to save this to your coaching profile? Reply yes or no."
- "update": Xavier explicitly said to remember/note/save something. Reply and update profile immediately.

Return a JSON object with these fields:
{
  "mode": "chat" | "propose" | "update",
  "reply": "your reply as plain text (no markdown asterisks or underscores)",
  "context_changed": true or false,
  "context_summary": "one sentence describing what changed, or null",
  "updated_context": "full updated context.md content, or null if unchanged"
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: systemPrompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  try {
    return JSON.parse(raw);
  } catch {
    // If JSON parse fails, treat the raw text as the reply
    return { mode: 'chat', reply: raw.trim() || 'I had trouble processing that. Could you rephrase?', context_changed: false };
  }
}

// --- Commands ---

async function handleProfile(chatId) {
  const file = await getFile('context.md');
  if (!file) {
    return sendTelegram(chatId, "I don't have any context about you yet. Just start talking to me and I'll build up your profile.");
  }
  const lines = file.content.split('\n').filter(l => !l.startsWith('<!--') && l.trim());
  await sendTelegram(chatId, `*Your coaching profile:*\n\n${lines.slice(0, 40).join('\n')}`);
}

async function handleHistory(chatId) {
  const file = await getFile('topics_log.md');
  if (!file) return sendTelegram(chatId, 'No topics delivered yet.');
  const rows = file.content.split('\n').filter(l => l.startsWith('|') && !l.includes('Date') && !l.includes('---'));
  if (!rows.length) return sendTelegram(chatId, 'No topics delivered yet. Your first arrives at 8 AM tomorrow.');
  const list = rows.slice(-10).reverse().map(r => {
    const cols = r.split('|').filter(Boolean);
    return `- ${cols[0]?.trim()} — ${cols[1]?.trim()}`;
  }).join('\n');
  await sendTelegram(chatId, `*Recent topics:*\n\n${list}`);
}

async function handleHelp(chatId) {
  await sendTelegram(chatId,
    "*CTO Coach*\n\n" +
    "Talk to me like a trusted advisor. Ask questions, share challenges, think out loud.\n\n" +
    "I notice things worth saving to your profile and ask before doing so. " +
    "Or say 'remember that...' and I save it right away.\n\n" +
    "Commands:\n" +
    "/profile — what I know about you\n" +
    "/history — recent topics covered\n" +
    "/help — this message\n\n" +
    "Daily topic: 8 AM KL every morning."
  );
}

// --- Main ---

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body ?? {};
  if (!message?.text) return res.status(200).end();

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (chatId !== TELEGRAM_CHAT_ID) return res.status(200).end();

  if (text === '/start') {
    await sendTelegram(chatId,
      "Hi Xavier! I'm your CTO Coach.\n\n" +
      "Ask me anything, share what's on your mind, or just think out loud. " +
      "I'll remember what matters and ask before saving it.\n\n" +
      "Daily topic arrives at 8 AM. Use /help to see everything I can do."
    );
    return res.status(200).end();
  }

  if (text === '/profile') { await handleProfile(chatId); return res.status(200).end(); }
  if (text === '/history')  { await handleHistory(chatId); return res.status(200).end(); }
  if (text === '/help')     { await handleHelp(chatId);    return res.status(200).end(); }

  try {
    const pending = await getFile('pending.json');
    const affirmative = /^(yes|yeah|yep|sure|ok|okay|save|do it|go ahead|yup)$/i.test(text);
    const negative    = /^(no|nope|nah|skip|dont|cancel|ignore)$/i.test(text);

    if (pending && affirmative) {
      const { proposedContext, summary } = JSON.parse(pending.content);
      const ctx = await getFile('context.md');
      await Promise.all([
        putFile('context.md', proposedContext, ctx?.sha ?? null, `context: ${summary}`),
        deleteFile('pending.json', pending.sha, 'clear: confirmed'),
      ]);
      await sendTelegram(chatId, `Saved. ${summary}\n\nYour daily topics will reflect this from tomorrow.`);
      return res.status(200).end();
    }

    if (pending && negative) {
      await deleteFile('pending.json', pending.sha, 'clear: declined');
      await sendTelegram(chatId, "No problem, profile stays as is.");
      return res.status(200).end();
    }

    if (pending && !affirmative && !negative) {
      await deleteFile('pending.json', pending.sha, 'clear: superseded');
    }

    const [ctx, lastTopic] = await Promise.all([
      getFile('context.md'),
      getLastTopic(),
    ]);

    const currentContext = ctx?.content ?? '# Xavier\'s CTO Context\n\n(No information yet)\n';
    const result = await processMessage(currentContext, lastTopic, text);

    const { mode, reply, context_changed, context_summary, updated_context } = result;

    if (mode === 'update' && context_changed && updated_context) {
      await putFile('context.md', updated_context, ctx?.sha ?? null, `context: ${context_summary}`);
    } else if (mode === 'propose' && context_changed && updated_context) {
      const pendingData = JSON.stringify({ proposedContext: updated_context, summary: context_summary });
      const existing = await getFile('pending.json');
      await putFile('pending.json', pendingData, existing?.sha ?? null, 'pending: awaiting confirmation');
    }

    await sendTelegram(chatId, reply);

  } catch (err) {
    console.error(err);
    await sendTelegram(chatId, "Something went wrong on my end. Try again in a moment.");
  }

  res.status(200).end();
};
