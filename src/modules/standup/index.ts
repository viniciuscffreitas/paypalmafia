import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ModalSubmitInteraction,
  Events,
  TextChannel,
} from 'discord.js';
import type { BotModule, ModuleContext, CronJob } from '../../types';

let ctx: ModuleContext;

export const standupModule: BotModule = {
  name: 'standup',
  description: 'Automated daily standups',
  commands: [
    new SlashCommandBuilder()
      .setName('standup')
      .setDescription('Standup')
      .addSubcommand((sub) =>
        sub.setName('post').setDescription('Post manual standup notes')
      )
      .addSubcommand((sub) =>
        sub
          .setName('history')
          .setDescription('View standup history')
          .addIntegerOption((opt) =>
            opt.setName('days').setDescription('Number of days to show (default 7)')
          )
      ) as any,
  ],

  cronJobs: [
    {
      name: 'daily-standup',
      schedule: '0 12 * * 1-5', // 9am BRT = 12 UTC, weekdays
      handler: async () => {
        await generateAutoStandup();
      },
    },
  ],

  async onLoad(context) {
    ctx = context;

    // Listen for modal submissions
    ctx.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isModalSubmit()) return;
      if (interaction.customId !== 'standup-modal') return;
      await handleModalSubmit(interaction);
    });

    ctx.logger.info('Standup module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'post') {
      const modal = new ModalBuilder()
        .setCustomId('standup-modal')
        .setTitle('Standup');

      const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('O que você está trabalhando?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      const blockersInput = new TextInputBuilder()
        .setCustomId('blockers')
        .setLabel('Bloqueios?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(blockersInput),
      );

      await interaction.showModal(modal);
    } else if (sub === 'history') {
      const days = interaction.options.getInteger('days') || 7;

      const standups = ctx.db
        .prepare(
          `SELECT * FROM standups WHERE created_at >= datetime('now', '-${days} days') ORDER BY created_at DESC LIMIT 20`
        )
        .all() as any[];

      if (standups.length === 0) {
        await interaction.reply('Nenhum standup nos últimos ' + days + ' dias.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Standups — últimos ${days} dias`)
        .setColor(0x5865f2)
        .setTimestamp();

      for (const s of standups.slice(0, 10)) {
        const parts = [];
        if (s.auto_summary) parts.push(s.auto_summary);
        if (s.manual_notes) parts.push(`**Notas:** ${s.manual_notes}`);
        if (s.blockers) parts.push(`**Bloqueios:** ${s.blockers}`);
        embed.addFields({
          name: new Date(s.created_at).toLocaleDateString('pt-BR'),
          value: parts.join('\n') || 'Sem detalhes',
        });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },
};

async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  const notes = interaction.fields.getTextInputValue('notes');
  const blockers = interaction.fields.getTextInputValue('blockers');

  // Try to find project from channel
  const channel = interaction.channel as TextChannel;
  let projectId: string | null = null;
  if (channel?.parentId) {
    const project = ctx.db
      .prepare('SELECT id FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
      .get(channel.parentId) as any;
    if (project) projectId = project.id;
  }

  ctx.db
    .prepare(
      'INSERT INTO standups (project_id, user_id, manual_notes, blockers) VALUES (?, ?, ?, ?)'
    )
    .run(projectId, interaction.user.id, notes || null, blockers || null);

  const embed = new EmbedBuilder()
    .setTitle(`Standup — ${interaction.user.displayName}`)
    .setColor(0x00ff88)
    .setTimestamp();

  if (notes) embed.addFields({ name: 'Notas', value: notes });
  if (blockers) embed.addFields({ name: 'Bloqueios', value: blockers });

  await interaction.reply({ embeds: [embed] });
}

async function generateAutoStandup() {
  const projects = ctx.db
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL')
    .all() as any[];

  const guild = ctx.client.guilds.cache.first();
  if (!guild) return;

  for (const project of projects) {
    const channels = guild.channels.cache.filter(
      (c) => c.parentId === project.discord_category_id && c.name.endsWith('-standup')
    );
    const standupChannel = channels.first() as TextChannel | undefined;
    if (!standupChannel) continue;

    const parts: string[] = [];
    parts.push(`**Standup automático — ${new Date().toLocaleDateString('pt-BR')}**`);
    parts.push('');

    // Summarize recent standups
    const recentStandups = ctx.db
      .prepare(
        "SELECT * FROM standups WHERE project_id = ? AND created_at >= datetime('now', '-1 day')"
      )
      .all(project.id) as any[];

    if (recentStandups.length > 0) {
      parts.push('**Atividade recente:**');
      for (const s of recentStandups) {
        if (s.manual_notes) parts.push(`• ${s.manual_notes}`);
      }
    }

    // Check for metrics
    const metrics = ctx.db
      .prepare(
        "SELECT * FROM metrics_snapshots WHERE project_id = ? AND date >= date('now', '-1 day')"
      )
      .get(project.id) as any;

    if (metrics) {
      parts.push('');
      parts.push(`**Métricas (24h):** ${metrics.commits_count} commits, ${metrics.issues_closed} issues fechadas, ${metrics.prs_merged} PRs merged`);
    }

    if (parts.length <= 2) {
      parts.push('Sem atividade registrada nas últimas 24h.');
    }

    const embed = new EmbedBuilder()
      .setTitle(`Daily Standup — ${project.name}`)
      .setDescription(parts.join('\n'))
      .setColor(0xf2c94c)
      .setTimestamp();

    await standupChannel.send({ embeds: [embed] });
  }
}
