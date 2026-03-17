import { describe, it, expect } from 'vitest';
import { scoreLead, applyWebsiteCheck, scoreLeadFromDb } from '../../../src/modules/leads/scorer';
import type { PlaceResult, Lead } from '../../../src/modules/leads/types';

function makeLead(overrides: Partial<PlaceResult> = {}): PlaceResult {
  return {
    place_id: 'test-place-1',
    name: 'Test Business',
    address: 'Rua Test, 123',
    phone: '+5511999999999',
    website: 'https://example.com',
    google_maps_url: 'https://maps.google.com/?cid=123',
    photo_url: null,
    rating: 4.0,
    review_count: 50,
    category: 'restaurant',
    reviews: [],
    ...overrides,
  };
}

describe('scoreLead', () => {
  it('scores 0 for a lead with website, HTTPS, good rating, many reviews', () => {
    const result = scoreLead(makeLead());
    expect(result.total).toBe(0);
    expect(result.signals).toHaveLength(0);
  });

  // Behavior Contract: score 0 = healthy lead, no recommendation
  it('recommends "none" for a lead with score 0 (healthy digital presence)', () => {
    const result = scoreLead(makeLead());
    expect(result.total).toBe(0);
    expect(result.recommended_service).toBe('none');
  });

  it('recommends "none" for high-volume established business with HTTPS website', () => {
    const result = scoreLead(makeLead({ review_count: 200, rating: 4.8, website: 'https://ok.com' }));
    expect(result.total).toBe(0);
    expect(result.recommended_service).toBe('none');
  });

  it('recommends Brand Authority for lead with only few_reviews signal', () => {
    const result = scoreLead(makeLead({ review_count: 5 }));
    expect(result.signals).toContain('few_reviews');
    expect(result.recommended_service).toBe('vibe-web Brand Authority');
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

  // This test previously expected 'vinicius.xyz Automation & Integration' but
  // a lead with score 0 (no negative signals) should not get a service recommendation
  it('recommends "none" for high-volume established business (regression from original bug)', () => {
    const result = scoreLead(makeLead({ review_count: 200, rating: 4.8, website: 'https://ok.com' }));
    expect(result.recommended_service).toBe('none');
  });
});

describe('applyWebsiteCheck', () => {
  it('adds website signals and adjusts score', () => {
    const base = { total: 2, signals: ['no_https'], recommended_service: 'vibe-web Brand Authority' };
    const result = applyWebsiteCheck(base, ['not_responsive'], 1);
    expect(result.total).toBe(3);
    expect(result.signals).toContain('no_https');
    expect(result.signals).toContain('not_responsive');
  });

  it('returns none if total stays 0', () => {
    const base = { total: 0, signals: [], recommended_service: 'none' };
    const result = applyWebsiteCheck(base, [], 0);
    expect(result.recommended_service).toBe('none');
  });
});

describe('scoreLeadFromDb', () => {
  function makeDbLead(overrides: Partial<Lead> = {}): Lead {
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
      google_maps_url: 'https://maps.google.com/?cid=123',
      photo_url: null,
      region: 'São Paulo',
      score: 0,
      recommended_service: 'none',
      ai_analysis: null,
      ai_pitch: null,
      status: 'new',
      found_at: new Date().toISOString(),
      contacted_at: null,
      ...overrides,
    };
  }

  it('re-scores a lead from DB data', () => {
    const lead = makeDbLead({ website: null, rating: 4.5, review_count: 100 });
    const result = scoreLeadFromDb(lead);
    expect(result.total).toBeGreaterThanOrEqual(7);
    expect(result.signals).toContain('no_website');
    expect(result.recommended_service).toBe('vibe-web Essential Landing');
  });

  it('returns score 0 and none for healthy lead', () => {
    const lead = makeDbLead();
    const result = scoreLeadFromDb(lead);
    expect(result.total).toBe(0);
    expect(result.recommended_service).toBe('none');
  });

  it('detects score change when lead loses website', () => {
    const withSite = makeDbLead({ score: 0 });
    const withoutSite = makeDbLead({ website: null, score: 0 });
    const scoreWith = scoreLeadFromDb(withSite);
    const scoreWithout = scoreLeadFromDb(withoutSite);
    expect(scoreWithout.total).toBeGreaterThan(scoreWith.total);
  });
});
