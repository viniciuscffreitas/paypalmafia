export interface LeadSearchConfig {
  id: number;
  query: string;
  region: string;
  radius_km: number;
  min_score: number;
  active: boolean;
  created_at: string;
}

export interface Lead {
  id: number;
  place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number;
  category: string | null;
  google_maps_url: string | null;
  photo_url: string | null;
  region: string;
  score: number;
  recommended_service: string | null;
  ai_analysis: string | null;
  ai_pitch: string | null;
  status: 'new' | 'contacted' | 'dismissed';
  found_at: string;
  contacted_at: string | null;
}

export interface PlaceResult {
  place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  google_maps_url: string | null;
  photo_url: string | null;
  rating: number | null;
  review_count: number;
  category: string | null;
}

export interface ScoreResult {
  total: number;
  signals: string[];
  recommended_service: string;
}

export type LeadStatus = 'new' | 'contacted' | 'dismissed';
