import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BotModule, ModuleContext } from '../../types';
import type { Lead, LeadSearchConfig } from './types';
import { searchPlaces } from './places-api';
import { scoreLead, scoreLeadFromDb } from './scorer';
import { enrichLead } from './ai-enrichment';
import { logApiUsage } from './cost-tracker';
import {
  setHandlerContext,
  buildLeadEmbed,
  handleSearch,
  handleNearby,
  handleConfigAdd,
  handleConfigList,
  handleConfigRemove,
  handleCost,
  handleStats,
  handleStatusUpdate,
} from './handlers';

export { buildLeadEmbedData, type LeadEmbedData } from './handlers';

let ctx: ModuleContext;

async function runProspecting(): Promise<void> {
  const configs = ctx.db
    .prepare('SELECT * FROM leads_search_configs WHERE active = 1')
    .all() as LeadSearchConfig[];

  if (configs.length === 0) {
    ctx.logger.info('No active search configs — skipping prospecting');
    return;
  }

  if (!process.env['GOOGLE_PLACES_API_KEY']) {
    ctx.logger.warn('GOOGLE_PLACES_API_KEY not set — skipping prospecting');
    return;
  }

  const genAI = process.env['GEMINI_API_KEY']
    ? new GoogleGenerativeAI(process.env['GEMINI_API_KEY']!)
    : null;

  let totalNew = 0;

  for (const cfg of configs) {
    ctx.logger.info(`Prospecting: "${cfg.query}" in "${cfg.region}"`);

    const places = await searchPlaces(
      process.env['GOOGLE_PLACES_API_KEY'],
      cfg.query,
      cfg.region,
    );

    logApiUsage(ctx.db, 'textSearch', places.length, Math.ceil(places.length / 20));

    for (const place of places) {
      const existing = ctx.db
        .prepare('SELECT id FROM leads WHERE place_id = ?')
        .get(place.place_id);
      if (existing) continue;

      const score = scoreLead(place);

      const result = ctx.db.prepare(`
        INSERT INTO leads (place_id, name, address, phone, website, google_maps_url, photo_url, rating, review_count, category, region, score, recommended_service)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        place.place_id, place.name, place.address, place.phone, place.website,
        place.google_maps_url, place.photo_url, place.rating, place.review_count, place.category, cfg.region,
        score.total, score.recommended_service,
      );

      const leadId = result.lastInsertRowid as number;

      if (score.total >= cfg.min_score && genAI) {
        const enrichment = await enrichLead(genAI, place, score);
        if (enrichment) {
          ctx.db.prepare('UPDATE leads SET ai_analysis = ?, ai_pitch = ? WHERE id = ?')
            .run(enrichment.analysis, enrichment.pitch, leadId);
        }
      }

      if (score.total >= cfg.min_score) {
        const lead = ctx.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead;
        const { findLeadsChannel } = await import('./handlers');
        const leadsChannel = await findLeadsChannel();
        if (leadsChannel) {
          const embed = buildLeadEmbed(lead);
          await leadsChannel.send({ embeds: [embed] });
          totalNew++;
        }
      }

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  ctx.logger.info(`Prospecting complete: ${totalNew} new leads above threshold`);
}

async function runRescoring(): Promise<void> {
  const leads = ctx.db
    .prepare("SELECT * FROM leads WHERE status = 'new'")
    .all() as Lead[];

  if (leads.length === 0) {
    ctx.logger.info('No leads to re-score');
    return;
  }

  let updated = 0;

  for (const lead of leads) {
    const newScore = scoreLeadFromDb(lead);

    if (newScore.total !== lead.score || newScore.recommended_service !== lead.recommended_service) {
      ctx.db.prepare(
        'UPDATE leads SET score = ?, recommended_service = ? WHERE id = ?'
      ).run(newScore.total, newScore.recommended_service, lead.id);
      updated++;
      ctx.logger.info(`Re-scored lead #${lead.id} (${lead.name}): ${lead.score} → ${newScore.total}`);
    }
  }

  ctx.logger.info(`Re-scoring complete: ${updated}/${leads.length} leads updated`);
}

const leadsCommand = new SlashCommandBuilder()
  .setName('leads')
  .setDescription('Lead prospecting management')
  .addSubcommand((sub) =>
    sub
      .setName('search')
      .setDescription('Run a one-off search')
      .addStringOption((opt) =>
        opt.setName('query').setDescription('Category to search (e.g. "clínicas")').setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName('region').setDescription('Region (e.g. "São Paulo, SP")').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('nearby')
      .setDescription('Search by coordinates + radius')
      .addNumberOption((opt) =>
        opt.setName('lat').setDescription('Latitude (e.g. -23.5505)').setRequired(true)
      )
      .addNumberOption((opt) =>
        opt.setName('lng').setDescription('Longitude (e.g. -46.6333)').setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName('radius').setDescription('Radius in km (default: 5)')
      )
      .addStringOption((opt) =>
        opt.setName('types').setDescription('Place types comma-separated (e.g. restaurant,dentist)')
      )
  )
  .addSubcommandGroup((group) =>
    group
      .setName('config')
      .setDescription('Manage recurring search configs')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a recurring search')
          .addStringOption((opt) =>
            opt.setName('query').setDescription('Category').setRequired(true)
          )
          .addStringOption((opt) =>
            opt.setName('region').setDescription('Region').setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt.setName('min_score').setDescription('Minimum score to notify (default: 5)')
          )
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('List active search configs')
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a search config')
          .addIntegerOption((opt) =>
            opt.setName('id').setDescription('Config ID').setRequired(true)
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('stats').setDescription('Show lead statistics')
  )
  .addSubcommand((sub) =>
    sub.setName('cost').setDescription('Show estimated API cost')
      .addIntegerOption((opt) =>
        opt.setName('days').setDescription('Number of days to show (default: 30)')
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('status')
      .setDescription('Update a lead status')
      .addIntegerOption((opt) =>
        opt.setName('id').setDescription('Lead ID').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('new_status')
          .setDescription('New status')
          .setRequired(true)
          .addChoices(
            { name: 'Contacted', value: 'contacted' },
            { name: 'Dismissed', value: 'dismissed' },
            { name: 'New', value: 'new' },
          )
      )
  );

export const leadsModule: BotModule = {
  name: 'leads',
  description: 'Automated lead prospecting via Google Places API',
  commands: [leadsCommand],

  cronJobs: [
    {
      name: 'daily-prospecting',
      schedule: '0 11 * * *',
      handler: runProspecting,
    },
    {
      name: 'weekly-rescore',
      schedule: '0 14 * * 1', // Monday 11am BRT = 14 UTC
      handler: runRescoring,
    },
  ],

  async onLoad(context: ModuleContext): Promise<void> {
    ctx = context;
    setHandlerContext(context);
    ctx.logger.info('Leads module loaded');
  },

  async onUnload(): Promise<void> {
    ctx.logger.info('Leads module unloaded');
  },

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup();

    if (sub === 'search') {
      await handleSearch(interaction);
    } else if (sub === 'nearby') {
      await handleNearby(interaction);
    } else if (group === 'config') {
      if (sub === 'add') await handleConfigAdd(interaction);
      else if (sub === 'list') await handleConfigList(interaction);
      else if (sub === 'remove') await handleConfigRemove(interaction);
    } else if (sub === 'stats') {
      await handleStats(interaction);
    } else if (sub === 'cost') {
      await handleCost(interaction);
    } else if (sub === 'status') {
      await handleStatusUpdate(interaction);
    }
  },
};
