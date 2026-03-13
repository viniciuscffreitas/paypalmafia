import {
  ChatInputCommandInteraction,
  Events,
  TextChannel,
  Message,
  MessageReaction,
  User,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;

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

  // Find next available number for this domain in this project
  const existing = ctx.db
    .prepare(
      "SELECT COUNT(*) as count FROM links WHERE project_id = ? AND name LIKE ?"
    )
    .get(projectId, `${baseName}%`) as any;

  const count = (existing?.count || 0) + 1;
  return `${baseName}-${count}`;
}

export const autoBookmarkModule: BotModule = {
  name: 'auto-bookmark',
  description: 'Automatically detects URLs and allows bookmarking via reaction',
  // Note: This module requires GuildMessageReactions intent to be enabled in bot.ts
  commands: [],

  async onLoad(context) {
    ctx = context;

    // Listen for messages containing URLs
    ctx.client.on(Events.MessageCreate, async (message: Message) => {
      if (message.author.bot) return;

      const channel = message.channel as TextChannel;
      if (!channel?.parentId) return;

      const project = getProjectFromCategoryId(channel.parentId);
      if (!project) return;

      const urls = message.content.match(URL_REGEX);
      if (!urls || urls.length === 0) return;

      try {
        await message.react(BOOKMARK_EMOJI);
      } catch (error) {
        ctx.logger.error(`Failed to react with bookmark emoji: ${error}`);
      }
    });

    // Listen for bookmark reactions
    ctx.client.on(
      Events.MessageReactionAdd,
      async (
        reaction: MessageReaction | PartialMessageReaction,
        user: User | PartialUser
      ) => {
        // Ignore bot's own reactions
        if (user.bot) return;

        // Only handle bookmark emoji
        if (reaction.emoji.name !== BOOKMARK_EMOJI) return;

        // Fetch partial reaction if needed
        if (reaction.partial) {
          try {
            reaction = await reaction.fetch();
          } catch (error) {
            ctx.logger.error(`Failed to fetch partial reaction: ${error}`);
            return;
          }
        }

        const message = reaction.message;

        // Fetch partial message if needed
        if (message.partial) {
          try {
            await message.fetch();
          } catch (error) {
            ctx.logger.error(`Failed to fetch partial message: ${error}`);
            return;
          }
        }

        // Check if the bot has also reacted with the bookmark emoji (meaning it detected a URL)
        const botReaction = message.reactions.cache.get(BOOKMARK_EMOJI);
        if (!botReaction) return;

        const botUser = ctx.client.user;
        if (!botUser) return;

        const botHasReacted = botReaction.users.cache.has(botUser.id);
        if (!botHasReacted) {
          // Try fetching users for this reaction to be sure
          try {
            const reactionUsers = await botReaction.users.fetch();
            if (!reactionUsers.has(botUser.id)) return;
          } catch {
            return;
          }
        }

        const channel = message.channel as TextChannel;
        if (!channel?.parentId) return;

        const project = getProjectFromCategoryId(channel.parentId);
        if (!project) return;

        const urls = message.content?.match(URL_REGEX);
        if (!urls || urls.length === 0) return;

        let savedCount = 0;
        for (const url of urls) {
          const name = generateLinkName(url, project.id);

          try {
            ctx.db
              .prepare(
                'INSERT OR IGNORE INTO links (project_id, name, url, saved_by) VALUES (?, ?, ?, ?)'
              )
              .run(project.id, name, url, user.tag || user.id);
            savedCount++;
          } catch (error) {
            ctx.logger.error(`Failed to save bookmark: ${error}`);
          }
        }

        if (savedCount > 0) {
          try {
            await message.reply(`\u{1f516} Link salvo! Use \`/link list\` para ver.`);
          } catch (error) {
            ctx.logger.error(`Failed to send bookmark confirmation: ${error}`);
          }
        }
      }
    );

    ctx.logger.info('Auto-bookmark module loaded');
  },

  async onUnload() {},

  async handleCommand(_interaction: ChatInputCommandInteraction) {
    // This module has no commands
  },
};
