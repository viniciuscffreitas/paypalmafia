import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { Router, type Request, type Response } from 'express';
import { LinearClient } from '@linear/sdk';
import type { BotModule, ModuleContext } from '../../types';
import { generateIssueDescription, classifyIssue, reformatIssueTitle } from '../../core/ai';
import { buildPreviewEmbed, buildConfirmRow, extractTldr } from './task-preview';
import { config } from '../../config';

let ctx: ModuleContext;
let linearClient: LinearClient | null = null;

let stateCache: { states: Map<string, string>; fetchedAt: number } | null = null;

async function getTeamStates(teamId: string): Promise<Map<string, string>> {
  if (stateCache && Date.now() - stateCache.fetchedAt < 3600000) {
    return stateCache.states;
  }

  if (!linearClient) return new Map();

  const teams = await linearClient.teams({ filter: { id: { eq: teamId } } });
  const team = teams.nodes[0];
  if (!team) return new Map();

  const states = await team.states();
  const stateMap = new Map<string, string>();
  for (const state of states.nodes) {
    stateMap.set(state.name.toLowerCase(), state.id);
  }

  stateCache = { states: stateMap, fetchedAt: Date.now() };
  return stateMap;
}

async function closeIssues(identifiers: string[], comment: string): Promise<void> {
  if (!linearClient) return;

  for (const id of identifiers) {
    try {
      const result = await linearClient.searchIssues(id);
      const issue = result.nodes.find((i: any) => i.identifier === id);
      if (!issue) continue;

      const team = await issue.team;
      if (!team) continue;

      const states = await getTeamStates(team.id);
      const doneStateId = states.get('done');

      if (doneStateId) {
        await linearClient.updateIssue(issue.id, { stateId: doneStateId });
      }

      await linearClient.createComment({ issueId: issue.id, body: comment });
      ctx.logger.info(`Closed Linear issue ${id}`);
    } catch (error) {
      ctx.logger.error(`Failed to close issue ${id}:`, error);
    }
  }
}

async function moveIssuesToState(identifiers: string[], stateName: string): Promise<void> {
  if (!linearClient) return;

  for (const id of identifiers) {
    try {
      const result = await linearClient.searchIssues(id);
      const issue = result.nodes.find((i: any) => i.identifier === id);
      if (!issue) continue;

      const team = await issue.team;
      if (!team) continue;

      const states = await getTeamStates(team.id);
      const stateId = states.get(stateName.toLowerCase());

      if (stateId) {
        await linearClient.updateIssue(issue.id, { stateId });
        ctx.logger.info(`Moved ${id} to "${stateName}"`);
      }
    } catch (error) {
      ctx.logger.error(`Failed to move issue ${id} to "${stateName}":`, error);
    }
  }
}

function getProjectFromChannel(interaction: ChatInputCommandInteraction): any | null {
  const channel = interaction.channel as TextChannel;
  if (!channel?.parentId) return null;
  return ctx.db
    .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
    .get(channel.parentId);
}

const webhookRouter = Router();

export const linearModule: BotModule = {
  name: 'linear',
  description: 'Linear integration — issues and webhooks',
  commands: [
    new SlashCommandBuilder()
      .setName('linear')
      .setDescription('Linear integration')
      .addSubcommand((sub) =>
        sub
          .setName('link')
          .setDescription('Link Linear team to this project')
          .addStringOption((opt) =>
            opt.setName('team').setDescription('Linear team key (e.g. ENG)').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('sync').setDescription('List open issues from Linear')
      ) as any,
    new SlashCommandBuilder()
      .setName('task')
      .setDescription('Create a Linear issue from Discord')
      .addStringOption((opt) =>
        opt.setName('title').setDescription('Issue title').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('description').setDescription('Issue description')
      ) as any,
  ],
  webhookRoutes: webhookRouter,

  async onLoad(context) {
    ctx = context;
    const apiKey = process.env['LINEAR_API_KEY'];
    if (apiKey) {
      linearClient = new LinearClient({ apiKey });
      ctx.logger.info('Linear client initialized');
    } else {
      ctx.logger.warn('LINEAR_API_KEY not set — Linear features disabled');
    }
    setupWebhookRoutes();
    ctx.logger.info('Linear module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const cmd = interaction.commandName;

    if (cmd === 'task') {
      await handleCreateTask(interaction);
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'link') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use em um canal de projeto.', ephemeral: true });
        return;
      }
      const teamKey = interaction.options.getString('team', true);
      ctx.db.prepare('UPDATE projects SET linear_team_id = ? WHERE id = ?').run(teamKey, project.id);
      await interaction.reply(`Linear team **${teamKey}** linkado ao projeto **${project.name}**.`);
    } else if (sub === 'sync') {
      await handleSync(interaction);
    }
  },
};

(linearModule as any).closeIssues = closeIssues;
(linearModule as any).moveIssuesToState = moveIssuesToState;

async function handleCreateTask(interaction: ChatInputCommandInteraction) {
  if (!linearClient) {
    await interaction.reply({ content: 'Linear não configurado. Defina LINEAR_API_KEY.', ephemeral: true });
    return;
  }

  const project = getProjectFromChannel(interaction);
  if (!project || !project.linear_team_id) {
    await interaction.reply({ content: 'Projeto sem Linear team linkado. Use `/linear link` primeiro.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const rawTitle = interaction.options.getString('title', true);
  const manualDescription = interaction.options.getString('description');

  try {
    const teams = await linearClient.teams({ filter: { key: { eq: project.linear_team_id } } });
    const team = teams.nodes[0];
    if (!team) {
      await interaction.editReply(`Linear team **${project.linear_team_id}** não encontrado.`);
      return;
    }

    // Step 1 — AI formats everything in parallel
    await interaction.editReply('🤖 Formatando task com AI...');
    const [title, description, metadata] = await Promise.all([
      reformatIssueTitle(rawTitle),
      manualDescription
        ? Promise.resolve(manualDescription)
        : generateIssueDescription(rawTitle, project.name, project.github_repo, project.linear_team_id),
      classifyIssue(rawTitle),
    ]);

    const resolvedDescription = description ?? undefined;

    // Step 2 — Show preview with confirm/cancel buttons
    const previewEmbed = buildPreviewEmbed(
      title,
      rawTitle,
      resolvedDescription,
      metadata,
      interaction.user.displayName,
      project.name,
    );
    const confirmRow = buildConfirmRow();

    const previewMsg = await interaction.editReply({
      content: '',
      embeds: [previewEmbed],
      components: [confirmRow],
    });

    // Step 3 — Wait for confirmation (5 min timeout)
    let confirmed = false;
    try {
      const buttonInteraction = await previewMsg.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && ['task_confirm', 'task_cancel'].includes(i.customId),
        time: 5 * 60 * 1000,
      });

      await buttonInteraction.deferUpdate();
      confirmed = buttonInteraction.customId === 'task_confirm';
    } catch {
      // Timeout — treat as cancel
    }

    if (!confirmed) {
      await interaction.editReply({ content: '❌ Criação de task cancelada.', embeds: [], components: [] });
      return;
    }

    await interaction.editReply({ content: '⏳ Criando issue no Linear...', embeds: [], components: [] });

    // Step 4 — Create issue
    const labelIds: string[] = [];
    try {
      const existingLabels = await team.labels();
      for (const labelName of metadata.labels) {
        const existing = existingLabels.nodes.find(
          (l: any) => l.name.toLowerCase() === labelName.toLowerCase()
        );
        if (existing) {
          labelIds.push(existing.id);
        } else {
          const created = await linearClient!.createIssueLabel({ name: labelName, teamId: team.id });
          const label = await created.issueLabel;
          if (label) labelIds.push(label.id);
        }
      }
    } catch (err) {
      ctx.logger.warn('Could not sync labels:', err);
    }

    let cycleId: string | undefined;
    try {
      const cycles = await team.cycles({ filter: { isActive: { eq: true } } });
      if (cycles.nodes.length > 0) cycleId = cycles.nodes[0].id;
    } catch {
      // No active cycle
    }

    const issue = await linearClient!.createIssue({
      teamId: team.id,
      title,
      description: resolvedDescription,
      priority: metadata.priority,
      estimate: metadata.estimate,
      labelIds: labelIds.length > 0 ? labelIds : undefined,
      cycleId,
    });

    const created = await issue.issue;
    if (!created) {
      await interaction.editReply('Erro ao criar issue.');
      return;
    }

    // Step 5 — Auto-create GitHub branch
    let branchName: string | null = null;
    if (project.github_repo) {
      const { generateBranchSlug } = await import('../../utils/linear-ids');
      const { createBranch } = await import('../../utils/github-api');
      const slug = generateBranchSlug(title);
      branchName = `feat/${created.identifier}-${slug}`;
      const branchCreated = await createBranch(project.github_repo, branchName, config.github.token);
      if (branchCreated) {
        ctx.logger.info(`Branch created: ${branchName}`);
      } else {
        ctx.logger.warn(`Failed to create branch: ${branchName}`);
        branchName = null;
      }
    }

    // Step 6 — Final confirmation embed
    const priorityMap: Record<number, string> = {
      1: '🔴 Urgente', 2: '🟠 Alta', 3: '🟡 Média', 4: '🟢 Baixa',
    };
    const tldr = resolvedDescription ? extractTldr(resolvedDescription) : '';

    const finalEmbed = new EmbedBuilder()
      .setTitle(`📋 ${title}`)
      .setURL(created.url)
      .setColor(0x5e6ad2)
      .setDescription(tldr ? `> ${tldr}` : null)
      .addFields(
        { name: '🔖 ID', value: `[\`${created.identifier}\`](${created.url})`, inline: true },
        { name: '👥 Time', value: project.linear_team_id, inline: true },
        { name: '📊 Status', value: '🔵 Backlog', inline: true },
        { name: '⚡ Prioridade', value: priorityMap[metadata.priority] || '🟡 Média', inline: true },
        { name: '🎯 Estimativa', value: `${metadata.estimate} pontos`, inline: true },
        { name: '🏷️ Labels', value: metadata.labels.join(', ') || 'nenhum', inline: true },
        { name: '📁 Projeto', value: project.name, inline: true },
        { name: '👤 Criado por', value: interaction.user.displayName, inline: true },
        { name: '🔄 Sprint', value: cycleId ? '✅ Atribuído' : '⚠️ Sem sprint ativo', inline: true },
      )
      .setFooter({ text: 'PayPal Mafia Bot • Linear • Gemini 3.1 Pro' })
      .setTimestamp();

    if (branchName) {
      finalEmbed.addFields({ name: '🌿 Branch', value: `\`${branchName}\``, inline: false });
    }

    await interaction.editReply({ content: '', embeds: [finalEmbed], components: [] });
  } catch (error) {
    ctx.logger.error('Linear create issue error:', error);
    await interaction.editReply({ content: 'Erro ao criar issue no Linear.', components: [] });
  }
}

async function handleSync(interaction: ChatInputCommandInteraction) {
  if (!linearClient) {
    await interaction.reply({ content: 'Linear não configurado.', ephemeral: true });
    return;
  }

  const project = getProjectFromChannel(interaction);
  if (!project || !project.linear_team_id) {
    await interaction.reply({ content: 'Projeto sem Linear linkado.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    const teams = await linearClient.teams({ filter: { key: { eq: project.linear_team_id } } });
    const team = teams.nodes[0];
    if (!team) {
      await interaction.editReply(`Team **${project.linear_team_id}** não encontrado.`);
      return;
    }

    const issues = await team.issues({
      filter: { state: { type: { nin: ['completed', 'canceled'] } } },
      first: 15,
    });

    if (issues.nodes.length === 0) {
      await interaction.editReply('Nenhuma issue aberta.');
      return;
    }

    const statusEmojis: Record<string, string> = {
      'Backlog': '🔵',
      'Todo': '📋',
      'In Progress': '🟡',
      'In Review': '🟣',
      'Done': '✅',
      'Canceled': '❌',
    };

    const issueLines = await Promise.all(
      issues.nodes.map(async (i: any) => {
        const state = await i.state;
        const stateName = state?.name || '?';
        const emoji = statusEmojis[stateName] || '⚪';
        const assignee = await i.assignee;
        const assigneeName = assignee ? ` → ${assignee.name}` : '';
        return `${emoji} **\`${i.identifier}\`** [${i.title}](${i.url})${assigneeName}`;
      })
    );

    const embed = new EmbedBuilder()
      .setTitle(`📋 Issues Abertas — ${project.name}`)
      .setColor(0x5e6ad2)
      .setDescription(issueLines.join('\n'))
      .setFooter({ text: `Linear • Time ${project.linear_team_id} • ${issues.nodes.length} issues` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    ctx.logger.error('Linear sync error:', error);
    await interaction.editReply('Erro ao sincronizar com Linear.');
  }
}

function setupWebhookRoutes() {
  webhookRouter.post('/', async (req: Request, res: Response) => {
    res.status(200).json({ ok: true });

    try {
      const { type, data, action } = req.body;

      ctx.logger.info(`[linear-webhook] received type=${type} action=${action}`);

      if (type !== 'Issue') return;

      const teamKey = data?.team?.key;
      if (!teamKey) return;

      const project = ctx.db
        .prepare('SELECT * FROM projects WHERE linear_team_id = ? AND archived_at IS NULL')
        .get(teamKey) as any;
      if (!project) return;

      const guild = ctx.client.guilds.cache.first();
      if (!guild) return;

      const channels = guild.channels.cache.filter(
        (c) => c.parentId === project.discord_category_id && c.name.endsWith('-dev')
      );
      const devChannel = channels.first() as TextChannel | undefined;
      if (!devChannel) return;

      const actionMap: Record<string, { color: number; emoji: string; label: string }> = {
        create: { color: 0x5e6ad2, emoji: '🆕', label: 'Criada' },
        update: { color: 0xf2c94c, emoji: '✏️', label: 'Atualizada' },
        remove: { color: 0xd73a49, emoji: '🗑️', label: 'Removida' },
      };

      const actionInfo = actionMap[action] || { color: 0x5e6ad2, emoji: '🔔', label: action };

      const statusEmojis: Record<string, string> = {
        'Backlog': '🔵',
        'Todo': '📋',
        'In Progress': '🟡',
        'In Review': '🟣',
        'Done': '✅',
        'Canceled': '❌',
      };
      const statusName = data.state?.name || 'Desconhecido';
      const statusEmoji = statusEmojis[statusName] || '⚪';

      const priorityMap: Record<number, string> = {
        0: '⚪ Sem prioridade',
        1: '🔴 Urgente',
        2: '🟠 Alta',
        3: '🟡 Média',
        4: '🟢 Baixa',
      };

      const embed = new EmbedBuilder()
        .setTitle(`${actionInfo.emoji} ${data.title || 'Issue'}`)
        .setURL(data.url || '')
        .setColor(actionInfo.color)
        .addFields(
          { name: '🔖 ID', value: `\`${data.identifier || '—'}\``, inline: true },
          { name: '📊 Status', value: `${statusEmoji} ${statusName}`, inline: true },
          { name: '🎯 Ação', value: actionInfo.label, inline: true },
        )
        .setFooter({ text: `Linear • ${project.name}` })
        .setTimestamp();

      if (data.priority !== undefined && data.priority !== null) {
        embed.addFields({ name: '⚡ Prioridade', value: priorityMap[data.priority] || '⚪ Sem prioridade', inline: true });
      }

      if (data.assignee) {
        embed.addFields({ name: '👤 Responsável', value: data.assignee.name, inline: true });
      }

      if (data.labels && data.labels.length > 0) {
        embed.addFields({ name: '🏷️ Labels', value: data.labels.map((l: any) => l.name).join(', '), inline: true });
      }

      if (data.description) {
        const shortDesc = data.description.length > 200 ? data.description.slice(0, 200) + '...' : data.description;
        embed.setDescription(`> ${shortDesc}`);
      }

      await devChannel.send({ embeds: [embed] });
      ctx.logger.info(`[linear-webhook] processed: ${action} ${data?.identifier || '?'} → ${statusName} (project: ${project.name})`);
    } catch (error) {
      ctx.logger.error('Linear webhook error:', error);
    }
  });
}
