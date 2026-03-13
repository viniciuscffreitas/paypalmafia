import { Client, GatewayIntentBits, ChannelType, EmbedBuilder } from 'discord.js';
import { config } from './config';
import { initDatabase } from './db';

async function setupServer() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await client.login(config.discord.token);

  await new Promise<void>((resolve) => {
    client.once('ready', () => resolve());
  });

  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) {
    console.error('Guild not found!');
    process.exit(1);
  }

  console.log(`Connected to: ${guild.name}`);

  const db = initDatabase(config.database.path);

  // Delete default channels (except rules/community if any)
  const existingChannels = guild.channels.cache;
  for (const [, channel] of existingChannels) {
    try {
      await channel.delete();
      console.log(`Deleted channel: ${channel.name}`);
    } catch {
      console.log(`Could not delete: ${channel.name}`);
    }
  }

  // ── 1. HQ Category (server-wide) ──────────────────────────
  const hqCategory = await guild.channels.create({
    name: '🏢 HQ',
    type: ChannelType.GuildCategory,
  });

  const welcomeChannel = await guild.channels.create({
    name: 'welcome',
    type: ChannelType.GuildText,
    parent: hqCategory.id,
    topic: 'Bem-vindos ao PayPal Mafia HQ',
  });

  await guild.channels.create({
    name: 'announcements',
    type: ChannelType.GuildText,
    parent: hqCategory.id,
    topic: 'Anúncios importantes',
  });

  await guild.channels.create({
    name: 'random',
    type: ChannelType.GuildText,
    parent: hqCategory.id,
    topic: 'Off-topic, memes, whatever',
  });

  await guild.channels.create({
    name: 'resources',
    type: ChannelType.GuildText,
    parent: hqCategory.id,
    topic: 'Links, artigos, ferramentas úteis',
  });

  // ── 2. Bot & Ops Category ──────────────────────────────────
  const opsCategory = await guild.channels.create({
    name: '⚙️ Ops',
    type: ChannelType.GuildCategory,
  });

  await guild.channels.create({
    name: 'bot-logs',
    type: ChannelType.GuildText,
    parent: opsCategory.id,
    topic: 'Logs do bot e alertas do sistema',
  });

  await guild.channels.create({
    name: 'github-feed',
    type: ChannelType.GuildText,
    parent: opsCategory.id,
    topic: 'Feed global de atividade GitHub',
  });

  await guild.channels.create({
    name: 'linear-feed',
    type: ChannelType.GuildText,
    parent: opsCategory.id,
    topic: 'Feed global de atividade Linear',
  });

  // ── 3. Voice Channels ─────────────────────────────────────
  const voiceCategory = await guild.channels.create({
    name: '🎙️ Voice',
    type: ChannelType.GuildCategory,
  });

  await guild.channels.create({
    name: 'War Room',
    type: ChannelType.GuildVoice,
    parent: voiceCategory.id,
  });

  await guild.channels.create({
    name: 'Focus Mode',
    type: ChannelType.GuildVoice,
    parent: voiceCategory.id,
  });

  // ── 4. First project placeholder (will be created via /project) ──
  // We DON'T create a project category here — users will use /project create

  // ── 5. Welcome message ─────────────────────────────────────
  const embed = new EmbedBuilder()
    .setTitle('PayPal Mafia HQ')
    .setDescription(
      '**Servidor operacional.** O bot está online e pronto.\n\n' +
      '## Comandos disponíveis\n' +
      '`/project create <nome>` — Criar novo projeto (gera canais automáticos)\n' +
      '`/project list` — Listar projetos ativos\n' +
      '`/project archive <nome>` — Arquivar projeto\n' +
      '`/task <título>` — Criar issue no Linear\n' +
      '`/github link <owner/repo>` — Linkar repo GitHub\n' +
      '`/linear link <team>` — Linkar team Linear\n' +
      '`/linear sync` — Ver issues abertas\n' +
      '`/standup post` — Postar standup manual\n' +
      '`/standup history` — Ver histórico de standups\n' +
      '`/pulse` — Dashboard de métricas do projeto\n' +
      '`/link save <nome> <url>` — Salvar link útil\n' +
      '`/link get <nome>` — Buscar link salvo\n' +
      '`/link list` — Listar links do projeto\n\n' +
      '## Como começar\n' +
      '1. Use `/project create` para criar seu primeiro projeto\n' +
      '2. Linke com GitHub e Linear nos canais do projeto\n' +
      '3. O bot cuida do resto — standups, métricas, notificações'
    )
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: 'PayPal Mafia Bot v0.1.0' });

  await welcomeChannel.send({ embeds: [embed] });

  console.log('\n✅ Server setup complete!');
  console.log('Categories: HQ, Ops, Voice');
  console.log('Welcome message posted.');

  db.close();
  client.destroy();
  process.exit(0);
}

setupServer().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
