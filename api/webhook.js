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
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    body: params,
  });
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
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

async function deleteFile(path, sha, message) {
  await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, sha }),
    }
  );
}

// --- Gemini ---

async function callGemini(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6 },
      }),
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function processMessage(currentContext, userMessage) {
  const prompt = `You are Xavier Tan's personal CTO coach. Xavier is a CTO in Kuala Lumpur, Malaysia.

What you currently know about Xavier:
<context>
${currentContext}
</context>

Xavier's message: "${userMessage}"

Decide how to respond using one of three modes:

MODE "chat": Pure conversation. Xavier is asking a question, thinking out loud, or discussing ideas. Do NOT update his profile. Just reply as a great coach would.

MODE "propose": Xavier shared something profile-worthy (company details, team size, current challenges, goals, preferences) but did NOT explicitly ask you to save it. Reply conversationally AND end your reply with a new line: "Want me to save that to your coaching profile? Reply yes or no."

MODE "update": Xavier explicitly asked you to remember something ("remember that...", "add to my profile...", "I want to focus on...", "note that..."). Save immediately without asking.

For modes "propose" and "update", produce the updated context.md incorporating the new info naturally.

Reply in EXACTLY this format:
MODE: chat|propose|update
REPLY: <your reply — 2-5 sentences, warm and direct, plain text only, no markdown>
CONTEXT_CHANGED: true|false
CONTEXT_SUMMARY: <one sentence on what changed, or "no change">
---
<full context.md content — include even if unchanged>`;

  const raw = await callGemini(prompt);

  const mode = raw.match(/MODE:\s*(chat|propose|update)/i)?.[1]?.toLowerCase() ?? 'chat';
  const reply = raw.match(/REPLY:\s*([\s\S]+?)(?=\nCONTEXT_CHANGED:)/)?.[1]?.trim() ?? 'Got it.';
  const changed = raw.match(/CONTEXT_CHANGED:\s*(true|false)/i)?.[1]?.toLowerCase() === 'true';
  const summary = raw.match(/CONTEXT_SUMMARY:\s*(.+?)(?=\n---)/s)?.[1]?.trim() ?? 'no change';
  const updatedContext = raw.match(/---\n([\s\S]+)/)?.[1]?.trim() ?? currentContext;

  return { mode, reply, changed, summary, updatedContext };
}

// --- Commands ---

async function handleProfile(chatId) {
  const file = await getFile('context.md');
  if (!file) {
    return sendTelegram(chatId, "I don't have any context about you yet. Just start talking to me and I'll build up your profile.");
  }
  const lines = file.content.split('\n').filter(l => !l.startsWith('<!--') && l.trim());
  const preview = lines.slice(0, 30).join('\n');
  await sendTelegram(chatId, `*Your coaching profile:*\n\n${preview}`);
}

async function handleHistory(chatId) {
  const file = await getFile('topics_log.md');
  if (!file) return sendTelegram(chatId, 'No topics delivered yet.');
  const rows = file.content.split('\n').filter(l => l.startsWith('|') && !l.includes('Date') && !l.includes('---'));
  if (!rows.length) return sendTelegram(chatId, 'No topics delivered yet. Your first one arrives at 8 AM tomorrow.');
  const recent = rows.slice(-10).reverse();
  const list = recent.map(r => {
    const cols = r.split('|').filter(Boolean);
    return `- ${cols[0]?.trim()} — ${cols[1]?.trim()}`;
  }).join('\n');
  await sendTelegram(chatId, `*Recent topics:*\n\n${list}`);
}

async function handleHelp(chatId) {
  await sendTelegram(chatId,
    "*CTO Coach — what I can do:*\n\n" +
    "Talk to me naturally. Ask CTO questions, share your challenges, think out loud. " +
    "I will pick up on things worth saving to your profile and ask before I do.\n\n" +
    "*Commands:*\n" +
    "/profile — see what I know about you\n" +
    "/history — see your last 10 topics covered\n" +
    "/help — show this message\n\n" +
    "Your daily CTO topic arrives every morning at 8 AM KL time."
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
      "Talk to me like a trusted advisor — ask questions, share challenges, think out loud. " +
      "I'll notice things worth remembering and ask before saving them to your profile.\n\n" +
      "Your daily topic arrives at 8 AM every morning. Use /help to see what I can do."
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
        deleteFile('pending.json', pending.sha, 'clear: confirmation resolved'),
      ]);
      await sendTelegram(chatId, `Saved. ${summary}\n\nYour daily topics will reflect this from tomorrow.`);
      return res.status(200).end();
    }

    if (pending && negative) {
      await deleteFile('pending.json', pending.sha, 'clear: confirmation declined');
      await sendTelegram(chatId, "No problem, your profile stays as is.");
      return res.status(200).end();
    }

    // Clear stale pending if user moved on
    if (pending && !affirmative && !negative) {
      await deleteFile('pending.json', pending.sha, 'clear: superseded');
    }

    const ctx = await getFile('context.md');
    const currentContext = ctx?.content ?? '# Xavier\'s CTO Context\n\n(No information yet)\n';
    const { mode, reply, changed, summary, updatedContext } = await processMessage(currentContext, text);

    if (mode === 'update' && changed) {
      await putFile('context.md', updatedContext, ctx?.sha ?? null, `context: ${summary}`);
      await sendTelegram(chatId, reply);
    } else if (mode === 'propose' && changed) {
      const pendingData = JSON.stringify({ proposedContext: updatedContext, summary });
      const existing = await getFile('pending.json');
      await putFile('pending.json', pendingData, existing?.sha ?? null, 'pending: awaiting confirmation');
      await sendTelegram(chatId, reply);
    } else {
      await sendTelegram(chatId, reply);
    }

  } catch (err) {
    console.error(err);
    await sendTelegram(chatId, "Something went wrong on my end. Try again in a moment.");
  }

  res.status(200).end();
};
