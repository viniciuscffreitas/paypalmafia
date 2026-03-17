import type { PlaceResult } from './types';
import { createLogger } from '../../core/logger';

const logger = createLogger('leads:places-api');

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places:searchText';
const NEARBY_SEARCH_BASE = 'https://places.googleapis.com/v1/places:searchNearby';

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
  'places.photos',
  'places.reviews',
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
    photo_url: p.photos?.[0]?.name ?? null,
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? 0,
    category: p.primaryTypeDisplayName?.text ?? null,
    reviews: (p.reviews || []).map((r: any) => r.text?.text).filter(Boolean).slice(0, 5),
    }));
}

export function getPhotoUrl(photoName: string, apiKey: string, maxHeight: number = 400): string {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=${maxHeight}&key=${apiKey}`;
}

export function parseNextPageToken(data: any): string | null {
  return data?.nextPageToken ?? null;
}

export function parseNearbySearchBody(
  lat: number,
  lng: number,
  radiusKm: number,
  types: string[],
): Record<string, any> {
  return {
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusKm * 1000,
      },
    },
    includedTypes: types,
    maxResultCount: 20,
    languageCode: 'pt-BR',
  };
}

export async function searchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radiusKm: number,
  types: string[],
): Promise<PlaceResult[]> {
  const body = parseNearbySearchBody(lat, lng, radiusKm, types);

  try {
    const response = await fetch(NEARBY_SEARCH_BASE, {
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
      logger.error(`Nearby Search error (${response.status}): ${error}`);
      return [];
    }

    const data = await response.json();
    const results = parsePlacesResponse(data);
    logger.info(`Found ${results.length} nearby places (${lat}, ${lng}, ${radiusKm}km)`);
    return results;
  } catch (error) {
    logger.error('Nearby Search request failed:', error);
    return [];
  }
}

export async function searchPlaces(
  apiKey: string,
  query: string,
  region: string,
  maxPages: number = 3,
): Promise<PlaceResult[]> {
  const allResults: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, any> = {
      textQuery: `${query} em ${region}`,
      languageCode: 'pt-BR',
      pageSize: 20,
    };

    if (pageToken) {
      body.pageToken = pageToken;
    }

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
        break;
      }

      const data = await response.json();
      const results = parsePlacesResponse(data);
      allResults.push(...results);

      const nextToken = parseNextPageToken(data);
      if (!nextToken) {
        logger.info(`Page ${page + 1}: ${results.length} places — no more pages available`);
        break;
      }

      pageToken = nextToken;
      logger.info(`Page ${page + 1}: ${results.length} places, nextPageToken present — fetching next page...`);

      await new Promise((r) => setTimeout(r, 300));
    } catch (error) {
      logger.error('Places API request failed:', error);
      break;
    }
  }

  logger.info(`Found ${allResults.length} total places for "${query}" in "${region}"`);
  return allResults;
}
