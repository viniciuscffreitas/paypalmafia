import { GoogleGenerativeAI } from '@google/generative-ai';
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
10. USE o contexto fornecido (codebase, issues existentes, pesquisa web) para enriquecer a descrição com dados reais — não invente números
11. CITE FONTES: quando mencionar arquivos do codebase, use links do GitHub (ex: [\`src/app/page.tsx\`](url)). Quando mencionar best practices da web, cite a fonte
12. Analise o código real fornecido no contexto — se o projeto já tem uma implementação parcial do que a issue pede, mencione isso no Context
13. Verifique dependências no package.json — se já existe uma lib relevante instalada, mencione. Se precisa instalar algo novo, recomende
14. NÃO invente funcionalidades que não existem no código — se não tem contexto sobre algo, diga "a ser investigado"`;

export interface IssueMetadata {
  priority: number; // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  labels: string[]; // e.g. ['feature', 'frontend', 'ux']
  estimate: number; // story points: 1, 2, 3, 5, 8
}

/**
 * Sanitizes a raw AI-generated title string.
 * Strips markdown, takes only the first line, truncates, and falls back to original if empty.
 */
export function sanitizeAiTitle(raw: string, fallback: string): string {
  const firstLine = raw.split('\n')[0] ?? '';
  const stripped = firstLine
    .replace(/^#+\s*/, '')              // remove markdown headings
    .replace(/\*\*/g, '')               // remove bold
    .replace(/`/g, '')                  // remove inline code
    .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '') // remove surrounding quotes (straight + curly)
    .trim();

  if (!stripped) return fallback;

  return stripped.length > 120 ? stripped.slice(0, 120) : stripped;
}

const REFORMAT_TITLE_PROMPT = `Você é um assistente de product management. Dado um título de issue escrito informalmente, reescreva-o de forma clara, concisa e profissional.

Regras:
- Máximo 60 caracteres
- Use capitalização de título (Title Case em português: capitalize substantivos e verbos principais)
- Seja descritivo mas direto
- Não adicione prefixos como "feat:", "fix:", "chore:"
- Retorne APENAS o título reformatado, nada mais — sem explicação, sem markdown, sem aspas`;

const CLASSIFY_PROMPT = `Você é um product manager. Dado o título de uma issue e contexto do projeto, classifique a issue retornando APENAS um JSON válido (sem markdown, sem code blocks, sem explicação):

{
  "priority": <number 1-4 onde 1=urgente 2=alta 3=média 4=baixa>,
  "labels": [<array de strings, escolha entre: "feature", "bug", "improvement", "refactor", "design", "infra", "docs", "research", "ux", "performance", "security", "testing">],
  "estimate": <number de story points: 1=trivial, 2=pequeno, 3=médio, 5=grande, 8=épico>
}

Regras:
- Máximo 3 labels
- Seja realista com estimates
- Bugs são geralmente prioridade 2 (alta) ou 1 (urgente)
- Features novas são geralmente prioridade 3 (média)
- Responda APENAS o JSON, nada mais`;

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

// Fetch context from GitHub: full tree, relevant files content, commits, issues
async function fetchGitHubContext(githubRepo: string, title: string): Promise<string> {
  const token = process.env['GITHUB_TOKEN'];
  if (!token || !githubRepo) return '';

  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  const ghUrl = (path: string) => `https://github.com/${githubRepo}/blob/main/${path}`;
  const parts: string[] = [];

  // Helper to fetch file content from GitHub
  async function fetchFileContent(path: string, maxLines = 80): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${path}`, { headers });
      if (!res.ok) return null;
      const data = await res.json() as any;
      if (!data.content || data.encoding !== 'base64') return null;
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return content.split('\n').slice(0, maxLines).join('\n');
    } catch {
      return null;
    }
  }

  try {
    // 1. Repo info
    const repoRes = await fetch(`https://api.github.com/repos/${githubRepo}`, { headers });
    if (repoRes.ok) {
      const repo = await repoRes.json() as any;
      parts.push(`### Repositório: [${repo.full_name}](https://github.com/${githubRepo})`);
      parts.push(`- Descrição: ${repo.description || 'N/A'}`);
      parts.push(`- Stack: ${repo.language || 'N/A'}`);
    }

    // 2. Full file tree — this is the KEY for context
    const treeRes = await fetch(`https://api.github.com/repos/${githubRepo}/git/trees/main?recursive=1`, { headers });
    let allFiles: string[] = [];
    if (treeRes.ok) {
      const tree = await treeRes.json() as any;
      allFiles = (tree.tree || [])
        .filter((f: any) => f.type === 'blob')
        .map((f: any) => f.path);

      // Show project structure (src/ only for brevity)
      const srcFiles = allFiles.filter(f => f.startsWith('src/'));
      parts.push(`\n### Estrutura do Projeto (${srcFiles.length} arquivos em src/)`);
      parts.push('```');
      for (const f of srcFiles) {
        parts.push(f);
      }
      parts.push('```');
    }

    // 3. Smart file matching — find files related to the issue title
    const keywords = title
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
      .flatMap(w => {
        // Generate related terms
        const related: string[] = [w];
        if (w === 'autenticação' || w === 'login' || w === 'oauth' || w === 'google') {
          related.push('auth', 'login', 'session', 'middleware', 'magic', 'token', 'sign');
        }
        if (w === 'dark' || w === 'mode' || w === 'tema' || w === 'theme') {
          related.push('theme', 'dark', 'light', 'globals.css', 'tailwind');
        }
        if (w === 'notificação' || w === 'notificações' || w === 'push' || w === 'notification') {
          related.push('push', 'notification', 'subscribe', 'service-worker', 'manifest');
        }
        return related;
      });

    const relevantFiles = allFiles.filter(f => {
      const lower = f.toLowerCase();
      return keywords.some(k => lower.includes(k));
    }).slice(0, 10); // Max 10 files

    if (relevantFiles.length > 0) {
      parts.push(`\n### Arquivos Relevantes para "${title}" (${relevantFiles.length} encontrados)`);

      // Fetch content of relevant files in parallel
      const contentPromises = relevantFiles.map(async (path) => {
        const content = await fetchFileContent(path);
        if (content) {
          return `\n#### [\`${path}\`](${ghUrl(path)})\n\`\`\`\n${content}\n\`\`\``;
        }
        return `\n- [\`${path}\`](${ghUrl(path)}) *(não foi possível ler)*`;
      });

      const contents = await Promise.all(contentPromises);
      parts.push(...contents);
    }

    // 4. Key config files (always include)
    const keyFiles = ['package.json'];
    for (const keyFile of keyFiles) {
      const content = await fetchFileContent(keyFile);
      if (content) {
        parts.push(`\n### [\`${keyFile}\`](${ghUrl(keyFile)})`);
        parts.push(`\`\`\`json\n${content}\n\`\`\``);
      }
    }

    // 5. Recent commits (last 10)
    const commitsRes = await fetch(`https://api.github.com/repos/${githubRepo}/commits?per_page=10`, { headers });
    if (commitsRes.ok) {
      const commits = await commitsRes.json() as any[];
      if (commits.length > 0) {
        parts.push('\n### Commits Recentes');
        for (const c of commits) {
          parts.push(`- [\`${c.sha.slice(0, 7)}\`](https://github.com/${githubRepo}/commit/${c.sha}) ${c.commit.message.split('\n')[0]}`);
        }
      }
    }

    // 6. Open issues/PRs
    const issuesRes = await fetch(`https://api.github.com/repos/${githubRepo}/issues?state=open&per_page=5`, { headers });
    if (issuesRes.ok) {
      const issues = await issuesRes.json() as any[];
      if (issues.length > 0) {
        parts.push('\n### Issues/PRs Abertas');
        for (const i of issues) {
          parts.push(`- [#${i.number}: ${i.title}](${i.html_url})`);
        }
      }
    }

    // (tree and PRs already covered above)
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

    let contextBlock = '';
    if (githubContext || linearContext) {
      contextBlock = '\n\n--- CONTEXTO DO PROJETO (use para enriquecer a descrição) ---\n';
      if (githubContext) contextBlock += `\n## GitHub\n${githubContext}\n`;
      if (linearContext) contextBlock += `\n## Linear\n${linearContext}\n`;
      contextBlock += '\n--- FIM DO CONTEXTO ---\n';
    }

    const projectHint = projectName ? `\nProjeto: ${projectName}` : '';
    const prompt = `${ISSUE_TEMPLATE_PROMPT}${contextBlock}\n\nGere a descrição para esta issue:\nTítulo: ${title}${projectHint}\n\nUse o contexto do projeto fornecido acima para referenciar arquivos reais, commits recentes, issues existentes e estrutura do codebase. Adicione também recomendações técnicas baseadas em best practices de mercado.`;

    // Try with google_search tool first (new API format for Gemini 3.x)
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.1-pro-preview',
        tools: [{ googleSearch: {} } as any],
      });
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      logger.info(`AI generated description for: ${title} (${text.length} chars, with search + context)`);
      return text;
    } catch (searchError) {
      logger.warn('Google Search tool failed, retrying without:', searchError);
    }

    // Fallback: without search tool but WITH context
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    logger.info(`AI generated description for: ${title} (${text.length} chars, with context, no search)`);
    return text;
  } catch (error) {
    logger.error('AI generation failed:', error);

    // Last resort fallback
    try {
      logger.info('Retrying with basic prompt...');
      const model = genAI!.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
      const prompt = `${ISSUE_TEMPLATE_PROMPT}\n\nGere a descrição para esta issue:\nTítulo: ${title}\nProjeto: ${projectName || 'N/A'}`;
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (fallbackError) {
      logger.error('AI fallback also failed:', fallbackError);
      return null;
    }
  }
}

export async function classifyIssue(title: string, description?: string): Promise<IssueMetadata> {
  const defaults: IssueMetadata = { priority: 3, labels: ['feature'], estimate: 3 };
  if (!genAI) return defaults;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const context = description ? `\nDescrição: ${description.slice(0, 500)}` : '';
    const prompt = `${CLASSIFY_PROMPT}\n\nTítulo: ${title}${context}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Parse JSON - handle potential markdown wrapping
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      priority: Math.min(4, Math.max(1, parsed.priority || 3)),
      labels: Array.isArray(parsed.labels) ? parsed.labels.slice(0, 3) : ['feature'],
      estimate: [1, 2, 3, 5, 8].includes(parsed.estimate) ? parsed.estimate : 3,
    };
  } catch (error) {
    logger.warn('Issue classification failed, using defaults:', error);
    return defaults;
  }
}

export async function generateDeploySummary(
  commits: { message: string; sha: string }[],
): Promise<string | null> {
  if (!genAI) return null;

  const commitList = commits.map((c) => `- ${c.message} (${c.sha.slice(0, 7)})`).join('\n');

  const prompt = `Você é um assistente de DevOps. Gere um resumo conciso (2-3 frases) em português do que foi deployado, baseado nestes commits:

${commitList}

Foque no impacto pro usuário/sistema, não nos detalhes técnicos. Seja direto.`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const result = await model.generateContent(prompt);
    return result.response.text().trim() || null;
  } catch {
    return null;
  }
}

export async function reformatIssueTitle(rawTitle: string): Promise<string> {
  if (!genAI) return rawTitle;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const prompt = `${REFORMAT_TITLE_PROMPT}\n\nTítulo original: ${rawTitle}`;
    const result = await model.generateContent(prompt);
    return sanitizeAiTitle(result.response.text(), rawTitle);
  } catch {
    return rawTitle;
  }
}

export async function analyzeDeployRisk(
  diffSummary: { filename: string; status: string; additions: number; deletions: number }[],
): Promise<{ level: string; areas: string[]; breaking: string[] } | null> {
  if (!genAI) return null;

  const fileList = diffSummary
    .map((f) => `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`)
    .join('\n');

  const prompt = `Analise o risco deste deploy baseado nos arquivos modificados:

${fileList}

Responda APENAS em JSON válido:
{
  "level": "baixo" | "medio" | "alto",
  "areas": ["lista de áreas/módulos afetados"],
  "breaking": ["lista de possíveis breaking changes, ou vazio se nenhum"]
}`;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
