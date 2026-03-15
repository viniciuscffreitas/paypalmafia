import { describe, it, expect } from 'vitest';
import { sanitizeAiTitle } from '../../src/core/ai';

describe('sanitizeAiTitle', () => {
  it('returns the AI result when valid', () => {
    expect(sanitizeAiTitle('Adicionar Login com Google', 'original')).toBe('Adicionar Login com Google');
  });

  it('falls back to original when AI returns empty string', () => {
    expect(sanitizeAiTitle('', 'original')).toBe('original');
  });

  it('falls back to original when AI returns only whitespace', () => {
    expect(sanitizeAiTitle('   \n  ', 'original')).toBe('original');
  });

  it('strips leading/trailing whitespace from AI result', () => {
    expect(sanitizeAiTitle('  Título Limpo  ', 'original')).toBe('Título Limpo');
  });

  it('strips markdown bold from AI result', () => {
    expect(sanitizeAiTitle('**Título em Bold**', 'original')).toBe('Título em Bold');
  });

  it('strips markdown heading from AI result', () => {
    expect(sanitizeAiTitle('# Título com Hash', 'original')).toBe('Título com Hash');
  });

  it('strips inline code from AI result', () => {
    expect(sanitizeAiTitle('`Título com Backtick`', 'original')).toBe('Título com Backtick');
  });

  it('truncates title longer than 120 chars', () => {
    const long = 'A'.repeat(130);
    const result = sanitizeAiTitle(long, 'original');
    expect(result.length).toBeLessThanOrEqual(120);
  });

  it('uses only the first line when AI returns multi-line response', () => {
    const multiLine = 'Título Real\nLinha extra\nMais uma linha';
    expect(sanitizeAiTitle(multiLine, 'original')).toBe('Título Real');
  });

  it('strips surrounding double quotes from AI result', () => {
    expect(sanitizeAiTitle('"Título entre aspas"', 'original')).toBe('Título entre aspas');
  });

  it('strips surrounding curly quotes from AI result', () => {
    expect(sanitizeAiTitle('\u201cTítulo com aspas tipográficas\u201d', 'original')).toBe('Título com aspas tipográficas');
  });
});
