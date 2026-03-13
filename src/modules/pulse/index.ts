import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import type { BotModule, ModuleContext, CronJob } from '../../types';

let ctx: ModuleContext;

export const pulseModule: BotModule = {
  name: 'pulse',
  description: 'Project metrics and health monitoring',
  commands: [
    new SlashCommandBuilder()
      .setName('pulse')
      .setDescription('Show project health dashboard')
      .addStringOption((opt) =>
        opt.setName('project').setDescription('Project name (default: current channel project)')
      ) as any,
  ],

  cronJobs: [
    {
      name: 'weekly-digest',
      schedule: '0 12 * * 1', // Monday 9am BRT = 12 UTC
      handler: async () => {
        await generateWeeklyDigest();
      },
    },
    {
      name: 'inactivity-check',
      schedule: '0 15 * * *', // Daily 12pm BRT = 15 UTC
      handler: async () => {
        await checkInactivity();
      },
    },
  ],

  async onLoad(context) {
    ctx = context;
    ctx.logger.info('Pulse module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const projectName = interaction.options.getString('project');

    let project: any;

    if (projectName) {
      project = ctx.db
        .prepare('SELECT * FROM projects WHERE name = ? AND archived_at IS NULL')
        .get(projectName);
    } else {
      const channel = interaction.channel as TextChannel;
      if (channel?.parentId) {
        project = ctx.db
          .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
          .get(channel.parentId);
      }
    }

    if (!project) {
      await interaction.reply({ content: 'Projeto não encontrado. Use `/pulse <nome>` ou execute em um canal de projeto.', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const weekMetrics = ctx.db
      .prepare(
        "SELECT COALESCE(SUM(commits_count), 0) as commits, COALESCE(SUM(issues_closed), 0) as issues, COALESCE(SUM(prs_merged), 0) as prs FROM metrics_snapshots WHERE project_id = ? AND date >= date('now', '-7 days')"
      )
      .get(project.id) as any;

    const prevWeekMetrics = ctx.db
      .prepare(
        "SELECT COALESCE(SUM(commits_count), 0) as commits, COALESCE(SUM(issues_closed), 0) as issues, COALESCE(SUM(prs_merged), 0) as prs FROM metrics_snapshots WHERE project_id = ? AND date >= date('now', '-14 days') AND date < date('now', '-7 days')"
      )
      .get(project.id) as any;

    const trend = (current: number, previous: number): string => {
      if (previous === 0) return current > 0 ? ' (+)' : '';
      const pct = Math.round(((current - previous) / previous) * 100);
      return pct > 0 ? ` (+${pct}%)` : pct < 0 ? ` (${pct}%)` : '';
    };

    const embed = new EmbedBuilder()
      .setTitle(`Pulse — ${project.name}`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Commits (7d)', value: `${weekMetrics.commits}${trend(weekMetrics.commits, prevWeekMetrics.commits)}`, inline: true },
        { name: 'Issues Fechadas (7d)', value: `${weekMetrics.issues}${trend(weekMetrics.issues, prevWeekMetrics.issues)}`, inline: true },
        { name: 'PRs Merged (7d)', value: `${weekMetrics.prs}${trend(weekMetrics.prs, prevWeekMetrics.prs)}`, inline: true },
      )
      .setTimestamp();

    if (project.github_repo) {
      embed.addFields({ name: 'GitHub', value: project.github_repo, inline: true });
    }
    if (project.linear_team_id) {
      embed.addFields({ name: 'Linear', value: project.linear_team_id, inline: true });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

async function generateWeeklyDigest() {
  const projects = ctx.db
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL')
    .all() as any[];

  const guild = ctx.client.guilds.cache.first();
  if (!guild) return;

  for (const project of projects) {
    const channels = guild.channels.cache.filter(
      (c) => c.parentId === project.discord_category_id && c.name.endsWith('-general')
    );
    const generalChannel = channels.first() as TextChannel | undefined;
    if (!generalChannel) continue;

    const metrics = ctx.db
      .prepare(
        "SELECT COALESCE(SUM(commits_count), 0) as commits, COALESCE(SUM(issues_closed), 0) as issues, COALESCE(SUM(prs_merged), 0) as prs FROM metrics_snapshots WHERE project_id = ? AND date >= date('now', '-7 days')"
      )
      .get(project.id) as any;

    const embed = new EmbedBuilder()
      .setTitle(`Weekly Digest — ${project.name}`)
      .setColor(0xf2c94c)
      .addFields(
        { name: 'Commits', value: `${metrics.commits}`, inline: true },
        { name: 'Issues Fechadas', value: `${metrics.issues}`, inline: true },
        { name: 'PRs Merged', value: `${metrics.prs}`, inline: true },
      )
      .setTimestamp();

    await generalChannel.send({ embeds: [embed] });
  }
}

async function checkInactivity() {
  const projects = ctx.db
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL')
    .all() as any[];

  const guild = ctx.client.guilds.cache.first();
  if (!guild) return;

  for (const project of projects) {
    const recent = ctx.db
      .prepare(
        "SELECT SUM(commits_count) as total FROM metrics_snapshots WHERE project_id = ? AND date >= date('now', '-5 days')"
      )
      .get(project.id) as any;

    if (recent && (recent.total === null || recent.total === 0)) {
      const channels = guild.channels.cache.filter(
        (c) => c.parentId === project.discord_category_id && c.name.endsWith('-general')
      );
      const generalChannel = channels.first() as TextChannel | undefined;
      if (!generalChannel) continue;

      const embed = new EmbedBuilder()
        .setTitle(`Inatividade detectada`)
        .setDescription(`Projeto **${project.name}** sem commits nos últimos 5 dias.`)
        .setColor(0xd73a49)
        .setTimestamp();

      await generalChannel.send({ embeds: [embed] });
    }
  }
}
