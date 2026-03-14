import { describe, it, expect } from 'vitest';
import { buildContextBlock } from '../../src/core/ai-status';
import type { GitHubProjectStatus } from '../../src/utils/github-status';
import type { LinearProjectStatus } from '../../src/utils/linear-status';

function makeGitHubStatus(overrides?: Partial<GitHubProjectStatus>): GitHubProjectStatus {
  return {
    repo: {
      name: 'user/fitcheck',
      description: 'A fitness app',
      language: 'TypeScript',
      stars: 5,
      forks: 1,
      openIssuesCount: 3,
      url: 'https://github.com/user/fitcheck',
    },
    languages: { TypeScript: 45000, CSS: 12000, JavaScript: 3000 },
    recentCommits: [
      { sha: 'abc1234', message: 'feat: add login page', author: 'vini', date: '2026-03-14T10:00:00Z', url: 'https://github.com/user/fitcheck/commit/abc1234' },
      { sha: 'def5678', message: 'fix: button alignment', author: 'vini', date: '2026-03-13T09:00:00Z', url: 'https://github.com/user/fitcheck/commit/def5678' },
    ],
    commitActivity: [
      { weekTimestamp: 1710100000, total: 5, days: [0, 1, 2, 0, 1, 1, 0] },
      { weekTimestamp: 1710700000, total: 8, days: [1, 2, 1, 1, 1, 2, 0] },
    ],
    codeFrequency: [
      { weekTimestamp: 1710100000, additions: 200, deletions: 50 },
      { weekTimestamp: 1710700000, additions: 350, deletions: 120 },
    ],
    contributors: [
      { login: 'vini', totalCommits: 42, recentCommits: 12, avatarUrl: '' },
    ],
    branches: [
      { name: 'main', protected: true, lastCommitSha: 'abc1234' },
      { name: 'feat/login', protected: false, lastCommitSha: 'def5678' },
    ],
    pullRequests: {
      open: [
        { number: 5, title: 'Add auth flow', author: 'vini', createdAt: '2026-03-14', url: 'https://github.com/user/fitcheck/pull/5', additions: 120, deletions: 30, reviewState: null },
      ],
      recentlyMerged: [
        { number: 4, title: 'Setup CI', author: 'vini', mergedAt: '2026-03-12', url: 'https://github.com/user/fitcheck/pull/4' },
      ],
    },
    ciStatus: {
      lastRun: { name: 'CI', status: 'completed', conclusion: 'success', createdAt: '2026-03-14', url: 'https://github.com/user/fitcheck/actions/runs/1' },
      recentSuccessRate: 90,
    },
    latestRelease: {
      tagName: 'v0.1.0',
      name: 'Initial Release',
      publishedAt: '2026-03-10',
      url: 'https://github.com/user/fitcheck/releases/tag/v0.1.0',
      body: 'First release',
    },
    ...overrides,
  };
}

function makeLinearStatus(overrides?: Partial<LinearProjectStatus>): LinearProjectStatus {
  return {
    team: { name: 'FitCheck', key: 'FIT', memberCount: 2 },
    members: [
      { name: 'Vini', displayName: 'Vini', email: 'v@test.com', active: true },
    ],
    issuesByState: [
      {
        state: 'In Progress',
        type: 'started',
        count: 2,
        issues: [
          { identifier: 'FIT-1', title: 'Login flow', priority: 2, priorityLabel: 'High', assignee: 'Vini', estimate: 3, dueDate: null, url: 'https://linear.app/fit/issue/FIT-1', labels: ['feature'], createdAt: '2026-03-10T00:00:00Z', updatedAt: '2026-03-14T00:00:00Z' },
          { identifier: 'FIT-2', title: 'Dashboard UI', priority: 3, priorityLabel: 'Medium', assignee: null, estimate: 5, dueDate: null, url: 'https://linear.app/fit/issue/FIT-2', labels: ['feature', 'ux'], createdAt: '2026-03-11T00:00:00Z', updatedAt: '2026-03-13T00:00:00Z' },
        ],
      },
      {
        state: 'Backlog',
        type: 'backlog',
        count: 3,
        issues: [
          { identifier: 'FIT-3', title: 'Push notifications', priority: 4, priorityLabel: 'Low', assignee: null, estimate: 8, dueDate: null, url: 'https://linear.app/fit/issue/FIT-3', labels: ['feature'], createdAt: '2026-03-09T00:00:00Z', updatedAt: '2026-03-09T00:00:00Z' },
        ],
      },
    ],
    activeCycle: {
      name: 'Sprint 1',
      number: 1,
      startsAt: '2026-03-10T00:00:00Z',
      endsAt: '2026-03-24T00:00:00Z',
      progress: 0.4,
      scopeTotal: 16,
      scopeCompleted: 6,
      issuesTotal: 5,
      issuesCompleted: 2,
      issuesInProgress: 2,
      completedScopeHistory: [0, 2, 4, 6],
      scopeHistory: [10, 12, 14, 16],
    },
    upcomingCycle: { name: 'Sprint 2', number: 2, startsAt: '2026-03-24T00:00:00Z', endsAt: '2026-04-07T00:00:00Z' },
    projects: [
      {
        name: 'FitCheck MVP',
        state: 'started',
        progress: 0.25,
        url: 'https://linear.app/fit/project/mvp',
        lead: 'Vini',
        targetDate: '2026-04-30',
        milestones: [
          { name: 'Auth done', targetDate: '2026-03-20', sortOrder: 1 },
          { name: 'Beta launch', targetDate: '2026-04-15', sortOrder: 2 },
        ],
      },
    ],
    labels: [
      { name: 'feature', color: '#00ff00', issueCount: 4 },
      { name: 'bug', color: '#ff0000', issueCount: 1 },
    ],
    velocity: { completedLastWeek: 3, completedThisWeek: 2, avgPointsPerCycle: 8 },
    blockers: [
      { identifier: 'FIT-99', title: 'API rate limit issue', assignee: 'Vini', daysSinceUpdate: 5, url: 'https://linear.app/fit/issue/FIT-99' },
    ],
    ...overrides,
  };
}

describe('buildContextBlock', () => {
  it('includes project name', () => {
    const result = buildContextBlock('fitcheck', null, null, null);
    expect(result).toContain('# Projeto: fitcheck');
  });

  it('includes GitHub repo info when provided', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('user/fitcheck');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Stars: 5');
  });

  it('includes GitHub contributors', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('vini');
    expect(result).toContain('42 commits total');
    expect(result).toContain('12 nas últimas 4 semanas');
  });

  it('includes GitHub recent commits', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('abc1234');
    expect(result).toContain('feat: add login page');
  });

  it('includes GitHub language percentages', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('TypeScript: 75%');
    expect(result).toContain('CSS: 20%');
  });

  it('includes GitHub PR info', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('#5: Add auth flow');
    expect(result).toContain('+120 -30');
    expect(result).toContain('#4: Setup CI');
  });

  it('includes GitHub CI status', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('CI');
    expect(result).toContain('success');
    expect(result).toContain('90%');
  });

  it('includes code churn data', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('+550');
    expect(result).toContain('-170');
  });

  it('includes GitHub branches', () => {
    const gh = makeGitHubStatus();
    const result = buildContextBlock('fitcheck', gh, null, null);

    expect(result).toContain('main');
    expect(result).toContain('feat/login');
    expect(result).toContain('protegida');
  });

  it('includes Linear team info when provided', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('FitCheck');
    expect(result).toContain('FIT');
    expect(result).toContain('2 membros');
  });

  it('includes Linear issues by state', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('In Progress (2)');
    expect(result).toContain('FIT-1: Login flow');
    expect(result).toContain('FIT-2: Dashboard UI');
    expect(result).toContain('Backlog (3)');
  });

  it('includes Linear issue metadata (priority, estimate, labels)', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('[3pts]');
    expect(result).toContain('{feature}');
    expect(result).toContain('→ Vini');
    expect(result).toContain('P2');
  });

  it('includes Linear active cycle', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('Sprint 1');
    expect(result).toContain('40%');
    expect(result).toContain('6/16 pontos');
    expect(result).toContain('2 done');
    expect(result).toContain('2 in progress');
  });

  it('includes Linear upcoming cycle', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('Sprint 2');
  });

  it('includes Linear projects and milestones', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('FitCheck MVP');
    expect(result).toContain('25%');
    expect(result).toContain('Auth done');
    expect(result).toContain('Beta launch');
    expect(result).toContain('2026-04-30');
  });

  it('includes Linear velocity', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('esta semana: 2');
    expect(result).toContain('semana passada: 3');
    expect(result).toContain('8 pontos');
  });

  it('includes Linear blockers', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('FIT-99');
    expect(result).toContain('API rate limit issue');
    expect(result).toContain('5 dias sem update');
  });

  it('includes Linear labels', () => {
    const linear = makeLinearStatus();
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('feature: 4 issues');
    expect(result).toContain('bug: 1 issues');
  });

  it('includes local metrics when provided', () => {
    const metrics = { commits7d: 15, issues7d: 4, prs7d: 2, prevCommits7d: 10 };
    const result = buildContextBlock('fitcheck', null, null, metrics);

    expect(result).toContain('Commits: 15');
    expect(result).toContain('anterior: 10');
    expect(result).toContain('Issues fechadas: 4');
    expect(result).toContain('PRs merged: 2');
  });

  it('combines all sources in a single context', () => {
    const gh = makeGitHubStatus();
    const linear = makeLinearStatus();
    const metrics = { commits7d: 15, issues7d: 4, prs7d: 2, prevCommits7d: 10 };
    const result = buildContextBlock('fitcheck', gh, linear, metrics);

    expect(result).toContain('## GitHub');
    expect(result).toContain('## Linear');
    expect(result).toContain('## Métricas Locais');
  });

  it('handles null GitHub gracefully', () => {
    const result = buildContextBlock('fitcheck', null, null, null);
    expect(result).not.toContain('## GitHub');
  });

  it('handles null Linear gracefully', () => {
    const result = buildContextBlock('fitcheck', null, null, null);
    expect(result).not.toContain('## Linear');
  });

  it('handles empty contributors list', () => {
    const gh = makeGitHubStatus({ contributors: [] });
    const result = buildContextBlock('fitcheck', gh, null, null);
    expect(result).not.toContain('### Contribuidores');
  });

  it('handles no active cycle', () => {
    const linear = makeLinearStatus({ activeCycle: null });
    const result = buildContextBlock('fitcheck', null, linear, null);
    expect(result).not.toContain('### Sprint Atual');
  });

  it('handles no blockers', () => {
    const linear = makeLinearStatus({ blockers: [] });
    const result = buildContextBlock('fitcheck', null, linear, null);
    expect(result).not.toContain('Blockers Detectados');
  });

  it('truncates issues list beyond 5 with count', () => {
    const manyIssues = Array.from({ length: 8 }, (_, i) => ({
      identifier: `FIT-${i}`,
      title: `Issue ${i}`,
      priority: 3,
      priorityLabel: 'Medium',
      assignee: null,
      estimate: 2,
      dueDate: null,
      url: `https://linear.app/fit/issue/FIT-${i}`,
      labels: [],
      createdAt: '2026-03-10T00:00:00Z',
      updatedAt: '2026-03-10T00:00:00Z',
    }));

    const linear = makeLinearStatus({
      issuesByState: [{ state: 'Backlog', type: 'backlog', count: 8, issues: manyIssues }],
    });
    const result = buildContextBlock('fitcheck', null, linear, null);

    expect(result).toContain('e mais 3 issues');
  });
});
