import { describe, it, expect } from 'vitest';
import { extractTldr } from '../../src/modules/linear/task-preview';

describe('extractTldr', () => {
  it('extracts TL;DR from description', () => {
    const desc = '## TL;DR\nUma frase resumindo o objetivo.\n\n## Context\n- Algo';
    expect(extractTldr(desc)).toBe('Uma frase resumindo o objetivo.');
  });

  it('handles TLDR without semicolon', () => {
    const desc = '## TLDR\nOutra frase.\n\n## Context';
    expect(extractTldr(desc)).toBe('Outra frase.');
  });

  it('returns empty string when no TL;DR section', () => {
    const desc = '## Context\n- Algo\n\n## Acceptance Criteria\n- [ ] Feito';
    expect(extractTldr(desc)).toBe('');
  });

  it('returns empty string for empty description', () => {
    expect(extractTldr('')).toBe('');
  });

  it('trims whitespace from extracted line', () => {
    const desc = '## TL;DR\n   Frase com espaços.   \n\n## Context';
    expect(extractTldr(desc)).toBe('Frase com espaços.');
  });
});
