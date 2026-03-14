import { GoogleGenerativeAI, DynamicRetrievalMode } from '@google/generative-ai';
import { createLogger } from './logger';

const logger = createLogger('ai');

const ISSUE_TEMPLATE_PROMPT = `Você é um assistente de product management para uma startup. Quando receber um título de issue/tarefa, gere uma descrição estruturada em Markdown seguindo EXATAMENTE este template:

## TL;DR
Uma frase resumindo o problema/objetivo. Direto ao ponto.

## Context
- Estado atual (números, métricas se aplicável)
- Como chegamos aqui (contexto do título)
- Dados que suportam a decisão

## Gaps / Problem Breakdown

| Severidade | Item | Notas |
|------------|------|-------|
| 🔴 Critical | Nome técnico | Descrição curta do gap/problema |
| 🟡 Medium | Nome técnico | Descrição curta |
| 🟢 Low | Nome técnico | Nice-to-have |

## Viabilidade

**Pode ser feito:**
| Ação | Esforço | Notas |
|------|---------|-------|
| Ação 1 | Low/Medium/High | Detalhes |

**Fora de escopo (e por quê):**
- Item fora de escopo — justificativa técnica

## Acceptance Criteria
- [ ] Critério verificável 1
- [ ] Critério verificável 2
- [ ] Critério verificável 3
- [ ] Documentar o que ficou de fora e por quê

---
Princípios que você DEVE seguir:
1. Data-driven: Abra com números quando possível
2. Tabelas > prosa: Gaps, tarefas, comparações — tudo em tabela
3. Severidade visual: Use 🔴 Critical, 🟡 Medium, 🟢 Low
4. Scope honesto: Declare explicitamente o que está fora de escopo
5. Esforço estimado: Cada item classificado como Low/Medium/High
6. Acceptance criteria binários: Cada critério é verificável (sim/não)
7. Seja conciso — máximo 500 palavras total
8. Escreva em português brasileiro
9. NÃO inclua o título da issue na resposta, só a descrição
10. USE o contexto fornecido (codebase, issues existentes, pesquisa web) para enriquecer a descrição com dados reais — não invente números`;

let genAI: GoogleGenerativeAI | null = null;

export function initAI(): boolean {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — AI features disabled');
    return false;
  }
  genAI = new GoogleGenerativeAI(apiKey);
  logger.info('Gemini AI initialized');
  return true;
}

// Fetch context from GitHub: repo structure, recent commits, open issues, relevant code
async function fetchGitHubContext(githubRepo: string, title: string): Promise<string> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token || !githubRepo) return '';

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const parts: string[] = [];

  try {
    // 1. Repo info
    const repoRes = await fetch(`https://api.github.com/repos/${githubRepo}`, { headers });
    if (repoRes.ok) {
      const repo = await repoRes.json() as any;
      parts.push(`### Repositório: ${repo.full_name}`);
      parts.push(`- Descrição: ${repo.description || 'N/A'}`);
      parts.push(`- Linguagem principal: ${repo.language || 'N/A'}`);
      parts.push(`- Stars: ${repo.stargazers_count} | Forks: ${repo.forks_count}`);
    }

    // 2. Recent commits (last 5)
    const commitsRes = await fetch(`https://api.github.com/repos/${githubRepo}/commits?per_page=5`, { headers });
    if (commitsRes.ok) {
      const commits = await commitsRes.json() as any[];
      if (commits.length > 0) {
        parts.push('\n### Commits Recentes');
        for (const c of commits) {
          parts.push(`- \`${c.sha.slice(0, 7)}\` ${c.commit.message.split('\n')[0]} (${c.commit.author.name})`);
        }
      }
    }

    // 3. Open issues (last 5)
    const issuesRes = await fetch(`https://api.github.com/repos/${githubRepo}/issues?state=open&per_page=5`, { headers });
    if (issuesRes.ok) {
      const issues = await issuesRes.json() as any[];
      if (issues.length > 0) {
        parts.push('\n### Issues Abertas no GitHub');
        for (const i of issues) {
          parts.push(`- #${i.number}: ${i.title} [${i.labels.map((l: any) => l.name).join(', ') || 'sem label'}]`);
        }
      }
    }

    // 4. Search code for relevant files
    const searchTerms = title.split(/\s+/).filter(w => w.length > 3).slice(0, 3).join('+');
    if (searchTerms) {
      const searchRes = await fetch(
        `https://api.github.com/search/code?q=${encodeURIComponent(searchTerms)}+repo:${githubRepo}&per_page=5`,
        { headers }
      );
      if (searchRes.ok) {
        const search = await searchRes.json() as any;
        if (search.items && search.items.length > 0) {
          parts.push('\n### Arquivos Relevantes no Codebase');
          for (const item of search.items) {
            parts.push(`- \`${item.path}\` (${item.repository.full_name})`);
          }
        }
      }
    }

    // 5. Repo file tree (top-level)
    const treeRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/`, { headers });
    if (treeRes.ok) {
      const tree = await treeRes.json() as any[];
      if (tree.length > 0) {
        parts.push('\n### Estrutura do Projeto (raiz)');
        parts.push(tree.map((f: any) => `- ${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n'));
      }
    }

    // 6. Open PRs
    const prsRes = await fetch(`https://api.github.com/repos/${githubRepo}/pulls?state=open&per_page=3`, { headers });
    if (prsRes.ok) {
      const prs = await prsRes.json() as any[];
      if (prs.length > 0) {
        parts.push('\n### PRs Abertos');
        for (const pr of prs) {
          parts.push(`- #${pr.number}: ${pr.title} (${pr.user.login}) [${pr.head.ref} → ${pr.base.ref}]`);
        }
      }
    }
  } catch (err) {
    logger.warn('GitHub context fetch error:', err);
  }

  return parts.join('\n');
}

// Fetch context from Linear: existing issues, current sprint
async function fetchLinearContext(teamKey: string): Promise<string> {
  const apiKey = process.env['LINEAR_API_KEY'];
  if (!apiKey) return '';

  const parts: string[] = [];

  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    const teams = await client.teams({ filter: { key: { eq: teamKey } } });
    const team = teams.nodes[0];
    if (!team) return '';

    // Open issues
    const issues = await team.issues({
      filter: { state: { type: { nin: ['completed', 'canceled'] } } },
      first: 10,
    });

    if (issues.nodes.length > 0) {
      parts.push('### Issues Abertas no Linear');
      for (const issue of issues.nodes) {
        const state = await issue.state;
        const assignee = await issue.assignee;
        parts.push(`- ${issue.identifier}: ${issue.title} [${state?.name || '?'}]${assignee ? ` → ${assignee.name}` : ''}`);
      }
    }

    // Active cycle
    const cycles = await team.cycles({ filter: { isActive: { eq: true } } });
    if (cycles.nodes.length > 0) {
      const cycle = cycles.nodes[0];
      parts.push(`\n### Sprint/Ciclo Atual`);
      parts.push(`- Nome: ${cycle.name || `Ciclo ${cycle.number}`}`);
      parts.push(`- Progresso: ${Math.round((cycle.progress || 0) * 100)}%`);
    }
  } catch (err) {
    logger.warn('Linear context fetch error:', err);
  }

  return parts.join('\n');
}

export async function generateIssueDescription(
  title: string,
  projectName?: string,
  githubRepo?: string | null,
  linearTeamKey?: string | null,
): Promise<string | null> {
  if (!genAI) return null;

  try {
    // Gather context in parallel
    const [githubContext, linearContext] = await Promise.all([
      githubRepo ? fetchGitHubContext(githubRepo, title) : Promise.resolve(''),
      linearTeamKey ? fetchLinearContext(linearTeamKey) : Promise.resolve(''),
    ]);

    logger.info(`Context gathered: GitHub=${githubContext.length}chars, Linear=${linearContext.length}chars`);

    // Use Gemini with Google Search grounding for web context
    const model = genAI.getGenerativeModel(
      {
        model: 'gemini-3.1-pro-preview',
        tools: [{
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: DynamicRetrievalMode.MODE_DYNAMIC,
              dynamicThreshold: 0.3, // Low threshold = more likely to search
            },
          },
        }],
      },
    );

    let contextBlock = '';
    if (githubContext || linearContext) {
      contextBlock = '\n\n--- CONTEXTO DO PROJETO (use para enriquecer a descrição) ---\n';
      if (githubContext) contextBlock += `\n## GitHub\n${githubContext}\n`;
      if (linearContext) contextBlock += `\n## Linear\n${linearContext}\n`;
      contextBlock += '\n--- FIM DO CONTEXTO ---\n';
    }

    const projectHint = projectName ? `\nProjeto: ${projectName}` : '';
    const prompt = `${ISSUE_TEMPLATE_PROMPT}${contextBlock}\n\nGere a descrição para esta issue:\nTítulo: ${title}${projectHint}\n\nPesquise na web sobre o tema da issue para adicionar contexto técnico relevante (best practices, bibliotecas recomendadas, padrões de mercado). Cite fontes quando possível.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    logger.info(`AI generated description for: ${title} (${text.length} chars, with context)`);
    return text;
  } catch (error) {
    logger.error('AI generation failed:', error);

    // Fallback: try without search grounding
    try {
      logger.info('Retrying without search grounding...');
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      const prompt = `${ISSUE_TEMPLATE_PROMPT}\n\nGere a descrição para esta issue:\nTítulo: ${title}\nProjeto: ${projectName || 'N/A'}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (fallbackError) {
      logger.error('AI fallback also failed:', fallbackError);
      return null;
    }
  }
}
