import type { PlaceResult } from './types';
import { createLogger } from '../../core/logger';

const logger = createLogger('leads:places-api');

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

export function parsePlacesResponse(data: any): PlaceResult[] {
  const places = data?.places;
  if (!Array.isArray(places)) return [];

  return places
    .filter((p: any) => {
      const status = p.businessStatus;
      return !status || status === 'OPERATIONAL';
    })
    .map((p: any) => ({
    place_id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    google_maps_url: p.googleMapsUri ?? null,
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? 0,
    category: p.primaryTypeDisplayName?.text ?? null,
    }));
}

export async function searchPlaces(
  apiKey: string,
  query: string,
  region: string,
): Promise<PlaceResult[]> {
  const body = {
    textQuery: `${query} em ${region}`,
    languageCode: 'pt-BR',
    maxResultCount: 20,
  };

  try {
    const response = await fetch(PLACES_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Places API error (${response.status}): ${error}`);
      return [];
    }

    const data = await response.json();
    const results = parsePlacesResponse(data);
    logger.info(`Found ${results.length} places for "${query}" in "${region}"`);
    return results;
  } catch (error) {
    logger.error('Places API request failed:', error);
    return [];
  }
}
