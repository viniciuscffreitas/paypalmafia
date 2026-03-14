import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from './logger';
import type { GitHubProjectStatus } from '../utils/github-status';
import type { LinearProjectStatus } from '../utils/linear-status';

const logger = createLogger('ai-status');

export interface ProjectStatusReport {
  executiveSummary: string;
  technicalSummary: string;
  roadmap: {
    shortTerm: string[]; // this week / sprint
    mediumTerm: string[]; // next sprint / 2 weeks
    risks: string[];
  };
  metrics: {
    healthScore: number; // 0-100
    velocityTrend: 'up' | 'down' | 'stable';
    topContributors: string[];
  };
}

const STATUS_PROMPT = `Você é um assistente de gestão de projetos para uma startup. Analise os dados do projeto e gere um relatório estruturado.

Responda APENAS em JSON válido (sem markdown, sem code blocks):

{
  "executiveSummary": "Resumo executivo de 3-4 frases para stakeholders não técnicos. Estado geral, progresso, riscos. Português brasileiro.",
  "technicalSummary": "Resumo técnico de 3-4 frases para devs. Foque em: PRs, branches ativas, CI status, código recente. Português brasileiro.",
  "roadmap": {
    "shortTerm": ["Ação concreta 1 para esta semana/sprint", "Ação 2", "..."],
    "mediumTerm": ["Objetivo para próximas 2 semanas", "..."],
    "risks": ["Risco ou blocker identificado", "..."]
  },
  "metrics": {
    "healthScore": 75,
    "velocityTrend": "up",
    "topContributors": ["contributor1", "contributor2"]
  }
}

Regras:
1. healthScore: 0-100 baseado em atividade, CI status, blockers, velocity
2. velocityTrend: compare semana atual vs anterior
3. shortTerm: baseie-se nas issues in-progress e no sprint atual
4. mediumTerm: baseie-se no backlog prioritário e milestones
5. risks: blockers reais (issues paradas, CI falhando, branches órfãs, etc)
6. Seja concreto — cite issues por ID, PRs por número, nomes de branches
7. Se não tem dados suficientes para algo, diga "dados insuficientes" em vez de inventar
8. Máximo 5 itens por array
9. Escreva em português brasileiro`;

function buildContextBlock(
  projectName: string,
  github: GitHubProjectStatus | null,
  linear: LinearProjectStatus | null,
  localMetrics: { commits7d: number; issues7d: number; prs7d: number; prevCommits7d: number } | null,
): string {
  const parts: string[] = [`# Projeto: ${projectName}\n`];

  if (github) {
    parts.push('## GitHub');
    parts.push(`Repo: ${github.repo.name} (${github.repo.language || 'N/A'})`);
    parts.push(`Descrição: ${github.repo.description || 'N/A'}`);
    parts.push(`Stars: ${github.repo.stars} | Forks: ${github.repo.forks} | Issues abertas: ${github.repo.openIssuesCount}`);

    // Languages
    const totalBytes = Object.values(github.languages).reduce((a, b) => a + b, 0);
    if (totalBytes > 0) {
      const langPcts = Object.entries(github.languages)
        .map(([lang, bytes]) => `${lang}: ${Math.round((bytes / totalBytes) * 100)}%`)
        .slice(0, 5);
      parts.push(`Linguagens: ${langPcts.join(', ')}`);
    }

    // Contributors
    if (github.contributors.length > 0) {
      parts.push(`\n### Contribuidores (${github.contributors.length})`);
      for (const c of github.contributors.slice(0, 5)) {
        parts.push(`- ${c.login}: ${c.totalCommits} commits total, ${c.recentCommits} nas últimas 4 semanas`);
      }
    }

    // Recent commits
    if (github.recentCommits.length > 0) {
      parts.push(`\n### Commits Recentes (${github.recentCommits.length})`);
      for (const c of github.recentCommits.slice(0, 10)) {
        parts.push(`- ${c.sha} ${c.message} (${c.author}, ${c.date})`);
      }
    }

    // Commit activity trend
    if (github.commitActivity.length > 0) {
      const last4 = github.commitActivity.slice(-4);
      const weeklyTotals = last4.map((w) => w.total);
      parts.push(`\n### Atividade Semanal (últimas 4 semanas): ${weeklyTotals.join(', ')} commits`);
    }

    // Code churn
    if (github.codeFrequency.length > 0) {
      const last4 = github.codeFrequency.slice(-4);
      const totalAdds = last4.reduce((s, w) => s + w.additions, 0);
      const totalDels = last4.reduce((s, w) => s + w.deletions, 0);
      parts.push(`Code churn (4 semanas): +${totalAdds} -${totalDels} linhas`);
    }

    // Branches
    if (github.branches.length > 0) {
      parts.push(`\n### Branches (${github.branches.length})`);
      for (const b of github.branches) {
        parts.push(`- ${b.name}${b.protected ? ' (protegida)' : ''}`);
      }
    }

    // Pull Requests
    if (github.pullRequests.open.length > 0) {
      parts.push(`\n### PRs Abertas (${github.pullRequests.open.length})`);
      for (const pr of github.pullRequests.open) {
        parts.push(`- #${pr.number}: ${pr.title} (${pr.author}, +${pr.additions} -${pr.deletions})`);
      }
    }
    if (github.pullRequests.recentlyMerged.length > 0) {
      parts.push(`\n### PRs Recentemente Mergeadas`);
      for (const pr of github.pullRequests.recentlyMerged) {
        parts.push(`- #${pr.number}: ${pr.title} (${pr.author}, merged ${pr.mergedAt})`);
      }
    }

    // CI Status
    if (github.ciStatus.lastRun) {
      const ci = github.ciStatus;
      parts.push(`\n### CI/CD`);
      parts.push(`Último run: ${ci.lastRun!.name} — ${ci.lastRun!.conclusion || ci.lastRun!.status}`);
      parts.push(`Taxa de sucesso (últimos 10 runs): ${ci.recentSuccessRate}%`);
    }

    // Latest release
    if (github.latestRelease) {
      parts.push(`\n### Último Release: ${github.latestRelease.tagName} (${github.latestRelease.publishedAt})`);
    }
  }

  if (linear) {
    parts.push('\n## Linear');
    parts.push(`Time: ${linear.team.name} (${linear.team.key}) — ${linear.team.memberCount} membros`);

    // Issues by state
    parts.push(`\n### Issues por Estado`);
    for (const group of linear.issuesByState) {
      parts.push(`\n#### ${group.state} (${group.count})`);
      for (const issue of group.issues.slice(0, 5)) {
        const assigneeStr = issue.assignee ? ` → ${issue.assignee}` : '';
        const estimateStr = issue.estimate ? ` [${issue.estimate}pts]` : '';
        const labelStr = issue.labels.length > 0 ? ` {${issue.labels.join(', ')}}` : '';
        parts.push(`- ${issue.identifier}: ${issue.title}${assigneeStr}${estimateStr}${labelStr} (P${issue.priority})`);
      }
      if (group.issues.length > 5) {
        parts.push(`  ... e mais ${group.issues.length - 5} issues`);
      }
    }

    // Active cycle
    if (linear.activeCycle) {
      const c = linear.activeCycle;
      parts.push(`\n### Sprint Atual: ${c.name}`);
      parts.push(`Período: ${c.startsAt} → ${c.endsAt}`);
      parts.push(`Progresso: ${Math.round(c.progress * 100)}%`);
      parts.push(`Escopo: ${c.scopeCompleted}/${c.scopeTotal} pontos`);
      parts.push(`Issues: ${c.issuesCompleted} done, ${c.issuesInProgress} in progress, ${c.issuesTotal} total`);
    }

    // Upcoming cycle
    if (linear.upcomingCycle) {
      parts.push(`\n### Próximo Sprint: ${linear.upcomingCycle.name} (${linear.upcomingCycle.startsAt})`);
    }

    // Projects and milestones
    if (linear.projects.length > 0) {
      parts.push(`\n### Projetos Linear`);
      for (const proj of linear.projects) {
        parts.push(`- ${proj.name}: ${proj.state} (${Math.round(proj.progress * 100)}% completo)`);
        if (proj.targetDate) parts.push(`  Target: ${proj.targetDate}`);
        for (const m of proj.milestones) {
          parts.push(`  - Milestone: ${m.name}${m.targetDate ? ` (${m.targetDate})` : ''}`);
        }
      }
    }

    // Velocity
    parts.push(`\n### Velocity`);
    parts.push(`Issues completadas esta semana: ${linear.velocity.completedThisWeek}`);
    parts.push(`Issues completadas semana passada: ${linear.velocity.completedLastWeek}`);
    if (linear.velocity.avgPointsPerCycle > 0) {
      parts.push(`Média por ciclo: ${linear.velocity.avgPointsPerCycle} pontos`);
    }

    // Blockers
    if (linear.blockers.length > 0) {
      parts.push(`\n### ⚠️ Blockers Detectados`);
      for (const b of linear.blockers) {
        parts.push(`- ${b.identifier}: ${b.title} (${b.daysSinceUpdate} dias sem update${b.assignee ? `, ${b.assignee}` : ''})`);
      }
    }

    // Labels distribution
    if (linear.labels.length > 0) {
      parts.push(`\n### Labels`);
      for (const l of linear.labels.slice(0, 8)) {
        parts.push(`- ${l.name}: ${l.issueCount} issues`);
      }
    }
  }

  if (localMetrics) {
    parts.push('\n## Métricas Locais (últimos 7 dias)');
    parts.push(`Commits: ${localMetrics.commits7d} (anterior: ${localMetrics.prevCommits7d})`);
    parts.push(`Issues fechadas: ${localMetrics.issues7d}`);
    parts.push(`PRs merged: ${localMetrics.prs7d}`);
  }

  return parts.join('\n');
}

export async function generateProjectStatus(
  projectName: string,
  github: GitHubProjectStatus | null,
  linear: LinearProjectStatus | null,
  localMetrics: { commits7d: number; issues7d: number; prs7d: number; prevCommits7d: number } | null,
): Promise<ProjectStatusReport | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — cannot generate status report');
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const contextBlock = buildContextBlock(projectName, github, linear, localMetrics);

  logger.info(`Generating project status for ${projectName} (context: ${contextBlock.length} chars)`);

  const prompt = `${STATUS_PROMPT}\n\n--- DADOS DO PROJETO ---\n${contextBlock}\n--- FIM DOS DADOS ---`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error('AI returned non-JSON response for project status');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      executiveSummary: parsed.executiveSummary || 'Resumo não disponível.',
      technicalSummary: parsed.technicalSummary || 'Resumo técnico não disponível.',
      roadmap: {
        shortTerm: Array.isArray(parsed.roadmap?.shortTerm) ? parsed.roadmap.shortTerm : [],
        mediumTerm: Array.isArray(parsed.roadmap?.mediumTerm) ? parsed.roadmap.mediumTerm : [],
        risks: Array.isArray(parsed.roadmap?.risks) ? parsed.roadmap.risks : [],
      },
      metrics: {
        healthScore: Math.min(100, Math.max(0, parsed.metrics?.healthScore ?? 50)),
        velocityTrend: ['up', 'down', 'stable'].includes(parsed.metrics?.velocityTrend)
          ? parsed.metrics.velocityTrend
          : 'stable',
        topContributors: Array.isArray(parsed.metrics?.topContributors)
          ? parsed.metrics.topContributors
          : [],
      },
    };
  } catch (error) {
    logger.error('Failed to generate project status:', error);
    return null;
  }
}

// Exported for testing
export { buildContextBlock };
