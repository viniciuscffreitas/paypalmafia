import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;

function getProjectFromChannel(interaction: ChatInputCommandInteraction): any | null {
  const channel = interaction.channel as TextChannel;
  if (!channel?.parentId) return null;
  return ctx.db
    .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
    .get(channel.parentId);
}

export const decisionsModule: BotModule = {
  name: 'decisions',
  description: 'Decision log — records important decisions with context',
  commands: [
    new SlashCommandBuilder()
      .setName('decision')
      .setDescription('Decision log')
      .addSubcommand((sub) =>
        sub
          .setName('log')
          .setDescription('Log a new decision')
          .addStringOption((opt) =>
            opt.setName('title').setDescription('Decision title').setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName('context').setDescription('Context and reasoning').setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName('participants').setDescription('Who was involved in this decision')
          )
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List recent decisions for this project')
      )
      .addSubcommand((sub) =>
        sub
          .setName('search')
          .setDescription('Search decisions by keyword')
          .addStringOption((opt) =>
            opt.setName('query').setDescription('Search keyword').setRequired(true)
          )
      ) as any,
  ],

  async onLoad(context) {
    ctx = context;

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        title TEXT NOT NULL,
        context TEXT NOT NULL,
        participants TEXT,
        author_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    ctx.logger.info('Decisions module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'log') {
      await handleLog(interaction);
    } else if (sub === 'list') {
      await handleList(interaction);
    } else if (sub === 'search') {
      await handleSearch(interaction);
    }
  },
};

async function handleLog(interaction: ChatInputCommandInteraction) {
  const project = getProjectFromChannel(interaction);
  if (!project) {
    await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
    return;
  }

  const title = interaction.options.getString('title', true);
  const context = interaction.options.getString('context', true);
  const participants = interaction.options.getString('participants');

  const result = ctx.db
    .prepare(
      'INSERT INTO decisions (project_id, title, context, participants, author_id) VALUES (?, ?, ?, ?, ?)'
    )
    .run(project.id, title, context, participants, interaction.user.id);

  const decisionId = result.lastInsertRowid;

  const embed = new EmbedBuilder()
    .setTitle(`\u{1f4cb} ${title}`)
    .setColor(0x2ecc71)
    .addFields(
      { name: 'Contexto', value: context },
    )
    .setFooter({ text: `Decision #${decisionId} \u2014 ${new Date().toLocaleDateString('pt-BR')}` })
    .setTimestamp();

  if (participants) {
    embed.addFields({ name: 'Participantes', value: participants });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const project = getProjectFromChannel(interaction);
  if (!project) {
    await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
    return;
  }

  const decisions = ctx.db
    .prepare(
      'SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 10'
    )
    .all(project.id) as any[];

  if (decisions.length === 0) {
    await interaction.reply('Nenhuma decision registrada neste projeto.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`\u{1f4cb} Decisions \u2014 ${project.name}`)
    .setColor(0x2ecc71)
    .setDescription(
      decisions
        .map(
          (d) =>
            `**#${d.id}** ${d.title} \u2014 _${new Date(d.created_at).toLocaleDateString('pt-BR')}_`
        )
        .join('\n')
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleSearch(interaction: ChatInputCommandInteraction) {
  const project = getProjectFromChannel(interaction);
  if (!project) {
    await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
    return;
  }

  const query = interaction.options.getString('query', true);
  const pattern = `%${query}%`;

  const decisions = ctx.db
    .prepare(
      'SELECT * FROM decisions WHERE project_id = ? AND (title LIKE ? OR context LIKE ?) ORDER BY created_at DESC LIMIT 10'
    )
    .all(project.id, pattern, pattern) as any[];

  if (decisions.length === 0) {
    await interaction.reply({ content: `Nenhuma decision encontrada para "${query}".`, ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`\u{1f50d} Busca: "${query}"`)
    .setColor(0x2ecc71)
    .setDescription(
      decisions
        .map(
          (d) =>
            `**#${d.id}** ${d.title}\n${d.context.substring(0, 100)}${d.context.length > 100 ? '...' : ''}`
        )
        .join('\n\n')
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
