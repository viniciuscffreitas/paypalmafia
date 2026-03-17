import { describe, it, expect } from 'vitest';
import { analyzeWebsiteUrl, type WebsiteCheckResult } from '../../../src/modules/leads/website-checker';

describe('analyzeWebsiteUrl', () => {
  it('detects social media URLs as social_media_only', () => {
    expect(analyzeWebsiteUrl('https://instagram.com/mybusiness').signals).toContain('social_media_only');
    expect(analyzeWebsiteUrl('https://www.facebook.com/mybusiness').signals).toContain('social_media_only');
    expect(analyzeWebsiteUrl('https://facebook.com/mybusiness').signals).toContain('social_media_only');
  });

  it('does not flag real websites as social_media_only', () => {
    expect(analyzeWebsiteUrl('https://mybusiness.com.br').signals).not.toContain('social_media_only');
  });

  it('detects HTTP-only as no_https from URL', () => {
    expect(analyzeWebsiteUrl('http://mybusiness.com').signals).toContain('no_https');
  });

  it('returns empty signals for healthy HTTPS site', () => {
    expect(analyzeWebsiteUrl('https://mybusiness.com.br').signals).toEqual([]);
    expect(analyzeWebsiteUrl('https://mybusiness.com.br').score_adjustment).toBe(0);
  });

  it('calculates score_adjustment from signals', () => {
    const result = analyzeWebsiteUrl('https://instagram.com/mybiz');
    expect(result.score_adjustment).toBe(2); // social_media_only = +2
  });
});
