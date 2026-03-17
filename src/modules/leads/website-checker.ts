import { createLogger } from '../../core/logger';

const logger = createLogger('leads:website-checker');

export interface WebsiteCheckResult {
  signals: string[];
  score_adjustment: number;
}

const SOCIAL_MEDIA_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'linkedin.com',
];

const SIGNAL_POINTS: Record<string, number> = {
  social_media_only: 2,
  no_https: 2,
  site_unreachable: 3,
  not_responsive: 1,
};

export function analyzeWebsiteUrl(url: string): WebsiteCheckResult {
  const signals: string[] = [];

  try {
    const parsed = new URL(url);

    // Check if it's a social media page, not a real website
    const hostname = parsed.hostname.replace('www.', '');
    if (SOCIAL_MEDIA_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
      signals.push('social_media_only');
    }

    // Check HTTPS
    if (parsed.protocol === 'http:') {
      signals.push('no_https');
    }
  } catch {
    signals.push('site_unreachable');
  }

  const score_adjustment = signals.reduce((sum, s) => sum + (SIGNAL_POINTS[s] || 0), 0);
  return { signals, score_adjustment };
}

export async function checkWebsite(url: string, timeoutMs: number = 5000): Promise<WebsiteCheckResult> {
  const urlSignals = analyzeWebsiteUrl(url);

  // If already flagged as social media, skip HTTP check
  if (urlSignals.signals.includes('social_media_only')) {
    return urlSignals;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      urlSignals.signals.push('site_unreachable');
      urlSignals.score_adjustment += SIGNAL_POINTS['site_unreachable'];
      return urlSignals;
    }

    // Check for viewport meta tag (responsiveness)
    const html = await response.text();
    const hasViewport = /meta\s+name=["']viewport["']/i.test(html);
    if (!hasViewport) {
      urlSignals.signals.push('not_responsive');
      urlSignals.score_adjustment += SIGNAL_POINTS['not_responsive'];
    }

    // Check if final URL redirected to social media
    const finalHostname = new URL(response.url).hostname.replace('www.', '');
    if (SOCIAL_MEDIA_DOMAINS.some(d => finalHostname === d || finalHostname.endsWith('.' + d))) {
      if (!urlSignals.signals.includes('social_media_only')) {
        urlSignals.signals.push('social_media_only');
        urlSignals.score_adjustment += SIGNAL_POINTS['social_media_only'];
      }
    }
  } catch (error) {
    if (!urlSignals.signals.includes('site_unreachable')) {
      urlSignals.signals.push('site_unreachable');
      urlSignals.score_adjustment += SIGNAL_POINTS['site_unreachable'];
    }
    logger.warn(`Website check failed for ${url}: ${error}`);
  }

  return urlSignals;
}
