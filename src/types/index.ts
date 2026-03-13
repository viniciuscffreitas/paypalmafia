import {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { Logger } from '../core/logger';

export interface ModuleContext {
  client: Client;
  db: Database.Database;
  logger: Logger;
  getModule(name: string): BotModule | undefined;
}

export interface CronJob {
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void>;
}

export interface BotModule {
  name: string;
  description: string;
  commands: (SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder)[];
  webhookRoutes?: Router;
  cronJobs?: CronJob[];

  onLoad(context: ModuleContext): Promise<void>;
  onUnload(): Promise<void>;
  handleCommand(interaction: ChatInputCommandInteraction): Promise<void>;
}
