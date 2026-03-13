import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import type { BotModule, ModuleContext } from '../../types';

let ctx: ModuleContext;

export const projectsModule: BotModule = {
  name: 'projects',
  description: 'Project management with auto channel creation',
  commands: [
    new SlashCommandBuilder()
      .setName('project')
      .setDescription('Manage projects')
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Create a new project')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Project name').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List active projects')
      )
      .addSubcommand((sub) =>
        sub
          .setName('archive')
          .setDescription('Archive a project')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Project name').setRequired(true)
          )
      ) as any,
  ],

  async onLoad(context) {
    ctx = context;
    ctx.logger.info('Projects module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      await handleCreate(interaction);
    } else if (sub === 'list') {
      await handleList(interaction);
    } else if (sub === 'archive') {
      await handleArchive(interaction);
    }
  },
};

async function handleCreate(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString('name', true);
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply();

  const existing = ctx.db
    .prepare('SELECT id FROM projects WHERE name = ? AND archived_at IS NULL')
    .get(name);

  if (existing) {
    await interaction.editReply(`Projeto **${name}** já existe.`);
    return;
  }

  const category = await guild.channels.create({
    name: name,
    type: ChannelType.GuildCategory,
  });

  const channels = ['general', 'dev', 'links', 'standup'];
  for (const ch of channels) {
    await guild.channels.create({
      name: `${name}-${ch}`,
      type: ChannelType.GuildText,
      parent: category.id,
    });
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  ctx.db
    .prepare(
      'INSERT INTO projects (id, name, discord_category_id) VALUES (?, ?, ?)'
    )
    .run(id, name, category.id);

  const embed = new EmbedBuilder()
    .setTitle(`Projeto criado: ${name}`)
    .setDescription(`Categoria e canais criados automaticamente.`)
    .setColor(0x00ff88)
    .addFields(
      { name: 'ID', value: id, inline: true },
      { name: 'Canais', value: channels.map((c) => `#${name}-${c}`).join('\n'), inline: true }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleList(interaction: ChatInputCommandInteraction) {
  const projects = ctx.db
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC')
    .all() as any[];

  if (projects.length === 0) {
    await interaction.reply('Nenhum projeto ativo.');
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('Projetos Ativos')
    .setColor(0x5865f2)
    .setTimestamp();

  for (const p of projects) {
    const fields = [];
    if (p.github_repo) fields.push(`GitHub: ${p.github_repo}`);
    if (p.linear_team_id) fields.push(`Linear: ${p.linear_team_id}`);
    if (fields.length === 0) fields.push('Sem integrações');
    embed.addFields({ name: p.name, value: fields.join('\n'), inline: true });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleArchive(interaction: ChatInputCommandInteraction) {
  const name = interaction.options.getString('name', true);
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply();

  const project = ctx.db
    .prepare('SELECT * FROM projects WHERE name = ? AND archived_at IS NULL')
    .get(name) as any;

  if (!project) {
    await interaction.editReply(`Projeto **${name}** não encontrado.`);
    return;
  }

  ctx.db
    .prepare('UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(project.id);

  try {
    const category = await guild.channels.fetch(project.discord_category_id);
    if (category) {
      await category.setName(`[ARCHIVED] ${name}`);
    }
  } catch {
    // Category may have been deleted manually
  }

  await interaction.editReply(`Projeto **${name}** arquivado.`);
}
