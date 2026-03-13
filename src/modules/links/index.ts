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

export const linksModule: BotModule = {
  name: 'links',
  description: 'Quick links knowledge base per project',
  commands: [
    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Manage project links')
      .addSubcommand((sub) =>
        sub
          .setName('save')
          .setDescription('Save a link')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Link name').setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName('url').setDescription('URL').setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName('description').setDescription('Description')
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('get')
          .setDescription('Get a saved link')
          .addStringOption((opt) =>
            opt.setName('name').setDescription('Link name').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List all project links')
      ) as any,
  ],

  async onLoad(context) {
    ctx = context;
    ctx.logger.info('Links module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'save') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
        return;
      }

      const name = interaction.options.getString('name', true);
      const url = interaction.options.getString('url', true);
      const description = interaction.options.getString('description');

      try {
        ctx.db
          .prepare(
            'INSERT OR REPLACE INTO links (project_id, name, url, description, saved_by) VALUES (?, ?, ?, ?, ?)'
          )
          .run(project.id, name, url, description, interaction.user.tag);

        await interaction.reply(`Link **${name}** salvo: ${url}`);
      } catch (error) {
        await interaction.reply({ content: 'Erro ao salvar link.', ephemeral: true });
      }
    } else if (sub === 'get') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
        return;
      }

      const name = interaction.options.getString('name', true);
      const link = ctx.db
        .prepare('SELECT * FROM links WHERE project_id = ? AND name = ?')
        .get(project.id, name) as any;

      if (!link) {
        await interaction.reply({ content: `Link **${name}** não encontrado.`, ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(link.name)
        .setURL(link.url)
        .setColor(0x5865f2)
        .setFooter({ text: `Salvo por ${link.saved_by}` });

      if (link.description) embed.setDescription(link.description);

      await interaction.reply({ embeds: [embed] });
    } else if (sub === 'list') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use este comando em um canal de projeto.', ephemeral: true });
        return;
      }

      const links = ctx.db
        .prepare('SELECT * FROM links WHERE project_id = ? ORDER BY name')
        .all(project.id) as any[];

      if (links.length === 0) {
        await interaction.reply('Nenhum link salvo neste projeto.');
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Links — ${project.name}`)
        .setColor(0x5865f2)
        .setDescription(
          links.map((l) => `**${l.name}**: ${l.url}${l.description ? ` — ${l.description}` : ''}`).join('\n')
        );

      await interaction.reply({ embeds: [embed] });
    }
  },
};
