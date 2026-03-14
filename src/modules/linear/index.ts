import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { Router, type Request, type Response } from 'express';
import { LinearClient } from '@linear/sdk';
import type { BotModule, ModuleContext } from '../../types';
import { generateIssueDescription } from '../../core/ai';

let ctx: ModuleContext;
let linearClient: LinearClient | null = null;

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

  const title = interaction.options.getString('title', true);
  const manualDescription = interaction.options.getString('description');

  try {
    const teams = await linearClient.teams({ filter: { key: { eq: project.linear_team_id } } });
    const team = teams.nodes[0];
    if (!team) {
      await interaction.editReply(`Linear team **${project.linear_team_id}** não encontrado.`);
      return;
    }

    // Generate AI description if no manual description provided
    let description = manualDescription || undefined;
    if (!manualDescription) {
      await interaction.editReply('🤖 Gerando descrição com AI... (buscando contexto no GitHub, Linear e web)');
      const aiDesc = await generateIssueDescription(title, project.name, project.github_repo, project.linear_team_id);
      if (aiDesc) {
        description = aiDesc;
      }
    }

    const issue = await linearClient.createIssue({
      teamId: team.id,
      title,
      description,
    });

    const created = await issue.issue;
    if (!created) {
      await interaction.editReply('Erro ao criar issue.');
      return;
    }

    // Extract TL;DR from AI description (first ## TL;DR section)
    let tldr = '';
    if (description) {
      const tldrMatch = description.match(/##\s*TL;?DR\s*\n+(.+)/i);
      if (tldrMatch) {
        tldr = tldrMatch[1].trim();
      }
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${title}`)
      .setURL(created.url)
      .setColor(0x5e6ad2)
      .setDescription(tldr ? `> ${tldr}` : null)
      .addFields(
        { name: '🔖 ID', value: `\`${created.identifier}\``, inline: true },
        { name: '👥 Time', value: project.linear_team_id, inline: true },
        { name: '📊 Status', value: '🔵 Backlog', inline: true },
        { name: '📁 Projeto', value: project.name, inline: true },
        { name: '👤 Criado por', value: interaction.user.displayName, inline: true },
        { name: '🤖 AI', value: description ? '✅ Descrição gerada' : '⚠️ Sem descrição', inline: true },
      )
      .setFooter({ text: `PayPal Mafia Bot • Linear` })
      .setTimestamp();

    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (error) {
    ctx.logger.error('Linear create issue error:', error);
    await interaction.editReply('Erro ao criar issue no Linear.');
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
    } catch (error) {
      ctx.logger.error('Linear webhook error:', error);
    }
  });
}
