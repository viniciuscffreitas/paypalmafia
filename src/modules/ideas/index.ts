import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
  Client,
  Events,
  MessageReaction,
  User,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import type { Database } from 'better-sqlite3';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;
let reactionAddHandler: (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => void;
let reactionRemoveHandler: (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => void;

interface IdeaRow {
  id: number;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  message_id: string | null;
  channel_id: string | null;
  author_id: string;
  upvotes: number;
  downvotes: number;
  created_at: string;
}

interface ProjectRow {
  id: string;
  discord_category_id: string;
  name: string;
}

function getProjectFromChannel(interaction: ChatInputCommandInteraction): ProjectRow | null {
  const channel = interaction.channel as TextChannel;
  if (!channel?.parentId) return null;
  return ctx.db.prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL').get(channel.parentId) as ProjectRow | null;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'approved': return '✅ Approved';
    case 'rejected': return '❌ Rejected';
    default: return '🟢 Open';
  }
}

function statusColor(status: string): number {
  switch (status) {
    case 'approved': return 0x57f287;
    case 'rejected': return 0xed4245;
    default: return 0x5865f2;
  }
}

function buildIdeaEmbed(idea: IdeaRow): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(idea.title)
    .setColor(statusColor(idea.status))
    .addFields(
      { name: 'Status', value: statusBadge(idea.status), inline: true },
      { name: 'Votes', value: `👍 ${idea.upvotes}  👎 ${idea.downvotes}`, inline: true },
      { name: 'ID', value: `#${idea.id}`, inline: true },
    )
    .setFooter({ text: `Proposed by` })
    .setTimestamp(new Date(idea.created_at));

  if (idea.description) {
    embed.setDescription(idea.description);
  }

  return embed;
}

async function syncReactionCounts(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const messageId = reaction.message.id;
  const idea = ctx.db.prepare('SELECT * FROM ideas WHERE message_id = ?').get(messageId) as IdeaRow | undefined;
  if (!idea) return;

  const emoji = reaction.emoji.name;
  if (emoji !== '👍' && emoji !== '👎') return;

  const count = Math.max(0, (reaction.count ?? 1) - 1); // subtract bot's own reaction

  if (emoji === '👍') {
    ctx.db.prepare('UPDATE ideas SET upvotes = ? WHERE id = ?').run(count, idea.id);
  } else {
    ctx.db.prepare('UPDATE ideas SET downvotes = ? WHERE id = ?').run(count, idea.id);
  }

  ctx.logger.debug(`Updated votes for idea #${idea.id}: ${emoji} = ${count}`);
}

const ideaCommand = new SlashCommandBuilder()
  .setName('idea')
  .setDescription('Idea capture board with voting')
  .addSubcommand(sub =>
    sub
      .setName('new')
      .setDescription('Submit a new idea')
      .addStringOption(opt =>
        opt.setName('title').setDescription('Idea title').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('description').setDescription('Idea description').setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('List ideas for this project')
      .addStringOption(opt =>
        opt
          .setName('status')
          .setDescription('Filter by status')
          .setRequired(false)
          .addChoices(
            { name: 'Open', value: 'open' },
            { name: 'Approved', value: 'approved' },
            { name: 'Rejected', value: 'rejected' },
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('approve')
      .setDescription('Approve an idea')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Idea ID').setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('reject')
      .setDescription('Reject an idea')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Idea ID').setRequired(true)
      )
  );

export const ideasModule: BotModule = {
  name: 'ideas',
  description: 'Idea capture board with voting via reactions',
  commands: [ideaCommand],

  async onLoad(context: ModuleContext): Promise<void> {
    ctx = context;

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'open',
        message_id TEXT,
        channel_id TEXT,
        author_id TEXT NOT NULL,
        upvotes INTEGER DEFAULT 0,
        downvotes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    reactionAddHandler = async (reaction, user) => {
      if (user.bot) return;
      await syncReactionCounts(reaction);
    };

    reactionRemoveHandler = async (reaction, user) => {
      if (user.bot) return;
      await syncReactionCounts(reaction);
    };

    ctx.client.on(Events.MessageReactionAdd, reactionAddHandler);
    ctx.client.on(Events.MessageReactionRemove, reactionRemoveHandler);

    ctx.logger.info('Ideas module loaded');
  },

  async onUnload(): Promise<void> {
    if (reactionAddHandler) {
      ctx.client.off(Events.MessageReactionAdd, reactionAddHandler);
    }
    if (reactionRemoveHandler) {
      ctx.client.off(Events.MessageReactionRemove, reactionRemoveHandler);
    }
    ctx.logger.info('Ideas module unloaded');
  },

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'new':
        await handleNewIdea(interaction);
        break;
      case 'list':
        await handleListIdeas(interaction);
        break;
      case 'approve':
        await handleSetStatus(interaction, 'approved');
        break;
      case 'reject':
        await handleSetStatus(interaction, 'rejected');
        break;
    }
  },
};

async function handleNewIdea(interaction: ChatInputCommandInteraction): Promise<void> {
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description') ?? null;
  const project = getProjectFromChannel(interaction);
  const projectId = project?.id ?? null;

  const result = ctx.db.prepare(
    'INSERT INTO ideas (project_id, title, description, author_id) VALUES (?, ?, ?, ?)'
  ).run(projectId, title, description, interaction.user.id);

  const ideaId = result.lastInsertRowid as number;
  const idea = ctx.db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as IdeaRow;

  const embed = buildIdeaEmbed(idea);
  embed.setFooter({ text: `Proposed by ${interaction.user.displayName}` });

  const reply = await interaction.reply({ embeds: [embed], fetchReply: true });

  ctx.db.prepare('UPDATE ideas SET message_id = ?, channel_id = ? WHERE id = ?').run(
    reply.id,
    reply.channelId,
    ideaId
  );

  await reply.react('👍');
  await reply.react('👎');
}

async function handleListIdeas(interaction: ChatInputCommandInteraction): Promise<void> {
  const statusFilter = interaction.options.getString('status') ?? null;
  const project = getProjectFromChannel(interaction);
  const projectId = project?.id ?? null;

  let query = 'SELECT * FROM ideas WHERE 1=1';
  const params: (string | null)[] = [];

  if (projectId) {
    query += ' AND project_id = ?';
    params.push(projectId);
  }

  if (statusFilter) {
    query += ' AND status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY (upvotes - downvotes) DESC, created_at DESC';

  const ideas = ctx.db.prepare(query).all(...params) as IdeaRow[];

  if (ideas.length === 0) {
    await interaction.reply({ content: 'No ideas found matching the criteria.', ephemeral: true });
    return;
  }

  const lines = ideas.map(idea => {
    const net = idea.upvotes - idea.downvotes;
    const sign = net >= 0 ? '+' : '';
    return `${statusBadge(idea.status)} **#${idea.id}** — ${idea.title} (${sign}${net} votes, 👍${idea.upvotes} 👎${idea.downvotes})`;
  });

  const embed = new EmbedBuilder()
    .setTitle('💡 Ideas Board')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `${ideas.length} idea${ideas.length !== 1 ? 's' : ''} found` });

  await interaction.reply({ embeds: [embed] });
}

async function handleSetStatus(
  interaction: ChatInputCommandInteraction,
  newStatus: 'approved' | 'rejected'
): Promise<void> {
  const ideaId = interaction.options.getInteger('id', true);
  const idea = ctx.db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as IdeaRow | undefined;

  if (!idea) {
    await interaction.reply({ content: `Idea #${ideaId} not found.`, ephemeral: true });
    return;
  }

  ctx.db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(newStatus, ideaId);

  const updatedIdea = ctx.db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as IdeaRow;
  const embed = buildIdeaEmbed(updatedIdea);

  // Try to update the original message embed
  if (idea.message_id && idea.channel_id) {
    try {
      const channel = await ctx.client.channels.fetch(idea.channel_id) as TextChannel;
      const message = await channel.messages.fetch(idea.message_id);
      await message.edit({ embeds: [embed] });
    } catch (err) {
      ctx.logger.warn(`Could not update original idea message for #${ideaId}: ${err}`);
    }
  }

  const verb = newStatus === 'approved' ? 'approved' : 'rejected';
  await interaction.reply({ content: `Idea **#${ideaId}** has been ${verb}.`, embeds: [embed] });
}
