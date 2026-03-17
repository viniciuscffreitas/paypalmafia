import { describe, it, expect } from 'vitest';
import { scoreLead } from '../../../src/modules/leads/scorer';
import type { PlaceResult } from '../../../src/modules/leads/types';

function makeLead(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    place_id: 'test-place-1',
    name: 'Test Business',
    address: 'Rua Test, 123',
    phone: '+5511999999999',
    website: 'https://example.com',
    rating: 4.0,
    review_count: 50,
    category: 'restaurant',
    ...overrides,
  };
}

describe('scoreLead', () => {
  it('scores 0 for a lead with website, HTTPS, good rating, many reviews', () => {
    const result = scoreLead(makeLead());
    expect(result.total).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  it('adds +4 for no website', () => {
    const result = scoreLead(makeLead({ website: null }));
    expect(result.total).toBeGreaterThanOrEqual(4);
    expect(result.signals).toContain('no_website');
  });

  it('adds +2 for HTTP without HTTPS', () => {
    const result = scoreLead(makeLead({ website: 'http://example.com' }));
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.signals).toContain('no_https');
  });

  it('adds +2 for few reviews (< 10)', () => {
    const result = scoreLead(makeLead({ review_count: 5 }));
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.signals).toContain('few_reviews');
  });

  it('adds +1 for low rating (< 3.5)', () => {
    const result = scoreLead(makeLead({ rating: 3.0 }));
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.signals).toContain('low_rating');
  });

  it('adds bonus +3 for good rating + no website', () => {
    const result = scoreLead(makeLead({ website: null, rating: 4.5 }));
    expect(result.signals).toContain('good_rating_no_website');
    expect(result.total).toBeGreaterThanOrEqual(7);
  });

  it('adds bonus +3 for many reviews (50+) + no website', () => {
    const result = scoreLead(makeLead({ website: null, review_count: 60 }));
    expect(result.signals).toContain('established_no_website');
    expect(result.total).toBeGreaterThanOrEqual(7);
  });

  it('recommends Essential Landing for no website', () => {
    const result = scoreLead(makeLead({ website: null, rating: 3.0, review_count: 3 }));
    expect(result.recommended_service).toBe('vibe-web Essential Landing');
  });

  it('recommends Brand Authority for HTTP-only website', () => {
    const result = scoreLead(makeLead({ website: 'http://old-site.com' }));
    expect(result.recommended_service).toBe('vibe-web Brand Authority');
  });

  it('recommends vinicius.xyz Automation for high-volume established business with website', () => {
    const result = scoreLead(makeLead({ review_count: 200, rating: 4.8, website: 'https://ok.com' }));
    expect(result.recommended_service).toBe('vinicius.xyz Automation & Integration');
  });
});
