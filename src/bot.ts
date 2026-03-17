import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import cron from 'node-cron';
import { config } from './config';
import { initDatabase } from './db';
import { ModuleLoader } from './core/module-loader';
import { registerCommands } from './core/command-registry';
import { createWebhookServer } from './server';
import { createLogger } from './core/logger';
import { initAI } from './core/ai';
import { projectsModule } from './modules/projects';
import { linksModule } from './modules/links';
import { githubModule } from './modules/github';
import { linearModule } from './modules/linear';
import { standupModule } from './modules/standup';
import { pulseModule } from './modules/pulse';
import { ideasModule } from './modules/ideas';
import { pollsModule } from './modules/polls';
import { decisionsModule } from './modules/decisions';
import { focusModule } from './modules/focus';
import { autoBookmarkModule } from './modules/auto-bookmark';
import { deployModule } from './modules/deploy';
import { leadsModule } from './modules/leads';

const logger = createLogger('bot');

async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
    partials: [
      Partials.Message,
      Partials.Reaction,
      Partials.User,
    ],
  });

  const db = initDatabase(config.database.path);
  initAI();
  const loader = new ModuleLoader(client, db);

  const modules = [
    projectsModule,
    linksModule,
    githubModule,
    linearModule,
    standupModule,
    pulseModule,
    ideasModule,
    pollsModule,
    decisionsModule,
    focusModule,
    autoBookmarkModule,
    deployModule,
    leadsModule,
  ];

  for (const mod of modules) {
    await loader.register(mod);
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    for (const mod of loader.getAllModules()) {
      const hasCommand = mod.commands.some(
        (c) => c.name === interaction.commandName
      );
      if (hasCommand) {
        try {
          await mod.handleCommand(interaction);
        } catch (error) {
          logger.error(`Command error in ${mod.name}:`, error);
          const reply = {
            content: 'Erro ao executar comando.',
            ephemeral: true,
          };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply);
          } else {
            await interaction.reply(reply);
          }
        }
        return;
      }
    }
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Bot online como ${readyClient.user.tag}`);

    try {
      await registerCommands(
        modules,
        config.discord.token,
        config.discord.clientId,
        config.discord.guildId,
      );
    } catch (err) {
      logger.error('Failed to register commands (bot may not be in the server yet):', err);
    }

    createWebhookServer(modules, config.webhook.port);

    // Register cron jobs
    for (const mod of loader.getAllModules()) {
      if (mod.cronJobs) {
        for (const job of mod.cronJobs) {
          cron.schedule(job.schedule, () => {
            job.handler().catch((err) =>
              logger.error(`Cron job ${job.name} failed:`, err)
            );
          });
          logger.info(`Cron job registered: ${job.name} (${job.schedule})`);
        }
      }
    }
  });

  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await loader.unloadAll();
    db.close();
    client.destroy();
    process.exit(0);
  });

  await client.login(config.discord.token);
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
