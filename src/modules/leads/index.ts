import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { BotModule, ModuleContext, CronJob } from '../../types';
import type { Lead, LeadSearchConfig } from './types';
import { searchPlaces } from './places-api';
import { scoreLead } from './scorer';
import { enrichLead } from './ai-enrichment';

let ctx: ModuleContext;

const LEADS_CHANNEL_NAME = 'leads';

async function findLeadsChannel(): Promise<TextChannel | null> {
  const guild = ctx.client.guilds.cache.first();
  if (!guild) return null;
  const channel = guild.channels.cache.find(
    (c) => c.name === LEADS_CHANNEL_NAME && c.isTextBased()
  ) as TextChannel | undefined;
  return channel ?? null;
}

export interface LeadEmbedData {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string }[];
  footer: string;
}

export function buildLeadEmbedData(lead: Lead): LeadEmbedData {
  const color = lead.score >= 10 ? 0xff6b6b : lead.score >= 7 ? 0xf2c94c : 0x5865f2;

  const lines: string[] = [];
  if (lead.address) lines.push(`📍 ${lead.address}`);
  if (lead.rating !== null) lines.push(`⭐ ${lead.rating} (${lead.review_count} avaliações)`);
  if (lead.website) lines.push(`🌐 ${lead.website}`);
  else lines.push('🌐 Sem website');
  if (lead.phone) lines.push(`📞 ${lead.phone}`);
  lines.push(`\n🎯 Score: **${lead.score}** | Serviço: **${lead.recommended_service}**`);

  const fields: { name: string; value: string }[] = [];
  if (lead.ai_analysis) fields.push({ name: '💡 Análise', value: lead.ai_analysis });
  if (lead.ai_pitch) fields.push({ name: '📝 Pitch', value: lead.ai_pitch });

  return {
    title: lead.name,
    description: lines.join('\n'),
    color,
    fields,
    footer: `ID: ${lead.id} | /leads status ${lead.id} contacted|dismissed`,
  };
}

function buildLeadEmbed(lead: Lead): EmbedBuilder {
  const data = buildLeadEmbedData(lead);
  const embed = new EmbedBuilder()
    .setTitle(data.title)
    .setColor(data.color)
    .setDescription(data.description)
    .setTimestamp(new Date(lead.found_at))
    .setFooter({ text: data.footer });

  for (const field of data.fields) {
    embed.addFields(field);
  }

  return embed;
}

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

  const leadsChannel = await findLeadsChannel();
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

    for (const place of places) {
      const existing = ctx.db
        .prepare('SELECT id FROM leads WHERE place_id = ?')
        .get(place.place_id);
      if (existing) continue;

      const score = scoreLead(place);

      const result = ctx.db.prepare(`
        INSERT INTO leads (place_id, name, address, phone, website, rating, review_count, category, region, score, recommended_service)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        place.place_id, place.name, place.address, place.phone, place.website,
        place.rating, place.review_count, place.category, cfg.region,
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

      if (score.total >= cfg.min_score && leadsChannel) {
        const lead = ctx.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead;
        const embed = buildLeadEmbed(lead);
        await leadsChannel.send({ embeds: [embed] });
        totalNew++;
      }

      await new Promise((r) => setTimeout(r, 200));
    }
  }

  ctx.logger.info(`Prospecting complete: ${totalNew} new leads above threshold`);
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
  ],

  async onLoad(context: ModuleContext): Promise<void> {
    ctx = context;
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
    } else if (group === 'config') {
      if (sub === 'add') await handleConfigAdd(interaction);
      else if (sub === 'list') await handleConfigList(interaction);
      else if (sub === 'remove') await handleConfigRemove(interaction);
    } else if (sub === 'stats') {
      await handleStats(interaction);
    } else if (sub === 'status') {
      await handleStatusUpdate(interaction);
    }
  },
};

async function handleSearch(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true);
  const region = interaction.options.getString('region', true);

  if (!process.env['GOOGLE_PLACES_API_KEY']) {
    await interaction.reply({ content: 'GOOGLE_PLACES_API_KEY não configurada.', ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const places = await searchPlaces(process.env['GOOGLE_PLACES_API_KEY'], query, region);

  if (places.length === 0) {
    await interaction.editReply('Nenhum resultado encontrado.');
    return;
  }

  const genAI = process.env['GEMINI_API_KEY']
    ? new GoogleGenerativeAI(process.env['GEMINI_API_KEY']!)
    : null;

  const results: Lead[] = [];

  for (const place of places) {
    const existing = ctx.db
      .prepare('SELECT id FROM leads WHERE place_id = ?')
      .get(place.place_id);
    if (existing) continue;

    const score = scoreLead(place);

    const result = ctx.db.prepare(`
      INSERT INTO leads (place_id, name, address, phone, website, rating, review_count, category, region, score, recommended_service)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      place.place_id, place.name, place.address, place.phone, place.website,
      place.rating, place.review_count, place.category, region,
      score.total, score.recommended_service,
    );

    const leadId = result.lastInsertRowid as number;

    if (score.total >= 5 && genAI) {
      const enrichment = await enrichLead(genAI, place, score);
      if (enrichment) {
        ctx.db.prepare('UPDATE leads SET ai_analysis = ?, ai_pitch = ? WHERE id = ?')
          .run(enrichment.analysis, enrichment.pitch, leadId);
      }
    }

    results.push(
      ctx.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as Lead
    );

    await new Promise((r) => setTimeout(r, 200));
  }

  const embed = new EmbedBuilder()
    .setTitle(`Busca: "${query}" em ${region}`)
    .setColor(0x5865f2)
    .setDescription(
      results.length === 0
        ? 'Todos os resultados já estavam no banco.'
        : results
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map((l) => `**${l.name}** — Score: ${l.score} | ${l.recommended_service}`)
            .join('\n')
    )
    .setFooter({ text: `${results.length} novos leads encontrados` });

  await interaction.editReply({ embeds: [embed] });

  const leadsChannel = await findLeadsChannel();
  if (leadsChannel) {
    for (const lead of results.filter((l) => l.score >= 5)) {
      await leadsChannel.send({ embeds: [buildLeadEmbed(lead)] });
    }
  }
}

async function handleConfigAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const query = interaction.options.getString('query', true);
  const region = interaction.options.getString('region', true);
  const minScore = interaction.options.getInteger('min_score') ?? 5;

  const result = ctx.db.prepare(
    'INSERT INTO leads_search_configs (query, region, min_score) VALUES (?, ?, ?)'
  ).run(query, region, minScore);

  await interaction.reply(
    `✅ Config #${result.lastInsertRowid} criada: "${query}" em ${region} (min score: ${minScore})`
  );
}

async function handleConfigList(interaction: ChatInputCommandInteraction): Promise<void> {
  const configs = ctx.db
    .prepare('SELECT * FROM leads_search_configs ORDER BY id')
    .all() as LeadSearchConfig[];

  if (configs.length === 0) {
    await interaction.reply({ content: 'Nenhuma config cadastrada. Use `/leads config add`.', ephemeral: true });
    return;
  }

  const lines = configs.map((c) =>
    `**#${c.id}** — "${c.query}" em ${c.region} | Min score: ${c.min_score} | ${c.active ? '🟢 Ativa' : '🔴 Inativa'}`
  );

  const embed = new EmbedBuilder()
    .setTitle('Search Configs')
    .setDescription(lines.join('\n'))
    .setColor(0x5865f2);

  await interaction.reply({ embeds: [embed] });
}

async function handleConfigRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger('id', true);
  const result = ctx.db.prepare('DELETE FROM leads_search_configs WHERE id = ?').run(id);

  if (result.changes === 0) {
    await interaction.reply({ content: `Config #${id} não encontrada.`, ephemeral: true });
    return;
  }

  await interaction.reply(`🗑️ Config #${id} removida.`);
}

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const total = (ctx.db.prepare('SELECT COUNT(*) as c FROM leads').get() as any).c;
  const byStatus = ctx.db
    .prepare('SELECT status, COUNT(*) as c FROM leads GROUP BY status')
    .all() as { status: string; c: number }[];
  const avgScore = (ctx.db.prepare('SELECT AVG(score) as avg FROM leads').get() as any).avg;
  const topService = ctx.db
    .prepare('SELECT recommended_service, COUNT(*) as c FROM leads GROUP BY recommended_service ORDER BY c DESC LIMIT 1')
    .get() as { recommended_service: string; c: number } | undefined;

  const statusLines = byStatus.map((s) => `${s.status}: ${s.c}`).join(' | ');

  const embed = new EmbedBuilder()
    .setTitle('📊 Lead Stats')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Total', value: `${total}`, inline: true },
      { name: 'Score médio', value: `${(avgScore ?? 0).toFixed(1)}`, inline: true },
      { name: 'Top serviço', value: topService?.recommended_service ?? 'N/A', inline: true },
    )
    .setDescription(statusLines || 'Sem leads ainda.');

  await interaction.reply({ embeds: [embed] });
}

async function handleStatusUpdate(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger('id', true);
  const newStatus = interaction.options.getString('new_status', true);

  const lead = ctx.db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Lead | undefined;
  if (!lead) {
    await interaction.reply({ content: `Lead #${id} não encontrado.`, ephemeral: true });
    return;
  }

  const contactedAt = newStatus === 'contacted' ? new Date().toISOString() : lead.contacted_at;
  ctx.db.prepare('UPDATE leads SET status = ?, contacted_at = ? WHERE id = ?')
    .run(newStatus, contactedAt, id);

  await interaction.reply(`Lead **#${id}** (${lead.name}) → status: **${newStatus}**`);
}
