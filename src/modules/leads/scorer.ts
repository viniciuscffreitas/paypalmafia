import type { PlaceResult, ScoreResult } from './types';

interface Signal {
  name: string;
  points: number;
  test: (lead: PlaceResult) => boolean;
}

const SIGNALS: Signal[] = [
  { name: 'no_website', points: 4, test: (l) => !l.website },
  { name: 'no_https', points: 2, test: (l) => !!l.website && l.website.startsWith('http://') },
  { name: 'few_reviews', points: 2, test: (l) => l.review_count < 10 },
  { name: 'low_rating', points: 1, test: (l) => l.rating !== null && l.rating < 3.5 },
  { name: 'good_rating_no_website', points: 3, test: (l) => !l.website && l.rating !== null && l.rating >= 4.0 },
  { name: 'established_no_website', points: 3, test: (l) => !l.website && l.review_count >= 50 },
];

function recommendService(lead: PlaceResult, signals: string[]): string {
  if (signals.includes('no_website')) {
    return 'vibe-web Essential Landing';
  }
  if (signals.includes('no_https')) {
    return 'vibe-web Brand Authority';
  }
  if (lead.review_count >= 100 && lead.rating !== null && lead.rating >= 4.0) {
    return 'vinicius.xyz Automation & Integration';
  }
  return 'vibe-web Brand Authority';
}

export function scoreLead(lead: PlaceResult): ScoreResult {
  const matched = SIGNALS.filter((s) => s.test(lead));
  const signals = matched.map((s) => s.name);
  const total = matched.reduce((sum, s) => sum + s.points, 0);
  const recommended_service = recommendService(lead, signals);

  return { total, signals, recommended_service };
}
