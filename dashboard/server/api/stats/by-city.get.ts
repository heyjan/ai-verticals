/**
 * GET /api/stats/by-city
 *
 * Returns top 30 cities with job counts and lat/lon coordinates.
 * Coordinates come from a hardcoded lookup of major German cities
 * (with both German and English name variants).
 */

import { getDb } from '../../database'

// Lat/lon lookup for major German cities.
// Keys are lowercased for case-insensitive matching.
const CITY_COORDS: Record<string, { lat: number, lon: number }> = {
  // A
  'aachen': { lat: 50.7753, lon: 6.0839 },
  'augsburg': { lat: 48.3706, lon: 10.8978 },
  // B
  'berlin': { lat: 52.5200, lon: 13.4050 },
  'bielefeld': { lat: 52.0302, lon: 8.5325 },
  'bochum': { lat: 51.4818, lon: 7.2162 },
  'bonn': { lat: 50.7374, lon: 7.0982 },
  'bremen': { lat: 53.0793, lon: 8.8017 },
  'böblingen': { lat: 48.6864, lon: 9.0108 },
  // D
  'darmstadt': { lat: 49.8728, lon: 8.6512 },
  'dortmund': { lat: 51.5136, lon: 7.4653 },
  'dresden': { lat: 51.0504, lon: 13.7373 },
  'duisburg': { lat: 51.4344, lon: 6.7623 },
  'düsseldorf': { lat: 51.2277, lon: 6.7735 },
  'dusseldorf': { lat: 51.2277, lon: 6.7735 },
  // E
  'erfurt': { lat: 50.9848, lon: 11.0299 },
  'essen': { lat: 51.4556, lon: 7.0116 },
  // F
  'frankfurt': { lat: 50.1109, lon: 8.6821 },
  'frankfurt am main': { lat: 50.1109, lon: 8.6821 },
  'freiburg': { lat: 47.9990, lon: 7.8421 },
  'freiburg im breisgau': { lat: 47.9990, lon: 7.8421 },
  // G
  'göttingen': { lat: 51.5413, lon: 9.9158 },
  'gottingen': { lat: 51.5413, lon: 9.9158 },
  // H
  'hamburg': { lat: 53.5511, lon: 9.9937 },
  'hannover': { lat: 52.3759, lon: 9.7320 },
  'hanover': { lat: 52.3759, lon: 9.7320 },
  'heidelberg': { lat: 49.3988, lon: 8.6724 },
  // I
  'ingolstadt': { lat: 48.7665, lon: 11.4258 },
  // J
  'jena': { lat: 50.9271, lon: 11.5892 },
  // K
  'karlsruhe': { lat: 49.0069, lon: 8.4037 },
  'kiel': { lat: 54.3233, lon: 10.1228 },
  'köln': { lat: 50.9375, lon: 6.9603 },
  'cologne': { lat: 50.9375, lon: 6.9603 },
  'koln': { lat: 50.9375, lon: 6.9603 },
  // L
  'leipzig': { lat: 51.3397, lon: 12.3731 },
  'lübeck': { lat: 53.8655, lon: 10.6866 },
  'lubeck': { lat: 53.8655, lon: 10.6866 },
  // M
  'magdeburg': { lat: 52.1205, lon: 11.6276 },
  'mainz': { lat: 49.9929, lon: 8.2473 },
  'mannheim': { lat: 49.4875, lon: 8.4660 },
  'münchen': { lat: 48.1351, lon: 11.5820 },
  'munich': { lat: 48.1351, lon: 11.5820 },
  'munchen': { lat: 48.1351, lon: 11.5820 },
  'münster': { lat: 51.9607, lon: 7.6261 },
  'munster': { lat: 51.9607, lon: 7.6261 },
  // N
  'nürnberg': { lat: 49.4521, lon: 11.0767 },
  'nuremberg': { lat: 49.4521, lon: 11.0767 },
  'nurnberg': { lat: 49.4521, lon: 11.0767 },
  // P
  'potsdam': { lat: 52.3906, lon: 13.0645 },
  // R
  'regensburg': { lat: 49.0134, lon: 12.1016 },
  'renningen': { lat: 48.7700, lon: 8.9367 },
  'rostock': { lat: 54.0924, lon: 12.0991 },
  // S
  'saarbrücken': { lat: 49.2402, lon: 6.9969 },
  'saarbrucken': { lat: 49.2402, lon: 6.9969 },
  'stuttgart': { lat: 48.7758, lon: 9.1829 },
  // U
  'ulm': { lat: 48.4011, lon: 9.9876 },
  // W
  'walldorf': { lat: 49.3063, lon: 8.6425 },
  'wiesbaden': { lat: 50.0782, lon: 8.2398 },
  'wolfsburg': { lat: 52.4227, lon: 10.7865 },
  'wuppertal': { lat: 51.2562, lon: 7.1508 },
}

function lookupCoords(city: string): { lat: number | null, lon: number | null } {
  const key = city.toLowerCase().trim()
  const match = CITY_COORDS[key]
  if (match) return match
  // Try partial match – check if the city name starts with a known key
  // (handles "Frankfurt am Main" when stored as "Frankfurt")
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (key.startsWith(name) || name.startsWith(key)) {
      return coords
    }
  }
  return { lat: null, lon: null }
}

export default defineEventHandler(async () => {
  const db = await getDb()

  const result = db.exec(
    'SELECT city, COUNT(*) as count FROM jobs GROUP BY city ORDER BY count DESC LIMIT 30',
  )

  if (result.length === 0) return []

  return result[0].values.map((row) => {
    const city = row[0] as string
    const count = row[1] as number
    const coords = lookupCoords(city)
    return {
      city,
      count,
      lat: coords.lat,
      lon: coords.lon,
    }
  })
})
