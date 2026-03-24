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

async function processWithGemini(currentContext, userMessage) {
  const prompt = `You are Xavier Tan's personal CTO coach. Xavier is a CTO based in Kuala Lumpur.

Here is everything you know about Xavier so far:
<context>
${currentContext}
</context>

Xavier just sent you this message:
"${userMessage}"

Your job has two parts:

PART 1 — Reply as his coach (2-4 sentences max):
- Be conversational, warm, direct — like a trusted advisor
- Acknowledge what he said, offer a quick insight or ask a sharp follow-up question
- Do NOT be generic. React specifically to what he said.
- Use plain text only (no markdown bold/italic — just natural language)

PART 2 — Update his context file:
- Incorporate any new information from his message into context.md
- Only update if there's genuinely new information to add
- If nothing meaningful to update, keep context.md unchanged

Return your response in exactly this format:
REPLY: <your conversational reply to Xavier>
UPDATED: <true or false — whether context.md changed>
SUMMARY: <one sentence on what changed, or "no change">
---
<full updated context.md — even if unchanged, include the full file>`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    }
  );
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const replyMatch = text.match(/REPLY:\s*(.+?)(?=\nUPDATED:)/s);
  const updatedMatch = text.match(/UPDATED:\s*(true|false)/i);
  const summaryMatch = text.match(/SUMMARY:\s*(.+?)\n---/s);
  const contextMatch = text.match(/---\n([\s\S]+)/);

  return {
    reply: replyMatch?.[1]?.trim() ?? "Got it, noted.",
    updated: updatedMatch?.[1]?.toLowerCase() === 'true',
    summary: summaryMatch?.[1]?.trim() ?? 'no change',
    updatedContext: contextMatch?.[1]?.trim() ?? currentContext,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body ?? {};
  if (!message?.text) return res.status(200).end();

  const chatId = message.chat.id;
  const text = message.text;

  if (chatId !== TELEGRAM_CHAT_ID) return res.status(200).end();

  if (text === '/start') {
    await sendTelegram(chatId, "Hi Xavier! I'm your CTO Coach.\n\nTalk to me like you would a trusted advisor — tell me about your challenges, your team, what you're trying to get better at. I'll remember it all and tailor your daily topics accordingly.\n\nYour first topic arrives at 8 AM tomorrow.");
    return res.status(200).end();
  }
  if (text.startsWith('/')) return res.status(200).end();

  try {
    const { content, sha } = await getContextFile();
    const { reply, updated, summary, updatedContext } = await processWithGemini(content, text);

    // Send the coach's reply
    await sendTelegram(chatId, reply);

    // Silently update context in the background if needed
    if (updated) {
      await updateContextFile(updatedContext, sha, `context: ${summary}`);
    }
  } catch (err) {
    console.error(err);
    await sendTelegram(chatId, "Sorry, something went wrong on my end. Try again in a moment.");
  }

  res.status(200).end();
};
