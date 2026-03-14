import { createLogger } from '../core/logger';

const logger = createLogger('github-status');

export interface GitHubProjectStatus {
  repo: {
    name: string;
    description: string | null;
    language: string | null;
    stars: number;
    forks: number;
    openIssuesCount: number;
    url: string;
  };
  languages: Record<string, number>;
  recentCommits: {
    sha: string;
    message: string;
    author: string;
    date: string;
    url: string;
  }[];
  commitActivity: {
    weekTimestamp: number;
    total: number;
    days: number[];
  }[];
  codeFrequency: {
    weekTimestamp: number;
    additions: number;
    deletions: number;
  }[];
  contributors: {
    login: string;
    totalCommits: number;
    recentCommits: number; // last 4 weeks
    avatarUrl: string;
  }[];
  branches: {
    name: string;
    protected: boolean;
    lastCommitSha: string;
  }[];
  pullRequests: {
    open: {
      number: number;
      title: string;
      author: string;
      createdAt: string;
      url: string;
      additions: number;
      deletions: number;
      reviewState: string | null;
    }[];
    recentlyMerged: {
      number: number;
      title: string;
      author: string;
      mergedAt: string;
      url: string;
    }[];
  };
  ciStatus: {
    lastRun: {
      name: string;
      status: string;
      conclusion: string | null;
      createdAt: string;
      url: string;
    } | null;
    recentSuccessRate: number; // percentage of last 10 runs
  };
  latestRelease: {
    tagName: string;
    name: string;
    publishedAt: string;
    url: string;
    body: string | null;
  } | null;
}

async function ghFetch(path: string, token: string): Promise<any | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (!res.ok) {
      if (res.status === 202) {
        // Stats endpoints return 202 when computing — retry once after delay
        await new Promise((r) => setTimeout(r, 2000));
        const retry = await fetch(`https://api.github.com${path}`, { headers });
        if (!retry.ok) return null;
        return retry.json();
      }
      return null;
    }
    return res.json();
  } catch (err) {
    logger.warn(`GitHub API error for ${path}:`, err);
    return null;
  }
}

export async function fetchGitHubProjectStatus(
  repo: string,
  token: string,
): Promise<GitHubProjectStatus | null> {
  if (!repo || !token) return null;

  try {
    // Parallel fetch all endpoints
    const [
      repoData,
      languages,
      commits,
      commitActivity,
      codeFrequency,
      contributors,
      branches,
      openPRs,
      mergedPRs,
      actionRuns,
      latestRelease,
    ] = await Promise.all([
      ghFetch(`/repos/${repo}`, token),
      ghFetch(`/repos/${repo}/languages`, token),
      ghFetch(`/repos/${repo}/commits?per_page=15`, token),
      ghFetch(`/repos/${repo}/stats/commit_activity`, token),
      ghFetch(`/repos/${repo}/stats/code_frequency`, token),
      ghFetch(`/repos/${repo}/stats/contributors`, token),
      ghFetch(`/repos/${repo}/branches?per_page=20`, token),
      ghFetch(`/repos/${repo}/pulls?state=open&per_page=10&sort=updated&direction=desc`, token),
      ghFetch(`/repos/${repo}/pulls?state=closed&per_page=5&sort=updated&direction=desc`, token),
      ghFetch(`/repos/${repo}/actions/runs?per_page=10`, token),
      ghFetch(`/repos/${repo}/releases/latest`, token),
    ]);

    if (!repoData) {
      logger.warn(`Could not fetch repo data for ${repo}`);
      return null;
    }

    // Process contributors — calculate recent activity (last 4 weeks)
    const processedContributors = Array.isArray(contributors)
      ? contributors
          .map((c: any) => {
            const weeks = c.weeks || [];
            const recentWeeks = weeks.slice(-4);
            const recentCommits = recentWeeks.reduce((sum: number, w: any) => sum + (w.c || 0), 0);
            return {
              login: c.author?.login || 'unknown',
              totalCommits: c.total || 0,
              recentCommits,
              avatarUrl: c.author?.avatar_url || '',
            };
          })
          .sort((a: any, b: any) => b.recentCommits - a.recentCommits)
      : [];

    // Process commit activity (last 12 weeks)
    const processedCommitActivity = Array.isArray(commitActivity)
      ? commitActivity.slice(-12).map((w: any) => ({
          weekTimestamp: w.week,
          total: w.total,
          days: w.days,
        }))
      : [];

    // Process code frequency (last 12 weeks)
    const processedCodeFrequency = Array.isArray(codeFrequency)
      ? codeFrequency.slice(-12).map((w: any) => ({
          weekTimestamp: w[0],
          additions: w[1],
          deletions: Math.abs(w[2]),
        }))
      : [];

    // Process branches
    const processedBranches = Array.isArray(branches)
      ? branches.map((b: any) => ({
          name: b.name,
          protected: b.protected || false,
          lastCommitSha: b.commit?.sha?.slice(0, 7) || '',
        }))
      : [];

    // Process open PRs
    const processedOpenPRs = Array.isArray(openPRs)
      ? openPRs.map((pr: any) => ({
          number: pr.number,
          title: pr.title,
          author: pr.user?.login || 'unknown',
          createdAt: pr.created_at,
          url: pr.html_url,
          additions: pr.additions || 0,
          deletions: pr.deletions || 0,
          reviewState: pr.draft ? 'draft' : null,
        }))
      : [];

    // Process recently merged PRs
    const processedMergedPRs = Array.isArray(mergedPRs)
      ? mergedPRs
          .filter((pr: any) => pr.merged_at)
          .map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            author: pr.user?.login || 'unknown',
            mergedAt: pr.merged_at,
            url: pr.html_url,
          }))
      : [];

    // Process CI status
    let ciStatus: GitHubProjectStatus['ciStatus'] = { lastRun: null, recentSuccessRate: 0 };
    if (actionRuns?.workflow_runs?.length > 0) {
      const runs = actionRuns.workflow_runs;
      const lastRun = runs[0];
      const completedRuns = runs.filter((r: any) => r.conclusion);
      const successRuns = completedRuns.filter((r: any) => r.conclusion === 'success');
      ciStatus = {
        lastRun: {
          name: lastRun.name,
          status: lastRun.status,
          conclusion: lastRun.conclusion,
          createdAt: lastRun.created_at,
          url: lastRun.html_url,
        },
        recentSuccessRate: completedRuns.length > 0
          ? Math.round((successRuns.length / completedRuns.length) * 100)
          : 0,
      };
    }

    // Process recent commits
    const processedCommits = Array.isArray(commits)
      ? commits.map((c: any) => ({
          sha: c.sha.slice(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author?.name || c.author?.login || 'unknown',
          date: c.commit.author?.date || '',
          url: c.html_url,
        }))
      : [];

    return {
      repo: {
        name: repoData.full_name,
        description: repoData.description,
        language: repoData.language,
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        openIssuesCount: repoData.open_issues_count || 0,
        url: repoData.html_url,
      },
      languages: languages || {},
      recentCommits: processedCommits,
      commitActivity: processedCommitActivity,
      codeFrequency: processedCodeFrequency,
      contributors: processedContributors,
      branches: processedBranches,
      pullRequests: {
        open: processedOpenPRs,
        recentlyMerged: processedMergedPRs,
      },
      ciStatus,
      latestRelease: latestRelease?.tag_name
        ? {
            tagName: latestRelease.tag_name,
            name: latestRelease.name || latestRelease.tag_name,
            publishedAt: latestRelease.published_at,
            url: latestRelease.html_url,
            body: latestRelease.body?.slice(0, 500) || null,
          }
        : null,
    };
  } catch (error) {
    logger.error('Failed to fetch GitHub project status:', error);
    return null;
  }
}
