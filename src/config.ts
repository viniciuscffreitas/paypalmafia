import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId: process.env['DISCORD_GUILD_ID'] || '',
  },
  github: {
    token: process.env['GITHUB_TOKEN'] || '',
    webhookSecret: process.env['GITHUB_WEBHOOK_SECRET'] || '',
  },
  linear: {
    apiKey: process.env['LINEAR_API_KEY'] || '',
    webhookSecret: process.env['LINEAR_WEBHOOK_SECRET'] || '',
  },
  deploy: {
    webhookSecret: process.env['DEPLOY_WEBHOOK_SECRET'] || '',
  },
  webhook: {
    port: parseInt(optional('WEBHOOK_PORT', '3000'), 10),
  },
  database: {
    path: optional('DATABASE_PATH', './data/bot.db'),
  },
};
