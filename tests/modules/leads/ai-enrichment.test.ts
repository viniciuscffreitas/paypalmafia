import { describe, it, expect } from 'vitest';
import { buildAnalysisPrompt, parseAiResponse } from '../../../src/modules/leads/ai-enrichment';
import type { PlaceResult, ScoreResult } from '../../../src/modules/leads/types';

describe('buildAnalysisPrompt', () => {
  it('includes place name, category, rating, and website', () => {
    const place: PlaceResult = {
      place_id: 'test',
      name: 'Clínica Sorriso',
      address: 'Rua A, 100',
      phone: '11999999999',
      website: 'http://clinicasorriso.com.br',
      google_maps_url: 'https://maps.google.com/?cid=456',
      photo_url: null,
      rating: 4.5,
      review_count: 230,
      category: 'Dentist',
      reviews: [],
    };
    const score: ScoreResult = {
      total: 6,
      signals: ['no_https'],
      recommended_service: 'vibe-web Brand Authority',
    };

    const prompt = buildAnalysisPrompt(place, score);
    expect(prompt).toContain('Clínica Sorriso');
    expect(prompt).toContain('4.5');
    expect(prompt).toContain('230');
    expect(prompt).toContain('http://clinicasorriso.com.br');
    expect(prompt).toContain('vibe-web Brand Authority');
  });

  it('handles place with no website', () => {
    const place: PlaceResult = {
      place_id: 'test',
      name: 'Padaria Central',
      address: null,
      phone: null,
      website: null,
      google_maps_url: null,
      photo_url: null,
      rating: 4.0,
      review_count: 80,
      category: 'Bakery',
      reviews: [],
    };
    const score: ScoreResult = {
      total: 10,
      signals: ['no_website', 'good_rating_no_website', 'established_no_website'],
      recommended_service: 'vibe-web Essential Landing',
    };

    const prompt = buildAnalysisPrompt(place, score);
    expect(prompt).toContain('nenhum');
    expect(prompt).toContain('vibe-web Essential Landing');
  });
  it('includes reviews in prompt when available', () => {
    const place: PlaceResult = {
      place_id: 'test', name: 'Test', address: null, phone: null,
      website: null, google_maps_url: null, photo_url: null,
      rating: 4.0, review_count: 10, category: 'Dentist',
      reviews: ['Site não funciona', 'Ótimo dentista'],
    };
    const score: ScoreResult = { total: 4, signals: ['no_website'], recommended_service: 'vibe-web Essential Landing' };
    const prompt = buildAnalysisPrompt(place, score);
    expect(prompt).toContain('Site não funciona');
    expect(prompt).toContain('Ótimo dentista');
  });
});

describe('parseAiResponse', () => {
  it('extracts analysis and pitch from well-formatted response', () => {
    const raw = `ANÁLISE: Site usa template antigo WordPress, não é responsivo, sem SSL.
PITCH: Vi que a Clínica Sorriso tem ótimas avaliações — posso modernizar o site em 5 dias.`;

    const result = parseAiResponse(raw);
    expect(result.analysis).toContain('template antigo');
    expect(result.pitch).toContain('Clínica Sorriso');
  });

  it('handles unstructured response gracefully', () => {
    const raw = 'This business needs a website redesign. I would approach them about mobile optimization.';
    const result = parseAiResponse(raw);
    expect(result.analysis).toBeTruthy();
    expect(result.pitch).toBeTruthy();
  });
});
