import { createLogger } from '../../core/logger';
import type Database from 'better-sqlite3';

const logger = createLogger('leads:cost');

// Google Places API (New) pricing estimate per place
// Text Search with Pro fields (photos, reviews, businessStatus): ~$0.035/place
const COST_PER_PLACE = 0.035;

export function estimateCost(placesCount: number, pagesFetched: number): number {
  return placesCount * COST_PER_PLACE;
}

export interface CostEntry {
  endpoint: string;
  places_count: number;
  pages_fetched: number;
  estimated_cost: number;
  created_at: string;
}

export interface CostSummary {
  total_cost: number;
  total_places: number;
  total_requests: number;
}

export function formatCostSummary(entries: CostEntry[]): CostSummary {
  return {
    total_cost: entries.reduce((sum, e) => sum + e.estimated_cost, 0),
    total_places: entries.reduce((sum, e) => sum + e.places_count, 0),
    total_requests: entries.length,
  };
}

export function logApiUsage(
  db: Database.Database,
  endpoint: string,
  placesCount: number,
  pagesFetched: number,
): void {
  const cost = estimateCost(placesCount, pagesFetched);
  db.prepare(
    'INSERT INTO api_usage_log (endpoint, places_count, pages_fetched, estimated_cost) VALUES (?, ?, ?, ?)'
  ).run(endpoint, placesCount, pagesFetched, cost);
  logger.info(`API usage logged: ${endpoint} — ${placesCount} places, ${pagesFetched} pages, $${cost.toFixed(3)}`);
}

export function getCostEntries(db: Database.Database, days: number = 30): CostEntry[] {
  return db.prepare(
    `SELECT * FROM api_usage_log WHERE created_at >= datetime('now', '-${days} days') ORDER BY created_at DESC`
  ).all() as CostEntry[];
}
