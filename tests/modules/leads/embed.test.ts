import { describe, it, expect } from 'vitest';
import { buildLeadEmbedData } from '../../../src/modules/leads/index';
import type { Lead } from '../../../src/modules/leads/types';

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 1,
    place_id: 'test-1',
    name: 'Test Business',
    address: 'Rua Test, 123',
    phone: '+5511999999999',
    website: 'https://example.com',
    rating: 4.0,
    review_count: 50,
    category: 'restaurant',
    region: 'São Paulo',
    score: 6,
    recommended_service: 'vibe-web Brand Authority',
    ai_analysis: null,
    ai_pitch: null,
    status: 'new',
    found_at: new Date().toISOString(),
    contacted_at: null,
    ...overrides,
  };
}

describe('buildLeadEmbedData', () => {
  it('includes name, address, rating, website, score, and service', () => {
    const data = buildLeadEmbedData(makeLead());
    expect(data.title).toBe('Test Business');
    expect(data.description).toContain('Rua Test, 123');
    expect(data.description).toContain('4');
    expect(data.description).toContain('https://example.com');
    expect(data.description).toContain('6');
    expect(data.description).toContain('vibe-web Brand Authority');
  });

  it('shows "Sem website" when website is null', () => {
    const data = buildLeadEmbedData(makeLead({ website: null }));
    expect(data.description).toContain('Sem website');
  });

  it('includes AI analysis and pitch when present', () => {
    const data = buildLeadEmbedData(makeLead({
      ai_analysis: 'Site antigo sem responsividade',
      ai_pitch: 'Posso ajudar com um site moderno',
    }));
    expect(data.fields).toContainEqual(
      expect.objectContaining({ name: expect.stringContaining('Análise') })
    );
    expect(data.fields).toContainEqual(
      expect.objectContaining({ name: expect.stringContaining('Pitch') })
    );
  });

  it('uses red color for score >= 10', () => {
    const data = buildLeadEmbedData(makeLead({ score: 12 }));
    expect(data.color).toBe(0xff6b6b);
  });

  it('uses yellow color for score >= 7', () => {
    const data = buildLeadEmbedData(makeLead({ score: 8 }));
    expect(data.color).toBe(0xf2c94c);
  });

  it('uses blue color for score < 7', () => {
    const data = buildLeadEmbedData(makeLead({ score: 3 }));
    expect(data.color).toBe(0x5865f2);
  });
});
