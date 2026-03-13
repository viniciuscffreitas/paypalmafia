import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { Router, type Request, type Response } from 'express';
import { LinearClient } from '@linear/sdk';
import type { BotModule, ModuleContext } from '../../types';

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
  const description = interaction.options.getString('description');

  try {
    const teams = await linearClient.teams({ filter: { key: { eq: project.linear_team_id } } });
    const team = teams.nodes[0];
    if (!team) {
      await interaction.editReply(`Linear team **${project.linear_team_id}** não encontrado.`);
      return;
    }

    const issue = await linearClient.createIssue({
      teamId: team.id,
      title,
      description: description || undefined,
    });

    const created = await issue.issue;
    if (!created) {
      await interaction.editReply('Erro ao criar issue.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Issue criada: ${title}`)
      .setURL(created.url)
      .setColor(0x5e6ad2)
      .addFields(
        { name: 'ID', value: created.identifier, inline: true },
        { name: 'Team', value: project.linear_team_id, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setTitle(`Issues abertas — ${project.linear_team_id}`)
      .setColor(0x5e6ad2)
      .setDescription(
        issues.nodes
          .map((i: any) => `**${i.identifier}** — [${i.title}](${i.url})`)
          .join('\n')
      )
      .setFooter({ text: `${issues.nodes.length} issues` })
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

      const colorMap: Record<string, number> = {
        create: 0x5e6ad2,
        update: 0xf2c94c,
        remove: 0xd73a49,
      };

      const embed = new EmbedBuilder()
        .setTitle(`Linear: ${data.title || 'Issue'}`)
        .setURL(data.url || '')
        .setColor(colorMap[action] || 0x5e6ad2)
        .addFields(
          { name: 'Action', value: action, inline: true },
          { name: 'Status', value: data.state?.name || 'Unknown', inline: true }
        )
        .setTimestamp();

      if (data.assignee) {
        embed.addFields({ name: 'Assignee', value: data.assignee.name, inline: true });
      }

      await devChannel.send({ embeds: [embed] });
    } catch (error) {
      ctx.logger.error('Linear webhook error:', error);
    }
  });
}
