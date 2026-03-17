import { describe, it, expect } from 'vitest';
import { parsePlacesResponse, parseNextPageToken } from '../../../src/modules/leads/places-api';

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
          businessStatus: 'OPERATIONAL',
          photos: [
            { name: 'places/ChIJ123/photos/abc123', heightPx: 400, widthPx: 600 },
            { name: 'places/ChIJ123/photos/def456', heightPx: 300, widthPx: 400 },
          ],
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
      photo_url: 'places/ChIJ123/photos/abc123',
      rating: 4.5,
      review_count: 120,
      category: 'Restaurante',
      reviews: [],
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
    expect(results[0].photo_url).toBeNull();
  });

  it('returns empty array for empty response', () => {
    expect(parsePlacesResponse({ places: [] })).toEqual([]);
    expect(parsePlacesResponse({})).toEqual([]);
  });

  it('filters out places with CLOSED_PERMANENTLY status', () => {
    const apiResponse = {
      places: [
        {
          id: 'open1',
          displayName: { text: 'Open Business' },
          formattedAddress: 'Rua A',
          businessStatus: 'OPERATIONAL',
        },
        {
          id: 'closed1',
          displayName: { text: 'Closed Business' },
          formattedAddress: 'Rua B',
          businessStatus: 'CLOSED_PERMANENTLY',
        },
      ],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Open Business');
  });

  it('filters out places with CLOSED_TEMPORARILY status', () => {
    const apiResponse = {
      places: [
        {
          id: 'temp1',
          displayName: { text: 'Temp Closed' },
          formattedAddress: 'Rua C',
          businessStatus: 'CLOSED_TEMPORARILY',
        },
      ],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results).toHaveLength(0);
  });

  it('sets photo_url to null when no photos', () => {
    const apiResponse = {
      places: [
        {
          id: 'no-photo',
          displayName: { text: 'No Photo Place' },
          formattedAddress: 'Rua X',
          businessStatus: 'OPERATIONAL',
        },
      ],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results[0].photo_url).toBeNull();
  });

  it('includes places with no businessStatus (defaults to operational)', () => {
    const apiResponse = {
      places: [
        {
          id: 'no-status',
          displayName: { text: 'No Status Biz' },
          formattedAddress: 'Rua D',
        },
      ],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results).toHaveLength(1);
  });
  it('extracts review texts from places response', () => {
    const apiResponse = {
      places: [{
        id: 'rev1',
        displayName: { text: 'Reviewed Place' },
        formattedAddress: 'Rua X',
        businessStatus: 'OPERATIONAL',
        reviews: [
          { text: { text: 'Ótimo atendimento' }, rating: 5 },
          { text: { text: 'Site não funciona' }, rating: 3 },
        ],
      }],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results[0].reviews).toEqual(['Ótimo atendimento', 'Site não funciona']);
  });

  it('returns empty reviews array when no reviews', () => {
    const apiResponse = {
      places: [{
        id: 'no-rev',
        displayName: { text: 'No Reviews' },
        formattedAddress: 'Rua Y',
        businessStatus: 'OPERATIONAL',
      }],
    };
    const results = parsePlacesResponse(apiResponse);
    expect(results[0].reviews).toEqual([]);
  });
});

describe('parseNextPageToken', () => {
  it('returns nextPageToken when present', () => {
    const data = { places: [], nextPageToken: 'abc123' };
    expect(parseNextPageToken(data)).toBe('abc123');
  });

  it('returns null when no nextPageToken', () => {
    const data = { places: [] };
    expect(parseNextPageToken(data)).toBeNull();
  });
});
