import type { PlaceResult, ScoreResult, Lead } from './types';

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

function recommendService(lead: PlaceResult, signals: string[], score: number): string {
  if (score === 0) return 'none';

  if (signals.includes('no_website')) {
    return 'vibe-web Essential Landing';
  }
  if (signals.includes('no_https')) {
    return 'vibe-web Brand Authority';
  }
  return 'vibe-web Brand Authority';
}

export function scoreLead(lead: PlaceResult): ScoreResult {
  const matched = SIGNALS.filter((s) => s.test(lead));
  const signals = matched.map((s) => s.name);
  const total = matched.reduce((sum, s) => sum + s.points, 0);
  const recommended_service = recommendService(lead, signals, total);

  return { total, signals, recommended_service };
}

export function scoreLeadFromDb(lead: Lead): ScoreResult {
  const asPlace: PlaceResult = {
    place_id: lead.place_id,
    name: lead.name,
    address: lead.address,
    phone: lead.phone,
    website: lead.website,
    google_maps_url: lead.google_maps_url,
    photo_url: lead.photo_url,
    rating: lead.rating,
    review_count: lead.review_count,
    category: lead.category,
    reviews: [],
  };
  return scoreLead(asPlace);
}

export function applyWebsiteCheck(base: ScoreResult, websiteSignals: string[], adjustment: number): ScoreResult {
  const signals = [...base.signals, ...websiteSignals];
  const total = base.total + adjustment;
  const recommended_service = total === 0 ? 'none' : base.recommended_service;
  return { total, signals, recommended_service };
}
