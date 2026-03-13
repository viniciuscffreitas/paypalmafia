import { Client } from 'discord.js';
import type Database from 'better-sqlite3';
import type { BotModule, ModuleContext } from '../types';
import { createLogger, type Logger } from './logger';

export class ModuleLoader {
  private modules = new Map<string, BotModule>();
  private logger: Logger;

  constructor(
    private client: Client,
    private db: Database.Database,
  ) {
    this.logger = createLogger('module-loader');
  }

  async register(module: BotModule): Promise<void> {
    const context: ModuleContext = {
      client: this.client,
      db: this.db,
      logger: createLogger(module.name),
      getModule: (name: string) => this.modules.get(name),
    };

    await module.onLoad(context);
    this.modules.set(module.name, module);
    this.logger.info(`Module loaded: ${module.name}`);
  }

  getModule(name: string): BotModule | undefined {
    return this.modules.get(name);
  }

  getAllModules(): BotModule[] {
    return Array.from(this.modules.values());
  }

  async unloadAll(): Promise<void> {
    for (const [name, module] of this.modules) {
      await module.onUnload();
      this.logger.info(`Module unloaded: ${name}`);
    }
    this.modules.clear();
  }
}
