export function extractLinearIds(text: string, teamPrefix?: string): string[] {
  const pattern = teamPrefix
    ? new RegExp(`${teamPrefix}-\\d+`, 'g')
    : /(?<![A-Z])[A-Z]{2,5}-\d+/g;
  const matches = text.match(pattern);
  return matches ? [...new Set(matches)] : [];
}

export function generateBranchSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-|-$/g, '');
}
