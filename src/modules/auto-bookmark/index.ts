import {
  ChatInputCommandInteraction,
  Events,
  TextChannel,
  Message,
} from 'discord.js';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;
let messageHandler: ((message: Message) => Promise<void>) | null = null;

const URL_REGEX = /https?:\/\/[^\s]+/g;
const BOOKMARK_EMOJI = '\u{1f516}';

function getProjectFromCategoryId(categoryId: string): any | null {
  return ctx.db
    .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
    .get(categoryId);
}

function generateLinkName(url: string, projectId: string): string {
  let domain: string;
  try {
    const parsed = new URL(url);
    domain = parsed.hostname.replace('www.', '');
  } catch {
    domain = 'link';
  }

  const baseName = domain.replace(/\./g, '-');

  const existing = ctx.db
    .prepare(
      "SELECT COUNT(*) as count FROM links WHERE project_id = ? AND name LIKE ?"
    )
    .get(projectId, `${baseName}-%`) as any;

  const count = (existing?.count || 0) + 1;
  return `${baseName}-${count}`;
}

export const autoBookmarkModule: BotModule = {
  name: 'auto-bookmark',
  description: 'Automatically detects URLs and saves them as bookmarks',
  commands: [],

  async onLoad(context) {
    ctx = context;

    messageHandler = async (message: Message) => {
      if (message.author.bot) return;

      const channel = message.channel as TextChannel;
      if (!channel?.parentId) return;

      const project = getProjectFromCategoryId(channel.parentId);
      if (!project) return;

      const urls = message.content.match(URL_REGEX);
      if (!urls || urls.length === 0) return;

      let savedCount = 0;
      for (const url of urls) {
        // Deduplicate by URL within the project
        const exists = ctx.db
          .prepare('SELECT 1 FROM links WHERE project_id = ? AND url = ?')
          .get(project.id, url);
        if (exists) continue;

        const name = generateLinkName(url, project.id);
        try {
          const result = ctx.db
            .prepare(
              'INSERT OR IGNORE INTO links (project_id, name, url, saved_by) VALUES (?, ?, ?, ?)'
            )
            .run(project.id, name, url, message.author.username || message.author.id);
          if (result.changes > 0) savedCount++;
        } catch (error) {
          ctx.logger.error(`Failed to save bookmark: ${error}`);
        }
      }

      if (savedCount > 0) {
        try {
          await message.react(BOOKMARK_EMOJI);
        } catch (error) {
          ctx.logger.error(`Failed to react with bookmark emoji: ${error}`);
        }
      }
    };

    ctx.client.on(Events.MessageCreate, messageHandler);
    ctx.logger.info('Auto-bookmark module loaded');
  },

  async onUnload() {
    if (messageHandler) {
      ctx.client.off(Events.MessageCreate, messageHandler);
      messageHandler = null;
    }
  },

  async handleCommand(_interaction: ChatInputCommandInteraction) {
    // This module has no commands
  },
};
