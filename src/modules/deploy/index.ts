import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { BotModule, ModuleContext } from '../../types';
import { config } from '../../config';
import { extractLinearIds } from '../../utils/linear-ids';
import { fetchCompareDiffs } from '../../utils/github-api';
import { generateDeploySummary, analyzeDeployRisk } from '../../core/ai';

let ctx: ModuleContext;

const webhookRouter = Router();

function verifyDeploySecret(secret: string): boolean {
  const expected = config.deploy.webhookSecret;
  if (!expected) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(secret));
  } catch {
    return false;
  }
}

export const deployModule: BotModule = {
  name: 'deploy',
  description: 'Deploy tracking and notifications',

  commands: [
    new SlashCommandBuilder()
      .setName('deploy')
      .setDescription('Deploy management')
      .addSubcommand((sub) =>
        sub.setName('history').setDescription('Show recent deploys')
      ) as any,
  ],

  webhookRoutes: webhookRouter,

  async onLoad(context) {
    ctx = context;
    setupWebhookRoutes();
    ctx.logger.info('Deploy module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'history') {
      const deploys = ctx.db
        .prepare('SELECT * FROM deployments ORDER BY deployed_at DESC LIMIT 10')
        .all() as any[];

      if (deploys.length === 0) {
        await interaction.reply({ content: 'Nenhum deploy registrado.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Deploys Recentes')
        .setColor(0x2ea44f);

      for (const d of deploys) {
        const risk = d.risk_level === 'alto' ? '🔴' : d.risk_level === 'medio' ? '🟡' : '🟢';
        embed.addFields({
          name: `${risk} v${d.version || '?'} — ${new Date(d.deployed_at).toLocaleDateString('pt-BR')}`,
          value: d.ai_summary || `${d.commit_count} commits por ${d.author} (\`${d.sha?.slice(0, 7)}\`)`,
        });
      }

      await interaction.reply({ embeds: [embed] });
    }
  },
};

function setupWebhookRoutes() {
  webhookRouter.post('/', async (req: Request, res: Response) => {
    const secret = req.headers['x-deploy-secret'] as string;
    if (!secret || !verifyDeploySecret(secret)) {
      res.status(401).json({ error: 'Invalid secret' });
      return;
    }

    res.status(200).json({ ok: true });

    try {
      await handleDeployEvent(req.body);
    } catch (error) {
      ctx.logger.error('Deploy webhook error:', error);
    }
  });
}

async function handleDeployEvent(payload: any) {
  const { sha, author, commits, version } = payload;
  const commitMessages = commits?.map((c: any) => c.message) || [];

  ctx.db
    .prepare(
      `INSERT INTO deployments (sha, author, version, commit_count, commit_messages)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sha, author, version, commitMessages.length, JSON.stringify(commitMessages));

  const previousDeploy = ctx.db
    .prepare('SELECT sha FROM deployments WHERE sha != ? ORDER BY deployed_at DESC LIMIT 1')
    .get(sha) as any;

  const [aiSummary, riskAnalysis] = await Promise.all([
    generateDeploySummary(commits || []).catch(() => null),
    previousDeploy
      ? (async () => {
          const project = ctx.db
            .prepare('SELECT github_repo FROM projects WHERE github_repo IS NOT NULL LIMIT 1')
            .get() as any;
          if (!project?.github_repo) return null;

          const diffs = await fetchCompareDiffs(
            project.github_repo,
            previousDeploy.sha,
            sha,
            config.github.token,
          );
          if (!diffs) return null;
          return analyzeDeployRisk(diffs.files);
        })().catch(() => null)
      : Promise.resolve(null),
  ]);

  if (aiSummary || riskAnalysis) {
    ctx.db
      .prepare('UPDATE deployments SET ai_summary = ?, risk_level = ? WHERE sha = ?')
      .run(aiSummary, riskAnalysis?.level || null, sha);
  }

  const riskEmoji = riskAnalysis?.level === 'alto' ? '🔴' : riskAnalysis?.level === 'medio' ? '🟡' : '🟢';
  const riskLabel = riskAnalysis?.level || 'desconhecido';

  const embed = new EmbedBuilder()
    .setTitle(`🚀 Deploy v${version || '?'}`)
    .setColor(riskAnalysis?.level === 'alto' ? 0xd73a49 : riskAnalysis?.level === 'medio' ? 0xf2c94c : 0x2ea44f)
    .setDescription(aiSummary || commitMessages.slice(0, 5).join('\n') || 'Sem detalhes')
    .addFields(
      { name: `${riskEmoji} Risco`, value: riskLabel, inline: true },
      { name: 'Commits', value: `${commitMessages.length} por ${author}`, inline: true },
      { name: 'SHA', value: `\`${sha?.slice(0, 7)}\``, inline: true },
    )
    .setTimestamp();

  if (riskAnalysis?.areas?.length) {
    embed.addFields({ name: 'Áreas', value: riskAnalysis.areas.join(', ') });
  }

  const allText = commitMessages.join(' ');
  const linearIds = extractLinearIds(allText);
  if (linearIds.length > 0) {
    embed.addFields({ name: 'Issues fechadas', value: linearIds.join(', ') });
  }

  const guild = ctx.client.guilds.cache.first();
  if (guild) {
    const projects = ctx.db
      .prepare('SELECT * FROM projects WHERE archived_at IS NULL')
      .all() as any[];

    for (const project of projects) {
      const channels = guild.channels.cache.filter(
        (c: any) => c.parentId === project.discord_category_id && c.name.endsWith('-dev'),
      );
      const devChannel = channels.first() as TextChannel | undefined;
      if (devChannel) {
        await devChannel.send({ embeds: [embed] });
      }
    }
  }

  if (linearIds.length > 0) {
    const linearModule = ctx.getModule('linear');
    if (linearModule && (linearModule as any).closeIssues) {
      try {
        await (linearModule as any).closeIssues(linearIds, `Deployed in v${version || sha?.slice(0, 7)}`);
      } catch (error) {
        ctx.logger.error('Failed to close Linear issues:', error);
      }
    }
  }

  ctx.logger.info(`Deploy processed: v${version} (${sha?.slice(0, 7)}) by ${author}`);
}
