# CTO Coach

A personal CTO coaching system powered by Claude Code and Gemini. Every morning at 8 AM KL time, a remote Claude agent delivers one tailored, actionable CTO insight to your Telegram. Between sessions, talk to the bot anytime — it responds as a coach and updates your profile as you share context.

## How It Works

### Daily topic (8 AM KL, automated)
1. Agent reads `context.md` — your background, challenges, and preferences
2. Agent reads `topics_log.md` — all previously covered topics (no repeats ever)
3. Agent picks a fresh topic tailored to your context
4. Agent sends a rich, structured message to your Telegram
5. Agent appends the topic to `topics_log.md` and commits it

### Between sessions (anytime)
Talk to the bot in Telegram like a trusted advisor. It responds conversationally and manages your profile intelligently:

- **Shares context naturally** ("my team has 12 engineers") — bot replies as a coach and asks if you want it saved
- **Explicit saves** ("remember that I'm at a Series A startup") — bot saves immediately
- **General questions** ("what's the most important thing for a new CTO?") — bot just answers, no profile update

## Bot Commands

| Command | What it does |
|---------|-------------|
| `/profile` | Show what the coach currently knows about you |
| `/history` | Show your last 10 topics covered |
| `/help` | Show all commands |

## Files

| File | Purpose | Who edits it |
|------|---------|--------------|
| `context.md` | Your background, goals, preferences, topics to avoid | You or the bot |
| `topics_log.md` | Log of every topic delivered — the bot's long-term memory | Bot only |
| `pending.json` | Temporary — holds a proposed context update awaiting your yes/no | Bot only |
| `api/webhook.js` | Telegram webhook handler (Vercel serverless function) | — |

## Updating Your Profile

Two ways:

1. **Talk to the bot** — just mention something about yourself. If it's worth saving, the bot will propose it and ask for confirmation.
2. **Edit `context.md` directly** — changes take effect on the next daily topic run.

## Topic Categories

The agent rotates across these areas to ensure broad coverage over time:

- Engineering leadership (hiring, performance, culture, team health)
- Technical strategy (architecture, tech debt, build vs buy, platform thinking)
- Product & engineering alignment (roadmaps, prioritisation, OKRs, stakeholders)
- Execution & delivery (DORA metrics, incidents, on-call, release processes)
- People management (1:1s, career ladders, underperformers, retention)
- Financial acumen (cloud costs, ROI, engineering budgets)
- Security & compliance (secure SDLC, threat modelling, SOC2)
- AI & emerging tech (evaluating and adopting AI as a CTO)
- Communication & influence (board updates, technical storytelling, exec writing)
- Personal effectiveness (decision-making, managing up, avoiding burnout)

## Stack

- **Daily agent**: Claude Sonnet (Claude Code Remote, runs in Anthropic cloud)
- **Webhook**: Gemini 2.5 Flash (Vercel serverless function)
- **Memory**: GitHub repo (`context.md`, `topics_log.md`)
- **Delivery**: Telegram Bot API
