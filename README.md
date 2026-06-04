# paypalmafia-bot

Discord bot for a startup duo. Project management glued to GitHub and Linear, automated standups, and a handful of productivity modules, all driven from Discord.

## What it does

Modules (`src/modules`):
- `projects`, `leads`, `ideas`, `decisions`, `links` — capture and track work items from Discord
- `github`, `linear` — sync issues, tasks, and PRs with the trackers
- `standup`, `pulse`, `focus` — automated standups and status nudges (scheduled via `node-cron`)
- `polls`, `auto-bookmark`, `deploy` — utilities

Core (`src/core`): a module loader, a command registry, an AI helper (`@google/generative-ai`), and logging. State lives in local SQLite (`better-sqlite3`).

## Stack

TypeScript, discord.js, @linear/sdk, @google/generative-ai, better-sqlite3, express, node-cron.

## Setup

```bash
npm install
# create .env with the Discord token and Linear/GitHub keys (.env is gitignored)
npm run deploy-commands   # register slash commands
npm run dev               # or: npm run build && npm start
npm test                  # vitest
```

`.env`, `data/`, and `dist/` are gitignored. Never commit secrets.
