# Automation Pipeline — Full Integration Design

## Overview

Fechar o loop de automação completo: CI/CD, issue lifecycle, deploy tracking com AI, e Claude Code como operador. Tudo integrado no bot Discord existente via arquitetura BotModule.

**Abordagem:** Monolito expandido — novos módulos dentro da mesma arquitetura, GitHub Actions para CI/CD com SSH deploy.

---

## Seção 1: CI/CD Pipeline (GitHub Actions → VPS)

### Fluxo

```
push main → GitHub Actions → npm ci → build → test (smoke) → SSH deploy → POST /webhooks/deploy → Discord notifica
```

### GitHub Actions Workflow (`.github/workflows/deploy.yml`)

- **Trigger:** push na `main`
- **Jobs:**
  1. **build-test:** `npm ci` → `npm run build` → `npm test`
  2. **deploy** (depende de build-test): SSH na VPS → rsync `dist/`, `package.json`, `package-lock.json` → `npm ci --production` → `pm2 restart paypalmafia-bot`
  3. **notify:** POST no webhook do bot (`/webhooks/deploy`) com SHA, autor, timestamp, commits, version

### Secrets do GitHub

- `VPS_HOST` — hostname da VPS
- `VPS_USER` — usuário SSH
- `VPS_SSH_KEY` — chave privada SSH
- `WEBHOOK_URL` — URL do webhook do bot (ex: `http://petshopcisnebranco.com.br:3456/webhooks/deploy`)

### Smoke tests (`npm test`)

- Bot inicializa sem crash (db in-memory, Discord client mockado)
- Todos os módulos carregam (`onLoad` sem erro)
- Comandos slash registram corretamente
- Webhook server responde `/health`

---

## Seção 2: Módulo `deploy` (novo BotModule)

### Responsabilidade

Recebe webhook do GitHub Actions pós-deploy. Notifica Discord, comenta nas issues do Linear, guarda histórico, e gera summaries com AI.

### Webhook: `POST /webhooks/deploy`

Payload esperado:

```json
{
  "sha": "abc1234",
  "author": "vini",
  "branch": "main",
  "commits": [
    { "message": "fix: login bug PM-123", "sha": "abc1234" },
    { "message": "feat: focus timer PM-127", "sha": "def5678" }
  ],
  "timestamp": "2026-03-13T15:00:00Z",
  "version": "1.0.5"
}
```

### Ao receber o webhook:

1. **Salva no banco** — tabela `deployments`
2. **AI summary** (Gemini) — gera resumo dos commits em linguagem natural
3. **AI risk analysis** (Gemini, paralelo) — analisa diffs via GitHub API, classifica risco (baixo/médio/alto), identifica áreas afetadas e breaking changes
4. **Posta no Discord** — embed rico no canal `#dev` de cada projeto afetado
5. **Fecha issues no Linear** — parseia `PM-123` dos commit messages, move pra "Done", comenta "Deployed in v{version}" com o summary

### Embed do Discord

```
Deploy v1.0.5                              Risco baixo
----------------------------------------------------
Corrigido bug de autenticacao no login e
adicionado comando /focus com timer configuravel.

Areas: login, focus module
Commits: 3 por vini
Issues fechadas: PM-123, PM-127
```

### Comando: `/deploy history`

Lista últimos 10 deploys com SHA, autor, data, commit count, e summary.

### Migration

```sql
CREATE TABLE deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha TEXT NOT NULL,
  author TEXT,
  version TEXT,
  commit_count INTEGER DEFAULT 0,
  commit_messages TEXT,
  ai_summary TEXT,
  risk_level TEXT,
  deployed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Seção 3: Issue Lifecycle (Linear <-> GitHub loop completo)

### Fluxo end-to-end

```
/task "titulo" → cria issue no Linear (AI) → auto-cria branch feat/PM-123-titulo-slug
→ dev trabalha → abre PR com PM-123 → bot move issue pra "In Review"
→ merge → bot move issue pra "Done"
→ CI deploya → modulo deploy comenta "Deployed in v1.0.5"
```

### Mudanças no módulo `linear`

Após criar issue, chama GitHub API pra criar branch:

```
POST /repos/{owner}/{repo}/git/refs
ref: refs/heads/feat/PM-123-titulo-slug
sha: HEAD da main
```

Slug: lowercase, sem acentos, espaços → `-`, trunca em 50 chars.

Resposta no Discord inclui a branch pronta.

### Mudanças no módulo `github`

Dois novos event handlers no webhook:

**`pull_request.opened`:**
- Parseia `PM-123` do título do PR
- Move issue pra "In Review" no Linear
- Posta no Discord

**`pull_request.closed` (merged=true):**
- Parseia `PM-123` do título/body/branch
- Move issue pra "Done" no Linear
- Posta no Discord

### Utility compartilhada

```typescript
// src/utils/linear-ids.ts
export function extractLinearIds(text: string): string[] {
  const matches = text.match(/[A-Z]{2,5}-\d+/g);
  return matches ? [...new Set(matches)] : [];
}

export function generateBranchSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
```

### Cache de estados do Linear

Na primeira chamada, busca estados do time (`team.states()`) e cacheia em memória (Map). Invalida a cada 1h.

### Opt-in

Se o PR não tiver `PM-123`, nada acontece. O sistema é ativado pelo padrão de naming.

---

## Seção 4: Testes

### Framework

**Vitest** — TypeScript nativo, rápido, sem config extra.

### Estrutura

```
tests/
  setup.ts                        — mock Discord client, db in-memory, helpers
  smoke.test.ts                   — bot boots, modules load, commands register, /health
  modules/
    github.test.ts                — webhook parsing, event handling
    linear.test.ts                — issue creation, state transitions
    deploy.test.ts                — deploy webhook, summary, issue closing
    projects.test.ts              — CRUD, channel creation
  utils/
    extract-linear-ids.test.ts    — regex extraction
    branch-slug.test.ts           — slug generation
```

### Smoke tests (bloqueiam deploy no CI)

```typescript
test('bot initializes without crash')
test('all modules load successfully')
test('all slash commands register')
test('webhook server responds to /health')
```

### Testes de lógica (progressivos)

- `extractLinearIds('fix PM-123 and PM-456')` → `['PM-123', 'PM-456']`
- `generateBranchSlug('Corrigir bug de login')` → `'corrigir-bug-de-login'`
- GitHub webhook parser: payload de PR → dados estruturados
- Deploy webhook: salva no banco, extrai issues corretas

### O que NAO testamos (por enquanto)

- Interações reais com Discord API (mockadas)
- Chamadas reais pro Linear/GitHub (mockadas)
- UI de embeds

### CI config

```yaml
- run: npm test
- run: npm run build
# deploy só se ambos passarem
```

---

## Seção 5: Claude Code como operador

### O que ele ganha com a pipeline

1. **Push-to-deploy** — commit + push na main → CI faz tudo automaticamente
2. **Workflow completo de issues** — cria issue (MCP Linear) → bot cria branch → Claude Code implementa → abre PR → bot move issue → merge → CI deploya → bot fecha issue
3. **Monitorar CI** — `gh run list` / `gh run view` pra verificar status

### Fluxo tipico

```
Usuario: "implementa a feature X da issue PM-200"

Claude Code:
  1. Le issue PM-200 no Linear (MCP)
  2. git checkout feat/PM-200-feature-x (branch criada pelo bot)
  3. Implementa com TDD
  4. git commit + push
  5. gh pr create (linka PM-200)
  6. Bot move issue pra "In Review"
  7. Apos merge: CI deploya automaticamente
  8. Bot fecha PM-200 e notifica no Discord
```

### Segurança

- Claude Code NAO ganha SSH na VPS — deploy é só via CI/CD
- Claude Code NAO roda comandos remotos na VPS
- Claude Code NAO acessa `.env` de produção

---

## Ordem de implementação

1. Testes (smoke) + Vitest setup
2. Utility functions (`extractLinearIds`, `generateBranchSlug`)
3. GitHub Actions workflow (CI/CD)
4. Módulo `deploy` (webhook + banco + AI)
5. Issue lifecycle no módulo `linear` (auto-branch)
6. Issue lifecycle no módulo `github` (PR → Linear state transitions)
7. Testes de módulo progressivos

## Dependências novas

- `vitest` (dev) — test framework
- Nenhuma dependência de produção nova
