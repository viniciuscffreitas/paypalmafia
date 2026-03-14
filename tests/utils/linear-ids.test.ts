import { describe, it, expect } from 'vitest';
import { extractLinearIds } from '../../src/utils/linear-ids';
import { generateBranchSlug } from '../../src/utils/linear-ids';

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
