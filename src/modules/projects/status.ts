import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
  ChannelType,
  type Guild,
  type CategoryChannel,
} from 'discord.js';
import type { ModuleContext } from '../../types';
import { fetchGitHubProjectStatus } from '../../utils/github-status';
import { fetchLinearProjectStatus } from '../../utils/linear-status';
import { generateProjectStatus, type ProjectStatusReport } from '../../core/ai-status';
import { config } from '../../config';

const ROADMAP_CHANNEL_SUFFIX = '-roadmap';
const BOT_STATUS_FOOTER = 'PayPal Mafia Bot • Status Report';

interface ProjectRecord {
  id: string;
  name: string;
  discord_category_id: string;
  github_repo: string | null;
  linear_team_id: string | null;
}

function getLocalMetrics(db: any, projectId: string) {
  const week = db
    .prepare(
      "SELECT COALESCE(SUM(commits_count),0) as commits, COALESCE(SUM(issues_closed),0) as issues, COALESCE(SUM(prs_merged),0) as prs FROM metrics_snapshots WHERE project_id = ? AND date >= date('now','-7 days')",
    )
    .get(projectId) as any;

  const prev = db
    .prepare(
      "SELECT COALESCE(SUM(commits_count),0) as commits FROM metrics_snapshots WHERE project_id = ? AND date >= date('now','-14 days') AND date < date('now','-7 days')",
    )
    .get(projectId) as any;

  return {
    commits7d: week?.commits ?? 0,
    issues7d: week?.issues ?? 0,
    prs7d: week?.prs ?? 0,
    prevCommits7d: prev?.commits ?? 0,
  };
}

function healthEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🟠';
  return '🔴';
}

function trendEmoji(trend: string): string {
  if (trend === 'up') return '📈';
  if (trend === 'down') return '📉';
  return '➡️';
}

function buildOverviewEmbed(project: ProjectRecord, report: ProjectStatusReport): EmbedBuilder {
  const health = report.metrics.healthScore;

  return new EmbedBuilder()
    .setTitle(`📊 Status — ${project.name}`)
    .setColor(health >= 70 ? 0x00ff88 : health >= 40 ? 0xf2c94c : 0xd73a49)
    .setDescription(report.executiveSummary)
    .addFields(
      {
        name: `${healthEmoji(health)} Health Score`,
        value: `**${health}/100**`,
        inline: true,
      },
      {
        name: `${trendEmoji(report.metrics.velocityTrend)} Velocity`,
        value: report.metrics.velocityTrend === 'up'
          ? 'Crescendo'
          : report.metrics.velocityTrend === 'down'
            ? 'Caindo'
            : 'Estável',
        inline: true,
      },
      {
        name: '👥 Top Contributors',
        value: report.metrics.topContributors.length > 0
          ? report.metrics.topContributors.join(', ')
          : 'N/A',
        inline: true,
      },
    )
    .setFooter({ text: BOT_STATUS_FOOTER })
    .setTimestamp();
}

function buildTechnicalEmbed(
  project: ProjectRecord,
  report: ProjectStatusReport,
  github: any,
  linear: any,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🔧 Dev Report — ${project.name}`)
    .setColor(0x24292e)
    .setDescription(report.technicalSummary)
    .setTimestamp()
    .setFooter({ text: BOT_STATUS_FOOTER });

  if (github) {
    // Recent commits
    if (github.recentCommits.length > 0) {
      const commitList = github.recentCommits
        .slice(0, 5)
        .map((c: any) => `[\`${c.sha}\`](${c.url}) ${c.message.slice(0, 50)}`)
        .join('\n');
      embed.addFields({ name: '📝 Commits Recentes', value: commitList });
    }

    // Open PRs
    if (github.pullRequests.open.length > 0) {
      const prList = github.pullRequests.open
        .slice(0, 5)
        .map((pr: any) => `[#${pr.number}](${pr.url}) ${pr.title} (+${pr.additions} -${pr.deletions})`)
        .join('\n');
      embed.addFields({ name: '🔀 PRs Abertas', value: prList });
    }

    // CI Status
    if (github.ciStatus.lastRun) {
      const ciEmoji = github.ciStatus.lastRun.conclusion === 'success' ? '✅' : '❌';
      embed.addFields({
        name: '🏗️ CI/CD',
        value: `${ciEmoji} ${github.ciStatus.lastRun.name}: ${github.ciStatus.lastRun.conclusion || 'running'}\nTaxa de sucesso: ${github.ciStatus.recentSuccessRate}%`,
        inline: true,
      });
    }

    // Branches
    if (github.branches.length > 0) {
      const branchList = github.branches
        .filter((b: any) => b.name !== 'main' && b.name !== 'master')
        .slice(0, 5)
        .map((b: any) => `\`${b.name}\``)
        .join(', ');
      if (branchList) {
        embed.addFields({ name: '🌿 Branches Ativas', value: branchList, inline: true });
      }
    }

    // Languages
    if (Object.keys(github.languages).length > 0) {
      const totalBytes = Object.values(github.languages).reduce((a: number, b: any) => a + b, 0) as number;
      const langs = Object.entries(github.languages)
        .slice(0, 4)
        .map(([lang, bytes]) => `${lang} ${Math.round(((bytes as number) / totalBytes) * 100)}%`)
        .join(' • ');
      embed.addFields({ name: '💻 Stack', value: langs, inline: true });
    }
  }

  if (linear) {
    // Issues summary
    const stateCounts = linear.issuesByState
      .map((g: any) => `${g.state}: ${g.count}`)
      .join(' | ');
    if (stateCounts) {
      embed.addFields({ name: '📋 Issues', value: stateCounts });
    }

    // Active sprint
    if (linear.activeCycle) {
      const c = linear.activeCycle;
      const progressBar = buildProgressBar(c.progress);
      embed.addFields({
        name: `🏃 Sprint: ${c.name}`,
        value: `${progressBar} ${Math.round(c.progress * 100)}%\n${c.issuesCompleted}/${c.issuesTotal} issues • ${c.scopeCompleted}/${c.scopeTotal} pts`,
      });
    }

    // Blockers
    if (linear.blockers.length > 0) {
      const blockerList = linear.blockers
        .slice(0, 3)
        .map((b: any) => `⚠️ **${b.identifier}**: ${b.title} (${b.daysSinceUpdate}d parada)`)
        .join('\n');
      embed.addFields({ name: '🚨 Blockers', value: blockerList });
    }
  }

  return embed;
}

function buildRoadmapEmbed(
  project: ProjectRecord,
  report: ProjectStatusReport,
  linear: any,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`🗺️ Roadmap — ${project.name}`)
    .setColor(0x5e6ad2)
    .setTimestamp()
    .setFooter({ text: BOT_STATUS_FOOTER });

  // Short term
  if (report.roadmap.shortTerm.length > 0) {
    embed.addFields({
      name: '📌 Esta Semana / Sprint',
      value: report.roadmap.shortTerm.map((s) => `• ${s}`).join('\n'),
    });
  }

  // Medium term
  if (report.roadmap.mediumTerm.length > 0) {
    embed.addFields({
      name: '🎯 Próximas 2 Semanas',
      value: report.roadmap.mediumTerm.map((s) => `• ${s}`).join('\n'),
    });
  }

  // Linear milestones
  if (linear?.projects?.length > 0) {
    for (const proj of linear.projects) {
      if (proj.milestones.length > 0) {
        const milestoneList = proj.milestones
          .map((m: any) => `• ${m.name}${m.targetDate ? ` (${m.targetDate})` : ''}`)
          .join('\n');
        embed.addFields({
          name: `📍 Milestones — ${proj.name}`,
          value: `Progresso: ${Math.round(proj.progress * 100)}%\n${milestoneList}`,
        });
      }
    }
  }

  // Upcoming sprint
  if (linear?.upcomingCycle) {
    embed.addFields({
      name: '⏭️ Próximo Sprint',
      value: `${linear.upcomingCycle.name} — inicia ${new Date(linear.upcomingCycle.startsAt).toLocaleDateString('pt-BR')}`,
    });
  }

  // Risks
  if (report.roadmap.risks.length > 0) {
    embed.addFields({
      name: '⚠️ Riscos Identificados',
      value: report.roadmap.risks.map((r) => `• ${r}`).join('\n'),
    });
  }

  // Velocity context
  if (linear?.velocity) {
    const v = linear.velocity;
    const velStr = [
      `Esta semana: ${v.completedThisWeek} issues`,
      `Semana passada: ${v.completedLastWeek} issues`,
      v.avgPointsPerCycle > 0 ? `Média/ciclo: ${v.avgPointsPerCycle} pts` : null,
    ]
      .filter(Boolean)
      .join('\n');
    embed.addFields({ name: '📊 Velocity', value: velStr, inline: true });
  }

  return embed;
}

function buildProgressBar(progress: number): string {
  const filled = Math.round(progress * 10);
  const empty = 10 - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

async function findOrCreateChannel(
  guild: Guild,
  categoryId: string,
  channelName: string,
): Promise<TextChannel | null> {
  // Check if channel already exists
  const existing = guild.channels.cache.find(
    (c) => c.parentId === categoryId && c.name === channelName,
  ) as TextChannel | undefined;

  if (existing) return existing;

  // Create the channel
  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
    });
    return channel as TextChannel;
  } catch (error) {
    return null;
  }
}

async function updateOrPostEmbed(
  channel: TextChannel,
  embed: EmbedBuilder,
  botUserId: string,
): Promise<void> {
  // Find the last status message from the bot in this channel
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    const existingMsg = messages.find(
      (m) =>
        m.author.id === botUserId &&
        m.embeds.length > 0 &&
        m.embeds[0].footer?.text === BOT_STATUS_FOOTER,
    );

    if (existingMsg) {
      await existingMsg.edit({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch {
    // Fallback: just send a new message
    await channel.send({ embeds: [embed] });
  }
}

export async function handleProjectStatus(
  interaction: ChatInputCommandInteraction,
  ctx: ModuleContext,
): Promise<void> {
  const projectName = interaction.options.getString('name');

  let project: ProjectRecord | undefined;

  if (projectName) {
    project = ctx.db
      .prepare('SELECT * FROM projects WHERE name = ? AND archived_at IS NULL')
      .get(projectName) as ProjectRecord | undefined;
  } else {
    const channel = interaction.channel as TextChannel;
    if (channel?.parentId) {
      project = ctx.db
        .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
        .get(channel.parentId) as ProjectRecord | undefined;
    }
  }

  if (!project) {
    await interaction.reply({
      content: 'Projeto não encontrado. Use `/project status name:<nome>` ou execute em um canal de projeto.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();
  await interaction.editReply('🔄 Coletando dados de GitHub, Linear e métricas locais...');

  const guild = interaction.guild;
  if (!guild) return;

  // Fetch all data in parallel
  const [githubStatus, linearStatus] = await Promise.all([
    project.github_repo
      ? fetchGitHubProjectStatus(project.github_repo, config.github.token)
      : Promise.resolve(null),
    project.linear_team_id
      ? fetchLinearProjectStatus(project.linear_team_id, config.linear.apiKey)
      : Promise.resolve(null),
  ]);

  const localMetrics = getLocalMetrics(ctx.db, project.id);

  await interaction.editReply('🤖 Gerando relatório com AI...');

  // Generate AI report
  const report = await generateProjectStatus(
    project.name,
    githubStatus,
    linearStatus,
    localMetrics,
  );

  if (!report) {
    await interaction.editReply('❌ Não foi possível gerar o relatório. Verifique GEMINI_API_KEY.');
    return;
  }

  // Build embeds
  const overviewEmbed = buildOverviewEmbed(project, report);
  const technicalEmbed = buildTechnicalEmbed(project, report, githubStatus, linearStatus);
  const roadmapEmbed = buildRoadmapEmbed(project, report, linearStatus);

  // Reply with full report
  await interaction.editReply({
    content: '',
    embeds: [overviewEmbed, technicalEmbed, roadmapEmbed],
  });

  // Feed channels
  await interaction.followUp({ content: '📡 Atualizando canais do projeto...', ephemeral: true });

  const botUserId = ctx.client.user?.id || '';

  // Find project channels
  const generalChannel = guild.channels.cache.find(
    (c) => c.parentId === project!.discord_category_id && c.name.endsWith('-general'),
  ) as TextChannel | undefined;

  const devChannel = guild.channels.cache.find(
    (c) => c.parentId === project!.discord_category_id && c.name.endsWith('-dev'),
  ) as TextChannel | undefined;

  // Create roadmap channel if it doesn't exist
  const roadmapChannel = await findOrCreateChannel(
    guild,
    project.discord_category_id,
    `${project.name}${ROADMAP_CHANNEL_SUFFIX}`,
  );

  // Post to channels (update existing bot messages, don't spam)
  const feedPromises: Promise<void>[] = [];

  if (generalChannel) {
    feedPromises.push(updateOrPostEmbed(generalChannel, overviewEmbed, botUserId));
  }

  if (devChannel) {
    feedPromises.push(updateOrPostEmbed(devChannel, technicalEmbed, botUserId));
  }

  if (roadmapChannel) {
    feedPromises.push(updateOrPostEmbed(roadmapChannel, roadmapEmbed, botUserId));
  }

  await Promise.all(feedPromises);

  ctx.logger.info(`Project status generated and fed to channels for ${project.name}`);
}
