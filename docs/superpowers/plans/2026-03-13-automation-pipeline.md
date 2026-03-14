# Automation Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the full automation loop — CI/CD, issue lifecycle, deploy tracking with AI, Claude Code as operator.

**Architecture:** Expand the existing BotModule monolith. New `deploy` module + expanded `github` and `linear` modules. GitHub Actions for CI/CD with SSH deploy. Vitest for tests.

**Tech Stack:** Node.js 22, TypeScript, Discord.js 14, Express 4, SQLite (better-sqlite3), Gemini AI, Linear SDK, Vitest, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-13-automation-pipeline-design.md`

---

## File Structure

### New Files
- `src/utils/linear-ids.ts` — extractLinearIds + generateBranchSlug utilities
- `src/utils/github-api.ts` — GitHub API helpers (create branch, fetch diffs)
- `src/modules/deploy/index.ts` — Deploy tracking BotModule
- `.github/workflows/deploy.yml` — CI/CD pipeline
- `tests/setup.ts` — Test harness (mock Discord client, in-memory db)
- `tests/smoke.test.ts` — Boot + module load + health check tests
- `tests/utils/linear-ids.test.ts` — Unit tests for extractLinearIds + generateBranchSlug
- `tests/utils/github-api.test.ts` — Unit tests for GitHub API helpers
- `vitest.config.ts` — Vitest configuration

### Modified Files
- `package.json` — Add vitest dev dep + test script
- `src/config.ts` — Add deploy webhook secret
- `src/db.ts` — Add migration 005_deployments
- `src/bot.ts` — Import + register deployModule
- `src/modules/github/index.ts` — PR → Linear state transitions
- `src/modules/linear/index.ts` — Auto-create branch after issue creation
- `src/core/ai.ts` — Add deploy summary + risk analysis functions

---

## Chunk 1: Test Infrastructure + Utilities

### Task 1: Vitest Setup

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
});
```

- [ ] **Step 3: Add test script to package.json**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
npm test
```
Expected: "No test files found" or similar clean exit.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test framework"
```

---

### Task 2: Utility — extractLinearIds

**Files:**
- Create: `src/utils/linear-ids.ts`
- Create: `tests/utils/linear-ids.test.ts`

- [ ] **Step 1: Write failing tests for extractLinearIds**

Create `tests/utils/linear-ids.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractLinearIds } from '../../src/utils/linear-ids';

describe('extractLinearIds', () => {
  it('extracts single ID', () => {
    expect(extractLinearIds('fix PM-123 bug')).toEqual(['PM-123']);
  });

  it('extracts multiple IDs', () => {
    expect(extractLinearIds('fix PM-123 and PM-456')).toEqual(['PM-123', 'PM-456']);
  });

  it('deduplicates', () => {
    expect(extractLinearIds('PM-123 and PM-123 again')).toEqual(['PM-123']);
  });

  it('returns empty array when no IDs', () => {
    expect(extractLinearIds('no issues here')).toEqual([]);
  });

  it('scopes to team prefix when provided', () => {
    expect(extractLinearIds('PM-1 HTTP-200 SSH-22', 'PM')).toEqual(['PM-1']);
  });

  it('matches 2-5 letter prefixes without team prefix', () => {
    expect(extractLinearIds('AB-1 ABCDE-99 ABCDEF-1')).toEqual(['AB-1', 'ABCDE-99']);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/utils/linear-ids.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement extractLinearIds**

Create `src/utils/linear-ids.ts`:
```typescript
export function extractLinearIds(text: string, teamPrefix?: string): string[] {
  const pattern = teamPrefix
    ? new RegExp(`${teamPrefix}-\\d+`, 'g')
    : /[A-Z]{2,5}-\d+/g;
  const matches = text.match(pattern);
  return matches ? [...new Set(matches)] : [];
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/utils/linear-ids.test.ts
```
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/linear-ids.ts tests/utils/linear-ids.test.ts
git commit -m "feat: add extractLinearIds utility with tests"
```

---

### Task 3: Utility — generateBranchSlug

**Files:**
- Modify: `src/utils/linear-ids.ts`
- Modify: `tests/utils/linear-ids.test.ts`

- [ ] **Step 1: Write failing tests for generateBranchSlug**

Append to `tests/utils/linear-ids.test.ts`:
```typescript
import { generateBranchSlug } from '../../src/utils/linear-ids';

describe('generateBranchSlug', () => {
  it('converts to lowercase kebab-case', () => {
    expect(generateBranchSlug('Fix Login Bug')).toBe('fix-login-bug');
  });

  it('removes accents', () => {
    expect(generateBranchSlug('Corrigir autenticação')).toBe('corrigir-autenticacao');
  });

  it('removes special characters', () => {
    expect(generateBranchSlug('feat: add @auth module!')).toBe('feat-add-auth-module');
  });

  it('truncates at 50 chars', () => {
    const long = 'a'.repeat(60);
    expect(generateBranchSlug(long).length).toBeLessThanOrEqual(50);
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateBranchSlug('  hello world  ')).toBe('hello-world');
  });

  it('does not end with hyphen after truncation', () => {
    const result = generateBranchSlug('a'.repeat(49) + ' b');
    expect(result).not.toMatch(/-$/);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/utils/linear-ids.test.ts
```
Expected: FAIL — generateBranchSlug not found.

- [ ] **Step 3: Implement generateBranchSlug**

Add to `src/utils/linear-ids.ts`:
```typescript
export function generateBranchSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/utils/linear-ids.test.ts
```
Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/linear-ids.ts tests/utils/linear-ids.test.ts
git commit -m "feat: add generateBranchSlug utility with tests"
```

---

### Task 4: Utility — GitHub API helpers

**Files:**
- Create: `src/utils/github-api.ts`
- Create: `tests/utils/github-api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/github-api.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBranch, fetchCompareDiffs } from '../../src/utils/github-api';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createBranch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls GitHub API with correct params', async () => {
    // Mock getting main branch SHA
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'abc123' } }),
    });
    // Mock creating ref
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ref: 'refs/heads/feat/PM-1-test' }),
    });

    const result = await createBranch('owner/repo', 'feat/PM-1-test', 'ghp_token');
    expect(result).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    // First call: get main branch SHA
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/owner/repo/git/refs/heads/main'
    );
    // Second call: create branch
    expect(mockFetch.mock.calls[1][0]).toBe(
      'https://api.github.com/repos/owner/repo/git/refs'
    );
  });

  it('returns false on API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await createBranch('owner/repo', 'feat/test', 'ghp_token');
    expect(result).toBe(false);
  });
});

describe('fetchCompareDiffs', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns diff summary from compare API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [
          { filename: 'src/a.ts', status: 'modified', additions: 10, deletions: 2 },
          { filename: 'src/b.ts', status: 'added', additions: 50, deletions: 0 },
        ],
        total_commits: 3,
      }),
    });

    const result = await fetchCompareDiffs('owner/repo', 'abc', 'def', 'ghp_token');
    expect(result).not.toBeNull();
    expect(result!.files).toHaveLength(2);
    expect(result!.totalCommits).toBe(3);
  });

  it('returns null on API error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await fetchCompareDiffs('owner/repo', 'abc', 'def', 'ghp_token');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/utils/github-api.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement GitHub API helpers**

Create `src/utils/github-api.ts`:
```typescript
interface CompareResult {
  files: { filename: string; status: string; additions: number; deletions: number }[];
  totalCommits: number;
}

export async function createBranch(
  repo: string,
  branchName: string,
  token: string,
): Promise<boolean> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  try {
    // Get main branch SHA
    const mainRef = await fetch(
      `https://api.github.com/repos/${repo}/git/refs/heads/main`,
      { headers },
    );
    if (!mainRef.ok) return false;
    const mainData = await mainRef.json();
    const sha = mainData.object.sha;

    // Create new branch
    const createRef = await fetch(
      `https://api.github.com/repos/${repo}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha,
        }),
      },
    );
    return createRef.ok;
  } catch {
    return false;
  }
}

export async function fetchCompareDiffs(
  repo: string,
  baseSha: string,
  headSha: string,
  token: string,
): Promise<CompareResult | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/compare/${baseSha}...${headSha}`,
      { headers },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      files: data.files.map((f: any) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      totalCommits: data.total_commits,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/utils/github-api.test.ts
```
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/github-api.ts tests/utils/github-api.test.ts
git commit -m "feat: add GitHub API helpers (createBranch, fetchCompareDiffs) with tests"
```

---

### Task 5: Smoke Tests

**Files:**
- Create: `tests/setup.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Create test setup with mocks**

Create `tests/setup.ts`:
```typescript
import Database from 'better-sqlite3';
import { EventEmitter } from 'events';

/**
 * Creates an in-memory SQLite database with all migrations applied.
 * Import initDatabase's migration logic by running the same SQL.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Replicate migrations from src/db.ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      discord_category_id TEXT NOT NULL,
      github_repo TEXT,
      linear_team_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      saved_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      date DATE NOT NULL,
      commits_count INTEGER DEFAULT 0,
      issues_closed INTEGER DEFAULT 0,
      prs_merged INTEGER DEFAULT 0,
      UNIQUE(project_id, date)
    );
    CREATE TABLE IF NOT EXISTS standups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT REFERENCES projects(id),
      user_id TEXT NOT NULL,
      auto_summary TEXT,
      manual_notes TEXT,
      blockers TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

/**
 * Minimal mock of Discord.js Client for testing module loading.
 * Extends EventEmitter so modules can register event listeners.
 */
export function createMockClient(): any {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    guilds: { cache: new Map() },
    user: { tag: 'TestBot#0000' },
    login: async () => 'mock-token',
    destroy: () => {},
  });
}

/**
 * Creates a minimal ModuleContext for testing.
 */
export function createTestContext(db?: Database.Database) {
  const testDb = db || createTestDb();
  return {
    client: createMockClient(),
    db: testDb,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    getModule: () => undefined,
  };
}
```

- [ ] **Step 2: Write smoke tests**

Create `tests/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createTestDb, createTestContext, createMockClient } from './setup';
import express from 'express';

describe('Smoke Tests', () => {
  it('in-memory database initializes with all tables', () => {
    const db = createTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('projects');
    expect(tables).toContain('links');
    expect(tables).toContain('metrics_snapshots');
    expect(tables).toContain('standups');
    db.close();
  });

  it('mock client has required properties', () => {
    const client = createMockClient();
    expect(client.guilds.cache).toBeDefined();
    expect(client.user.tag).toBe('TestBot#0000');
    expect(typeof client.on).toBe('function');
    expect(typeof client.emit).toBe('function');
  });

  it('test context provides all ModuleContext fields', () => {
    const ctx = createTestContext();
    expect(ctx.client).toBeDefined();
    expect(ctx.db).toBeDefined();
    expect(ctx.logger).toBeDefined();
    expect(typeof ctx.logger.info).toBe('function');
    expect(typeof ctx.getModule).toBe('function');
    ctx.db.close();
  });

  it('express health endpoint responds 200', async () => {
    const app = express();
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    const server = app.listen(0);
    const addr = server.address() as any;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    server.close();
  });
});
```

- [ ] **Step 3: Run smoke tests — verify they pass**

```bash
npm test -- tests/smoke.test.ts
```
Expected: All 4 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/setup.ts tests/smoke.test.ts
git commit -m "test: add smoke tests with mock Discord client and in-memory db"
```

---

## Chunk 2: CI/CD Pipeline + Deploy Module

### Task 6: GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create workflow file**

Create `.github/workflows/deploy.yml`:
```yaml
name: Build, Test & Deploy

on:
  push:
    branches: [main]

jobs:
  build-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run build
      - run: npm test

  deploy:
    needs: build-test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci
      - run: npm run build

      - name: Deploy to VPS via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USER }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/paypalmafia-bot
            git pull origin main
            npm ci --production
            npm run build
            pm2 restart paypalmafia-bot

      - name: Get version from package.json
        id: version
        run: echo "version=$(jq -r .version package.json)" >> $GITHUB_OUTPUT

      - name: Notify deploy webhook
        if: success()
        run: |
          COMMITS=$(git log --format='{"message":"%s","sha":"%H"}' -10 ${{ github.event.before }}..${{ github.sha }} | jq -s '.')
          curl -s -X POST "${{ secrets.WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -H "X-Deploy-Secret: ${{ secrets.DEPLOY_WEBHOOK_SECRET }}" \
            -d "{
              \"sha\": \"${{ github.sha }}\",
              \"author\": \"${{ github.actor }}\",
              \"branch\": \"main\",
              \"commits\": $COMMITS,
              \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
              \"version\": \"${{ steps.version.outputs.version }}\"
            }"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Actions build, test, and deploy pipeline"
```

---

### Task 7: Config — Deploy Webhook Secret

**Files:**
- Modify: `src/config.ts:16-36` — add deploy section

- [ ] **Step 1: Add deploy config**

In `src/config.ts`, add after the `linear` block (around line 30):
```typescript
  deploy: {
    webhookSecret: process.env['DEPLOY_WEBHOOK_SECRET'] || '',
  },
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "config: add deploy webhook secret"
```

---

### Task 8: Migration — 005_deployments

**Files:**
- Modify: `src/db.ts:75-89` — add migration after 004_standups

- [ ] **Step 1: Add migration**

In `src/db.ts`, add to the `migrations` array after the `004_standups` entry (after line 89):
```typescript
    {
      name: '005_deployments',
      sql: `
        CREATE TABLE IF NOT EXISTS deployments (
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
      `,
    },
```

- [ ] **Step 2: Update test setup**

In `tests/setup.ts`, add to the `createTestDb` function SQL block:
```sql
    CREATE TABLE IF NOT EXISTS deployments (
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

- [ ] **Step 3: Verify build + tests**

```bash
npm run build && npm test
```
Expected: Build OK, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/db.ts tests/setup.ts
git commit -m "db: add migration 005_deployments"
```

---

### Task 9: AI — Deploy Summary + Risk Analysis

**Files:**
- Modify: `src/core/ai.ts` — add two new functions

- [ ] **Step 1: Add generateDeploySummary function**

Add to `src/core/ai.ts` (at end of file, before any closing export):
```typescript
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
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/ai.ts
git commit -m "feat: add AI deploy summary and risk analysis functions"
```

---

### Task 10: Deploy Module

**Files:**
- Create: `src/modules/deploy/index.ts`
- Modify: `src/bot.ts:10-54` — import + register

- [ ] **Step 1: Create deploy module**

Create `src/modules/deploy/index.ts`:
```typescript
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
    // Authenticate
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

  // Save to database
  ctx.db
    .prepare(
      `INSERT INTO deployments (sha, author, version, commit_count, commit_messages)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sha, author, version, commitMessages.length, JSON.stringify(commitMessages));

  // AI enrichment (parallel, graceful degradation)
  const previousDeploy = ctx.db
    .prepare('SELECT sha FROM deployments WHERE sha != ? ORDER BY deployed_at DESC LIMIT 1')
    .get(sha) as any;

  const [aiSummary, riskAnalysis] = await Promise.all([
    generateDeploySummary(commits || []).catch(() => null),
    previousDeploy
      ? (async () => {
          // Find repo from any project
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

  // Update database with AI results
  if (aiSummary || riskAnalysis) {
    ctx.db
      .prepare('UPDATE deployments SET ai_summary = ?, risk_level = ? WHERE sha = ?')
      .run(aiSummary, riskAnalysis?.level || null, sha);
  }

  // Build embed
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

  // Extract Linear IDs for closing
  const allText = commitMessages.join(' ');
  const linearIds = extractLinearIds(allText);
  if (linearIds.length > 0) {
    embed.addFields({ name: 'Issues fechadas', value: linearIds.join(', ') });
  }

  // Post to all project dev channels
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

  // Close Linear issues (if Linear module available)
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
```

- [ ] **Step 2: Register module in bot.ts**

In `src/bot.ts`, add import after line 20 (after autoBookmarkModule):
```typescript
import { deployModule } from './modules/deploy';
```

Add to modules array (after autoBookmarkModule, before the closing `]`):
```typescript
    deployModule,
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/deploy/index.ts src/bot.ts
git commit -m "feat: add deploy module — webhook, AI summary, risk analysis, Discord notifications"
```

---

## Chunk 3: Issue Lifecycle

### Task 11: Linear Module — Auto-Create Branch

**Files:**
- Modify: `src/modules/linear/index.ts:180` — add branch creation after issue creation

- [ ] **Step 1: Add branch creation logic**

In `src/modules/linear/index.ts`, after the null check for `created` (line 180), add before the embed construction:

```typescript
    // Auto-create branch on GitHub
    let branchName: string | null = null;
    if (project.github_repo) {
      const { generateBranchSlug } = await import('../../utils/linear-ids');
      const { createBranch } = await import('../../utils/github-api');
      const slug = generateBranchSlug(title);
      branchName = `feat/${created.identifier}-${slug}`;

      const branchCreated = await createBranch(
        project.github_repo,
        branchName,
        config.github.token,
      );

      if (branchCreated) {
        ctx.logger.info(`Branch created: ${branchName}`);
      } else {
        ctx.logger.warn(`Failed to create branch: ${branchName}`);
        branchName = null;
      }
    }
```

- [ ] **Step 2: Add branch info to the embed response**

In the embed construction (after the existing `.addFields`), add a conditional field:
```typescript
    if (branchName) {
      embed.addFields({ name: '🌿 Branch', value: `\`${branchName}\``, inline: false });
    }
```

- [ ] **Step 3: Add config import if not present**

Ensure `src/modules/linear/index.ts` imports config:
```typescript
import { config } from '../../config';
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/linear/index.ts
git commit -m "feat: auto-create GitHub branch when creating Linear issue via /task"
```

---

### Task 12: Linear Module — closeIssues Helper

**Files:**
- Modify: `src/modules/linear/index.ts` — export closeIssues function for deploy module

- [ ] **Step 1: Add Linear state cache**

Add at module scope in `src/modules/linear/index.ts` (after `let linearClient`):
```typescript
let stateCache: { states: Map<string, string>; fetchedAt: number } | null = null;

async function getTeamStates(teamId: string): Promise<Map<string, string>> {
  if (stateCache && Date.now() - stateCache.fetchedAt < 3600000) {
    return stateCache.states;
  }

  if (!linearClient) return new Map();

  const teams = await linearClient.teams({ filter: { id: { eq: teamId } } });
  const team = teams.nodes[0];
  if (!team) return new Map();

  const states = await team.states();
  const stateMap = new Map<string, string>();
  for (const state of states.nodes) {
    stateMap.set(state.name.toLowerCase(), state.id);
  }

  stateCache = { states: stateMap, fetchedAt: Date.now() };
  return stateMap;
}
```

- [ ] **Step 2: Add closeIssues function**

Add to the module (can be after the BotModule export or as a method accessible via `getModule`):
```typescript
async function closeIssues(identifiers: string[], comment: string): Promise<void> {
  if (!linearClient) return;

  for (const id of identifiers) {
    try {
      const issues = await linearClient.issueSearch(id);
      const issue = issues.nodes.find((i: any) => i.identifier === id);
      if (!issue) continue;

      const team = await issue.team;
      if (!team) continue;

      const states = await getTeamStates(team.id);
      const doneStateId = states.get('done');

      if (doneStateId) {
        await linearClient.updateIssue(issue.id, { stateId: doneStateId });
      }

      await linearClient.createComment({ issueId: issue.id, body: comment });
      ctx.logger.info(`Closed Linear issue ${id}`);
    } catch (error) {
      ctx.logger.error(`Failed to close issue ${id}:`, error);
    }
  }
}
```

- [ ] **Step 3: Expose closeIssues on the module export**

Add `closeIssues` as a property on the module object so deploy module can call it via `getModule`:
```typescript
export const linearModule: BotModule & { closeIssues: typeof closeIssues } = {
  // ... existing properties
  closeIssues,
  // ...
};
```

Alternatively, add it after the export:
```typescript
(linearModule as any).closeIssues = closeIssues;
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/linear/index.ts
git commit -m "feat: add closeIssues + Linear state cache for deploy integration"
```

---

### Task 13: GitHub Module — PR → Linear State Transitions

**Files:**
- Modify: `src/modules/github/index.ts:149-164` — expand pull_request handler

- [ ] **Step 1: Add imports at top of github module**

Add to imports in `src/modules/github/index.ts`:
```typescript
import { extractLinearIds } from '../../utils/linear-ids';
```

- [ ] **Step 2: Expand pull_request handler**

In `handleGitHubEvent`, replace the existing `pull_request` block (lines 149-164) with:

```typescript
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
  }
```

- [ ] **Step 3: Add moveIssuesToState to Linear module**

In `src/modules/linear/index.ts`, add a new function:
```typescript
async function moveIssuesToState(identifiers: string[], stateName: string): Promise<void> {
  if (!linearClient) return;

  for (const id of identifiers) {
    try {
      const issues = await linearClient.issueSearch(id);
      const issue = issues.nodes.find((i: any) => i.identifier === id);
      if (!issue) continue;

      const team = await issue.team;
      if (!team) continue;

      const states = await getTeamStates(team.id);
      const stateId = states.get(stateName.toLowerCase());

      if (stateId) {
        await linearClient.updateIssue(issue.id, { stateId });
        ctx.logger.info(`Moved ${id} to "${stateName}"`);
      }
    } catch (error) {
      ctx.logger.error(`Failed to move issue ${id} to "${stateName}":`, error);
    }
  }
}
```

Expose it on the module:
```typescript
(linearModule as any).moveIssuesToState = moveIssuesToState;
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: Compiles without errors.

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/github/index.ts src/modules/linear/index.ts
git commit -m "feat: PR opens → Linear 'In Review', PR merges → Linear 'Done'"
```

---

## Chunk 4: Register Commands + Final Verification

### Task 14: Register Deploy Commands

**Files:**
- Modify: `src/deploy-commands.ts` (if it doesn't auto-pick up from modules)

- [ ] **Step 1: Add deployModule to deploy-commands.ts**

In `src/deploy-commands.ts`, add import after line 13:
```typescript
import { deployModule } from './modules/deploy';
```

Add `deployModule` to the modules array (after `autoBookmarkModule`, before the closing `]`):
```typescript
  deployModule,
```

- [ ] **Step 2: Verify build + tests**

```bash
npm run build && npm test
```
Expected: Build OK, all tests pass.

- [ ] **Step 3: Commit if changes needed**

```bash
git add src/deploy-commands.ts
git commit -m "chore: register deploy commands"
```

---

### Task 15: Final Verification

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: No errors.

- [ ] **Step 2: Full test suite**

```bash
npm test
```
Expected: All tests pass.

- [ ] **Step 3: Lint check (if configured)**

```bash
npx tsc --noEmit
```
Expected: No type errors.

- [ ] **Step 4: Verify all files committed**

```bash
git status
```
Expected: Clean working tree.

---

## Post-Implementation: Manual Setup Required

After code is deployed, these one-time manual steps are needed:

1. **GitHub repo secrets:** Add `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DEPLOY_WEBHOOK_SECRET`, `WEBHOOK_URL`
2. **VPS `.env`:** Add `DEPLOY_WEBHOOK_SECRET=<same value as GitHub secret>`
3. **GitHub token scope:** Verify `GITHUB_TOKEN` has `contents:write` permission
4. **Register commands:** Run `npm run deploy-commands` on the VPS after first deploy
5. **Test webhook:** Push a test commit to main and verify the full pipeline fires
