import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import type { Database } from 'better-sqlite3';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;

const REGIONAL_INDICATORS = ['🇦', '🇧', '🇨', '🇩'];

interface PollRow {
  id: number;
  project_id: string | null;
  question: string;
  options: string; // JSON array
  message_id: string | null;
  channel_id: string | null;
  author_id: string;
  closed: number;
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

function buildPollEmbed(question: string, options: string[], authorName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(question)
    .setColor(0x5865f2)
    .setFooter({ text: 'Reaja para votar!' })
    .setTimestamp();

  const fields = options.map((opt, i) => ({
    name: REGIONAL_INDICATORS[i],
    value: opt,
    inline: true,
  }));

  embed.addFields(fields);
  embed.setAuthor({ name: `Poll by ${authorName}` });

  return embed;
}

function renderBar(percent: number, width: number = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

const pollCommand = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Create and manage quick polls')
  .addSubcommand(sub =>
    sub
      .setName('create')
      .setDescription('Create a new poll')
      .addStringOption(opt =>
        opt.setName('question').setDescription('The poll question').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('option1').setDescription('First option').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('option2').setDescription('Second option').setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('option3').setDescription('Third option').setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('option4').setDescription('Fourth option').setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('results')
      .setDescription('Show current poll results')
      .addIntegerOption(opt =>
        opt.setName('id').setDescription('Poll ID').setRequired(true)
      )
  );

export const pollsModule: BotModule = {
  name: 'polls',
  description: 'Quick async polls for decisions',
  commands: [pollCommand],

  async onLoad(context: ModuleContext): Promise<void> {
    ctx = context;

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        message_id TEXT,
        channel_id TEXT,
        author_id TEXT NOT NULL,
        closed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    ctx.logger.info('Polls module loaded');
  },

  async onUnload(): Promise<void> {
    ctx.logger.info('Polls module unloaded');
  },

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await handleCreatePoll(interaction);
        break;
      case 'results':
        await handlePollResults(interaction);
        break;
    }
  },
};

async function handleCreatePoll(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true);
  const option1 = interaction.options.getString('option1', true);
  const option2 = interaction.options.getString('option2', true);
  const option3 = interaction.options.getString('option3') ?? null;
  const option4 = interaction.options.getString('option4') ?? null;

  const options: string[] = [option1, option2];
  if (option3) options.push(option3);
  if (option4) options.push(option4);

  const project = getProjectFromChannel(interaction);
  const projectId = project?.id ?? null;

  const result = ctx.db.prepare(
    'INSERT INTO polls (project_id, question, options, author_id) VALUES (?, ?, ?, ?)'
  ).run(projectId, question, JSON.stringify(options), interaction.user.id);

  const pollId = result.lastInsertRowid as number;

  const embed = buildPollEmbed(question, options, interaction.user.displayName);
  embed.addFields({ name: 'ID', value: `#${pollId}`, inline: false });

  const reply = await interaction.reply({ embeds: [embed], fetchReply: true });

  ctx.db.prepare('UPDATE polls SET message_id = ?, channel_id = ? WHERE id = ?').run(
    reply.id,
    reply.channelId,
    pollId
  );

  for (let i = 0; i < options.length; i++) {
    await reply.react(REGIONAL_INDICATORS[i]);
  }
}

async function handlePollResults(interaction: ChatInputCommandInteraction): Promise<void> {
  const pollId = interaction.options.getInteger('id', true);
  const poll = ctx.db.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as PollRow | undefined;

  if (!poll) {
    await interaction.reply({ content: `Poll #${pollId} not found.`, ephemeral: true });
    return;
  }

  const options: string[] = JSON.parse(poll.options);
  const voteCounts: number[] = new Array(options.length).fill(0);

  // Fetch the original message to count reactions
  if (poll.message_id && poll.channel_id) {
    try {
      const channel = await ctx.client.channels.fetch(poll.channel_id) as TextChannel;
      const message = await channel.messages.fetch(poll.message_id);

      for (let i = 0; i < options.length; i++) {
        const reaction = message.reactions.cache.find(
          r => r.emoji.name === REGIONAL_INDICATORS[i]
        );
        if (reaction) {
          voteCounts[i] = Math.max(0, (reaction.count ?? 1) - 1); // subtract bot's reaction
        }
      }
    } catch (err) {
      ctx.logger.warn(`Could not fetch poll message for #${pollId}: ${err}`);
      await interaction.reply({
        content: `Could not fetch the original poll message. It may have been deleted.`,
        ephemeral: true,
      });
      return;
    }
  } else {
    await interaction.reply({
      content: `Poll #${pollId} has no associated message.`,
      ephemeral: true,
    });
    return;
  }

  const totalVotes = voteCounts.reduce((sum, count) => sum + count, 0);

  const lines = options.map((opt, i) => {
    const count = voteCounts[i];
    const percent = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const bar = renderBar(percent);
    return `${REGIONAL_INDICATORS[i]} ${opt}  ${bar} ${percent}% (${count})`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`📊 Results: ${poll.question}`)
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2)
    .setFooter({ text: `Total votes: ${totalVotes} | Poll #${pollId}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
