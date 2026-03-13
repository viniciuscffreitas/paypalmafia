import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import type { BotModule, ModuleContext, CronJob } from '../../types';

let ctx: ModuleContext;

export const focusModule: BotModule = {
  name: 'focus',
  description: 'Focus mode — do not disturb timer with announcements',
  commands: [
    new SlashCommandBuilder()
      .setName('focus')
      .setDescription('Focus mode')
      .addSubcommand((sub) =>
        sub
          .setName('start')
          .setDescription('Start a focus session')
          .addIntegerOption((opt) =>
            opt
              .setName('minutes')
              .setDescription('Duration in minutes (default 25)')
              .setMinValue(1)
              .setMaxValue(480)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('stop').setDescription('End focus session early')
      )
      .addSubcommand((sub) =>
        sub.setName('status').setDescription('Show who is currently in focus mode')
      ) as any,
  ],

  cronJobs: [
    {
      name: 'focus-check',
      schedule: '* * * * *',
      handler: async () => {
        await checkExpiredSessions();
      },
    },
  ],

  async onLoad(context) {
    ctx = context;

    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        channel_id TEXT,
        minutes INTEGER NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ends_at DATETIME NOT NULL,
        ended_early INTEGER DEFAULT 0
      )
    `);

    ctx.logger.info('Focus module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      await handleStart(interaction);
    } else if (sub === 'stop') {
      await handleStop(interaction);
    } else if (sub === 'status') {
      await handleStatus(interaction);
    }
  },
};

async function handleStart(interaction: ChatInputCommandInteraction) {
  const minutes = interaction.options.getInteger('minutes') || 25;

  // Check if user already has an active session
  const existing = ctx.db
    .prepare(
      "SELECT * FROM focus_sessions WHERE user_id = ? AND ends_at > datetime('now') AND ended_early = 0"
    )
    .get(interaction.user.id) as any;

  if (existing) {
    const endsAt = new Date(existing.ends_at + 'Z');
    await interaction.reply({
      content: `Voc\u00ea j\u00e1 est\u00e1 em focus mode! Termina <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`,
      ephemeral: true,
    });
    return;
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + minutes * 60 * 1000);
  const endsAtISO = endsAt.toISOString().replace('T', ' ').replace('Z', '');

  ctx.db
    .prepare(
      'INSERT INTO focus_sessions (user_id, channel_id, minutes, ends_at) VALUES (?, ?, ?, ?)'
    )
    .run(interaction.user.id, interaction.channelId, minutes, endsAtISO);

  const endsAtTimestamp = Math.floor(endsAt.getTime() / 1000);

  const embed = new EmbedBuilder()
    .setTitle(`\u{1f3af} Focus Mode`)
    .setColor(0xe74c3c)
    .setDescription(
      `**${interaction.user.displayName}** entrou em focus mode.`
    )
    .addFields(
      { name: 'Dura\u00e7\u00e3o', value: `${minutes} minutos`, inline: true },
      { name: 'Termina', value: `<t:${endsAtTimestamp}:t> (<t:${endsAtTimestamp}:R>)`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleStop(interaction: ChatInputCommandInteraction) {
  const session = ctx.db
    .prepare(
      "SELECT * FROM focus_sessions WHERE user_id = ? AND ends_at > datetime('now') AND ended_early = 0"
    )
    .get(interaction.user.id) as any;

  if (!session) {
    await interaction.reply({
      content: 'Voc\u00ea n\u00e3o est\u00e1 em focus mode.',
      ephemeral: true,
    });
    return;
  }

  ctx.db
    .prepare('UPDATE focus_sessions SET ended_early = 1 WHERE id = ?')
    .run(session.id);

  const embed = new EmbedBuilder()
    .setTitle(`\u2705 Focus Mode Encerrado`)
    .setColor(0x2ecc71)
    .setDescription(
      `**${interaction.user.displayName}** saiu do focus mode.`
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function handleStatus(interaction: ChatInputCommandInteraction) {
  const sessions = ctx.db
    .prepare(
      "SELECT * FROM focus_sessions WHERE ends_at > datetime('now') AND ended_early = 0 ORDER BY ends_at ASC"
    )
    .all() as any[];

  if (sessions.length === 0) {
    await interaction.reply('Ningu\u00e9m est\u00e1 em focus mode agora.');
    return;
  }

  const lines: string[] = [];
  for (const s of sessions) {
    const endsAt = new Date(s.ends_at + 'Z');
    const endsAtTimestamp = Math.floor(endsAt.getTime() / 1000);
    lines.push(`<@${s.user_id}> \u2014 ${s.minutes}min \u2014 termina <t:${endsAtTimestamp}:R>`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`\u{1f3af} Focus Mode \u2014 Ativos`)
    .setColor(0xe74c3c)
    .setDescription(lines.join('\n'))
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function checkExpiredSessions() {
  const expired = ctx.db
    .prepare(
      "SELECT * FROM focus_sessions WHERE ends_at <= datetime('now') AND ended_early = 0"
    )
    .all() as any[];

  if (expired.length === 0) return;

  // Mark them all as ended
  ctx.db
    .prepare(
      "UPDATE focus_sessions SET ended_early = 0 WHERE ends_at <= datetime('now') AND ended_early = 0"
    )
    .run();

  // We need to distinguish truly expired from already announced.
  // Use a simple approach: delete or mark. We'll set ended_early = 2 to mean "expired and announced".
  for (const session of expired) {
    ctx.db
      .prepare('UPDATE focus_sessions SET ended_early = 2 WHERE id = ?')
      .run(session.id);

    if (!session.channel_id) continue;

    try {
      const channel = await ctx.client.channels.fetch(session.channel_id) as TextChannel;
      if (!channel) continue;

      const embed = new EmbedBuilder()
        .setTitle(`\u2705 Focus Mode Encerrado`)
        .setColor(0x2ecc71)
        .setDescription(`<@${session.user_id}> saiu do focus mode`)
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      ctx.logger.error(`Failed to announce focus end for user ${session.user_id}: ${error}`);
    }
  }
}
