import { REST, Routes } from 'discord.js';
import type { BotModule } from '../types';
import { createLogger } from './logger';

const logger = createLogger('command-registry');

export async function registerCommands(
  modules: BotModule[],
  token: string,
  clientId: string,
  guildId: string,
): Promise<void> {
  const commands = modules.flatMap((m) =>
    m.commands.map((c) => c.toJSON())
  );

  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: commands,
    });
    logger.info(`Registered ${commands.length} guild commands`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), {
      body: commands,
    });
    logger.info(`Registered ${commands.length} global commands`);
  }
}
