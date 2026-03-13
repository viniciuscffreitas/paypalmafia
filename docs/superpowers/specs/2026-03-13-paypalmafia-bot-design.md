# PayPal Mafia Bot — Design Spec

## Overview

Discord bot modular para servidor de startup duo. Funciona como "co-founder digital" — gerencia projetos, integra com GitHub/Linear, automatiza standups e métricas. Filosofia Lean Startup: MVP rápido, medir uso, iterar.

## Princípios

- **Zero fricção**: automação > comandos manuais. Webhooks > polling.
- **Linear é source of truth** para tarefas — bot é interface, não duplica dados.
- **Build-Measure-Learn**: módulo Pulse mede atividade, weekly digest força reflexão.
- **Modular**: cada feature é um módulo independente com interface `BotModule`.

## Stack

- **Runtime**: Node.js + TypeScript
- **Discord**: discord.js v14
- **Storage**: SQLite (via better-sqlite3)
- **Webhooks**: Express embutido (GitHub/Linear incoming webhooks)
- **Scheduling**: node-cron (standup, digest)
- **Deploy**: VPS Linux via SSH key

## Arquitetura

```
src/
├── bot.ts                    # Entry point — carrega módulos, conecta Discord
├── config.ts                 # Validação de env vars
├── server.ts                 # Express server para webhooks
├── db.ts                     # SQLite setup + migrations
├── core/
│   ├── module-loader.ts      # Descobre e registra módulos automaticamente
│   ├── command-registry.ts   # Registra slash commands no Discord
│   └── logger.ts             # Logging padronizado (console + arquivo)
├── modules/
│   ├── module.interface.ts   # Interface BotModule
│   ├── projects/
│   │   ├── index.ts          # Módulo: gerenciamento de projetos
│   │   ├── commands.ts       # Slash commands do módulo
│   │   └── handlers.ts       # Event handlers
│   ├── github/
│   │   ├── index.ts          # Módulo: integração GitHub
│   │   ├── commands.ts
│   │   ├── webhooks.ts       # Webhook handlers (push, PR, CI)
│   │   └── formatter.ts      # Formata embeds de eventos GitHub
│   ├── linear/
│   │   ├── index.ts          # Módulo: integração Linear
│   │   ├── commands.ts
│   │   ├── webhooks.ts       # Webhook handlers (issue, cycle)
│   │   ├── api.ts            # Linear API client
│   │   └── formatter.ts      # Formata embeds de eventos Linear
│   ├── standup/
│   │   ├── index.ts          # Módulo: standup automatizado
│   │   ├── commands.ts
│   │   └── generator.ts      # Gera standup a partir de dados GitHub/Linear
│   ├── pulse/
│   │   ├── index.ts          # Módulo: métricas e health check
│   │   ├── commands.ts
│   │   ├── collector.ts      # Coleta métricas de GitHub/Linear
│   │   └── digest.ts         # Gera weekly digest
│   └── links/
│       ├── index.ts          # Módulo: quick links / knowledge base
│       └── commands.ts
└── types/
    └── index.ts              # Tipos compartilhados
```

## Interface BotModule

```typescript
interface BotModule {
  name: string;
  description: string;
  commands: SlashCommandBuilder[];
  webhookRoutes?: express.Router;
  cronJobs?: CronJob[];

  onLoad(context: ModuleContext): Promise<void>;
  onUnload(): Promise<void>;
  handleCommand(interaction: ChatInputCommandInteraction): Promise<void>;
}

interface ModuleContext {
  client: Client;
  db: Database;
  logger: Logger;
  getModule(name: string): BotModule | undefined;
}
```

## Módulos

### 1. Projects

Gerencia projetos e canais do Discord automaticamente.

**Commands:**
- `/project create <nome>` — cria projeto + categoria de canais (general, dev, links) + tenta linkar repo GitHub de mesmo nome
- `/project list` — lista projetos ativos com status
- `/project archive <nome>` — arquiva projeto, move canais para categoria "Arquivo"

**DB Schema:**
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  discord_category_id TEXT NOT NULL,
  github_repo TEXT,
  linear_team_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  archived_at DATETIME
);
```

### 2. GitHub

Integração via webhooks. Express recebe eventos do GitHub e posta nos canais corretos.

**Webhook events:**
- `push` — notifica com autor, branch, commits resumidos, diff stats
- `pull_request` (opened/merged/closed) — embed com título, autor, reviewers
- `check_run` (completed com failure) — alerta de CI fail com link pro log
- `release` — anúncio automático de nova release

**Commands:**
- `/github link <repo>` — associa repo GitHub ao projeto do canal atual
- `/github unlink` — remove associação

**Webhook route:** `POST /webhooks/github` — valida signature, roteia para canal do projeto.

### 3. Linear

Integração bidirecional via API + webhooks.

**Webhook events:**
- Issue created/updated/removed — posta/atualiza no canal do projeto
- Issue status change — atualiza embed existente
- Cycle started/completed — posta resumo no canal

**Commands:**
- `/linear link <team-key>` — associa Linear team ao projeto
- `/task <título> [descrição]` — cria issue no Linear direto do Discord
- `/linear sync` — lista issues abertas do projeto linkado

**API Client:** Usa `@linear/sdk` para criar issues e buscar dados.

### 4. Standup (automatizado)

Gera standup automático baseado em dados reais.

**Automação (cron diário, 9h):**
1. Puxa commits das últimas 24h (GitHub API)
2. Puxa issues movidas/fechadas (Linear API)
3. Puxa PRs abertas/merged
4. Formata e posta no canal `#standup` do projeto

**Commands:**
- `/standup` — modal para complementar o standup automático (bloqueios, notas)
- `/standup history [dias]` — últimos standups

### 5. Pulse (métricas)

Mede a saúde dos projetos. Lean Startup = medir.

**Commands:**
- `/pulse [projeto]` — dashboard embed: commits/semana, issues fechadas, PRs abertos, velocity

**Automação (cron semanal, segunda 9h):**
- Weekly digest: resumo da semana por projeto
- Detecta inatividade: "Projeto X sem commits há 5 dias"

**DB Schema:**
```sql
CREATE TABLE metrics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id),
  date DATE NOT NULL,
  commits_count INTEGER DEFAULT 0,
  issues_closed INTEGER DEFAULT 0,
  prs_merged INTEGER DEFAULT 0,
  UNIQUE(project_id, date)
);
```

### 6. Links

Knowledge base mínima por projeto.

**Commands:**
- `/link save <nome> <url> [descrição]` — salva link no projeto
- `/link <nome>` — busca e retorna link
- `/link list` — todos os links do projeto

**Auto-detect:** Bot monitora mensagens, se detecta URL com contexto relevante, reage com 🔖 — se alguém clica, salva automaticamente.

**DB Schema:**
```sql
CREATE TABLE links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  saved_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, name)
);
```

## Webhook Server

Express embutido rodando na mesma porta (default 3000).

```
POST /webhooks/github   — validação HMAC SHA-256
POST /webhooks/linear   — validação HMAC via LINEAR_WEBHOOK_SECRET
GET  /health            — health check
```

## Env Vars

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
GITHUB_TOKEN=              # PAT para GitHub API (leitura de commits, PRs, issues)
GITHUB_WEBHOOK_SECRET=
LINEAR_API_KEY=
LINEAR_WEBHOOK_SECRET=
WEBHOOK_PORT=3000
DATABASE_PATH=./data/bot.db
```

## Permissões

MVP: todos os comandos disponíveis para todos os membros do servidor. Sem restrição de role — são 2 co-founders. Role-based guards ficam para quando/se o servidor crescer.

## Convenções

- `projects.github_repo` armazena no formato `owner/repo` (ex: `paypalmafia/app`).
- Webhook routing: match por `repository.full_name` (GitHub) e `teamId` (Linear) contra os campos do projeto.
- Módulos que dependem de outros (Standup depende de GitHub e Linear) usam `getModule()` e toleram dependência indisponível (log warning, skip gracefully).
- Erros de API externa (rate limit, timeout): log + skip, sem retry para MVP.
- Canal `standup` é criado automaticamente por projeto junto com `general`, `dev`, `links`.

## Ordem de Implementação (MVP)

1. **Core** — bot.ts, config, module-loader, command-registry, db, logger
2. **Projects** — CRUD de projetos, auto-criação de canais
3. **Links** — módulo mais simples, valida a arquitetura modular
4. **GitHub** — webhooks + notificações
5. **Linear** — API client + webhooks + `/task`
6. **Standup** — gerador automático + cron
7. **Pulse** — métricas + weekly digest

## Fora do escopo (futuro)

- Deploy automático via `/deploy` (SSH na VPS)
- Integração com Notion/Figma
- Dashboard web
- Multi-server support
