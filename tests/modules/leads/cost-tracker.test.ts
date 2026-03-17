import { describe, it, expect } from 'vitest';
import { estimateCost, formatCostSummary } from '../../../src/modules/leads/cost-tracker';

describe('estimateCost', () => {
  it('calculates cost for text search with pro fields', () => {
    // Text Search (Pro SKU with photos/reviews): ~$0.035 per place
    const cost = estimateCost(20, 1);
    expect(cost).toBeCloseTo(0.70, 1); // 20 * 0.035
  });

  it('calculates cost for multiple pages', () => {
    const cost = estimateCost(60, 3);
    expect(cost).toBeCloseTo(2.10, 1); // 60 * 0.035
  });

  it('returns 0 for 0 places', () => {
    expect(estimateCost(0, 1)).toBe(0);
  });
});

describe('formatCostSummary', () => {
  it('formats cost entries into readable summary', () => {
    const entries = [
      { endpoint: 'textSearch', places_count: 20, pages_fetched: 1, estimated_cost: 0.70, created_at: '2026-03-17' },
      { endpoint: 'textSearch', places_count: 40, pages_fetched: 2, estimated_cost: 1.40, created_at: '2026-03-17' },
    ];
    const summary = formatCostSummary(entries);
    expect(summary.total_cost).toBeCloseTo(2.10, 1);
    expect(summary.total_places).toBe(60);
    expect(summary.total_requests).toBe(2);
  });

  it('handles empty entries', () => {
    const summary = formatCostSummary([]);
    expect(summary.total_cost).toBe(0);
    expect(summary.total_places).toBe(0);
    expect(summary.total_requests).toBe(0);
  });
});
