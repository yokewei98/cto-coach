# CTO Coach

A daily CTO learning agent powered by Claude Code. Every morning at 8 AM KL time, a remote Claude agent delivers one tailored, actionable CTO insight to your Telegram.

## How It Works

1. Agent reads `context.md` — your background, preferences, topics to avoid
2. Agent reads `topics_log.md` — all previously covered topics (no repeats ever)
3. Agent picks a fresh topic tailored to your context
4. Agent sends a rich, structured message to your Telegram
5. Agent commits the new topic to `topics_log.md` — permanent memory

## Files

| File | Purpose | Who edits it |
|------|---------|--------------|
| `context.md` | Your background, goals, preferences | You — update anytime |
| `topics_log.md` | Log of all topics delivered | Agent only |

## Personalising Your Experience

Edit `context.md` to add context about your company, list topics to prioritise or avoid, and describe your current challenges. Changes take effect the next day.
