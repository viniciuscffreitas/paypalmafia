import { describe, it, expect } from 'vitest';
import { parsePlacesResponse } from '../../../src/modules/leads/places-api';

describe('parsePlacesResponse', () => {
  it('parses a valid Places API response into PlaceResult[]', () => {
    const apiResponse = {
      places: [
        {
          id: 'ChIJ123',
          displayName: { text: 'Restaurante Bom' },
          formattedAddress: 'Rua A, 100, São Paulo',
          nationalPhoneNumber: '(11) 3000-0000',
          websiteUri: 'https://restaurantebom.com.br',
          rating: 4.5,
          userRatingCount: 120,
          primaryTypeDisplayName: { text: 'Restaurante' },
          googleMapsUri: 'https://maps.google.com/?cid=123456',
        },
      ],
    };

    const results = parsePlacesResponse(apiResponse);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      place_id: 'ChIJ123',
      name: 'Restaurante Bom',
      address: 'Rua A, 100, São Paulo',
      phone: '(11) 3000-0000',
      website: 'https://restaurantebom.com.br',
      google_maps_url: 'https://maps.google.com/?cid=123456',
      rating: 4.5,
      review_count: 120,
      category: 'Restaurante',
    });
  });

  it('handles missing optional fields gracefully', () => {
    const apiResponse = {
      places: [
        {
          id: 'ChIJ456',
          displayName: { text: 'Loja Sem Site' },
          formattedAddress: 'Rua B, 200',
        },
      ],
    };

    const results = parsePlacesResponse(apiResponse);
    expect(results[0].website).toBeNull();
    expect(results[0].phone).toBeNull();
    expect(results[0].rating).toBeNull();
    expect(results[0].review_count).toBe(0);
    expect(results[0].category).toBeNull();
    expect(results[0].google_maps_url).toBeNull();
  });

  it('returns empty array for empty response', () => {
    expect(parsePlacesResponse({ places: [] })).toEqual([]);
    expect(parsePlacesResponse({})).toEqual([]);
  });
});
