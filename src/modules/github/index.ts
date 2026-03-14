import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import type { BotModule, ModuleContext } from '../../types';
import { extractLinearIds } from '../../utils/linear-ids';

let ctx: ModuleContext;

function getProjectFromChannel(interaction: ChatInputCommandInteraction): any | null {
  const channel = interaction.channel as TextChannel;
  if (!channel?.parentId) return null;
  return ctx.db
    .prepare('SELECT * FROM projects WHERE discord_category_id = ? AND archived_at IS NULL')
    .get(channel.parentId);
}

function verifySignature(secret: string, payload: Buffer, signature: string): boolean {
  if (!secret) return true; // Skip validation if no secret configured
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

const webhookRouter = Router();

export const githubModule: BotModule = {
  name: 'github',
  description: 'GitHub integration via webhooks',
  commands: [
    new SlashCommandBuilder()
      .setName('github')
      .setDescription('GitHub integration')
      .addSubcommand((sub) =>
        sub
          .setName('link')
          .setDescription('Link a GitHub repo to this project')
          .addStringOption((opt) =>
            opt.setName('repo').setDescription('owner/repo').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub.setName('unlink').setDescription('Unlink GitHub repo from this project')
      ) as any,
  ],
  webhookRoutes: webhookRouter,

  async onLoad(context) {
    ctx = context;
    setupWebhookRoutes();
    ctx.logger.info('GitHub module loaded');
  },

  async onUnload() {},

  async handleCommand(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'link') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use em um canal de projeto.', ephemeral: true });
        return;
      }
      const repo = interaction.options.getString('repo', true);
      ctx.db.prepare('UPDATE projects SET github_repo = ? WHERE id = ?').run(repo, project.id);
      await interaction.reply(`GitHub repo **${repo}** linkado ao projeto **${project.name}**.`);
    } else if (sub === 'unlink') {
      const project = getProjectFromChannel(interaction);
      if (!project) {
        await interaction.reply({ content: 'Use em um canal de projeto.', ephemeral: true });
        return;
      }
      ctx.db.prepare('UPDATE projects SET github_repo = NULL WHERE id = ?').run(project.id);
      await interaction.reply(`GitHub desvinculado do projeto **${project.name}**.`);
    }
  },
};

function setupWebhookRoutes() {
  webhookRouter.post('/', async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const event = req.headers['x-github-event'] as string;

    if (signature && !(req as any).rawBody) {
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (signature) {
      const secret = process.env['GITHUB_WEBHOOK_SECRET'] || '';
      if (!verifySignature(secret, (req as any).rawBody, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    res.status(200).json({ ok: true });

    try {
      await handleGitHubEvent(event, req.body);
    } catch (error) {
      ctx.logger.error('GitHub webhook error:', error);
    }
  });
}

async function handleGitHubEvent(event: string, payload: any) {
  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) return;

  const project = ctx.db
    .prepare('SELECT * FROM projects WHERE github_repo = ? AND archived_at IS NULL')
    .get(repoFullName) as any;
  if (!project) return;

  const guild = ctx.client.guilds.cache.first();
  if (!guild) return;

  const channels = guild.channels.cache.filter(
    (c) => c.parentId === project.discord_category_id && c.name.endsWith('-dev')
  );
  const devChannel = channels.first() as TextChannel | undefined;
  if (!devChannel) return;

  let embed: EmbedBuilder | null = null;

  if (event === 'push') {
    const commits = payload.commits || [];
    const branch = payload.ref?.replace('refs/heads/', '') || 'unknown';
    const commitList = commits
      .slice(0, 5)
      .map((c: any) => `[\`${c.id.slice(0, 7)}\`](${c.url}) ${c.message.split('\n')[0]}`)
      .join('\n');

    embed = new EmbedBuilder()
      .setTitle(`Push to ${branch}`)
      .setDescription(commitList || 'No commits')
      .setColor(0x24292e)
      .setAuthor({ name: payload.pusher?.name || 'Unknown' })
      .setFooter({ text: `${commits.length} commit(s) — ${repoFullName}` })
      .setTimestamp();
  } else if (event === 'pull_request') {
    const pr = payload.pull_request;
    const action = payload.action;
    const color = action === 'opened' ? 0x2ea44f : action === 'closed' && pr.merged ? 0x8957e5 : 0xd73a49;
    const status = pr.merged ? 'Merged' : action.charAt(0).toUpperCase() + action.slice(1);

    embed = new EmbedBuilder()
      .setTitle(`PR ${status}: ${pr.title}`)
      .setURL(pr.html_url)
      .setColor(color)
      .setAuthor({ name: pr.user.login })
      .addFields(
        { name: 'Branch', value: `${pr.head.ref} → ${pr.base.ref}`, inline: true },
        { name: 'Changes', value: `+${pr.additions} -${pr.deletions}`, inline: true },
      )
      .setTimestamp();

    // Linear issue lifecycle transitions
    const searchText = `${pr.title} ${pr.body || ''} ${pr.head.ref}`;
    const linearIds = extractLinearIds(searchText, project.linear_team_id || undefined);

    if (linearIds.length > 0) {
      const linearMod = ctx.getModule('linear') as any;

      if (action === 'opened' && linearMod?.moveIssuesToState) {
        await linearMod.moveIssuesToState(linearIds, 'in review');
        embed.addFields({ name: 'Linear', value: `${linearIds.join(', ')} → In Review` });
      } else if (action === 'closed' && pr.merged && linearMod?.closeIssues) {
        await linearMod.closeIssues(linearIds, `Merged via PR #${pr.number}`);
        embed.addFields({ name: 'Linear', value: `${linearIds.join(', ')} → Done` });
      }
    }
  } else if (event === 'check_run' && payload.check_run?.conclusion === 'failure') {
    const check = payload.check_run;
    embed = new EmbedBuilder()
      .setTitle(`CI Failed: ${check.name}`)
      .setURL(check.html_url)
      .setColor(0xd73a49)
      .setDescription(`Check **${check.name}** falhou no commit \`${check.head_sha.slice(0, 7)}\``)
      .setTimestamp();
  } else if (event === 'release') {
    const release = payload.release;
    embed = new EmbedBuilder()
      .setTitle(`Release: ${release.tag_name}`)
      .setURL(release.html_url)
      .setColor(0x2ea44f)
      .setDescription(release.body?.slice(0, 300) || 'No release notes')
      .setAuthor({ name: release.author.login })
      .setTimestamp();
  }

  if (embed) {
    await devChannel.send({ embeds: [embed] });
  }
}
