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
    const mainRef = await fetch(
      `https://api.github.com/repos/${repo}/git/refs/heads/main`,
      { headers },
    );
    if (!mainRef.ok) return false;
    const mainData = await mainRef.json();
    const sha = mainData.object.sha;

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
