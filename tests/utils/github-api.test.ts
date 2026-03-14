import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBranch, fetchCompareDiffs } from '../../src/utils/github-api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createBranch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls GitHub API with correct params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ object: { sha: 'abc123' } }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ref: 'refs/heads/feat/PM-1-test' }),
    });

    const result = await createBranch('owner/repo', 'feat/PM-1-test', 'ghp_token');
    expect(result).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/owner/repo/git/refs/heads/main'
    );
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
