/**
 * GET /api/stats/by-city
 *
 * Returns cities with job counts and lat/lon coordinates.
 * Non-geographic values are excluded; metro regions are mapped to their parent city.
 */

import { jobs } from '@ai-job-classifier/db'
import { and, count, isNotNull, ne, sql } from 'drizzle-orm'

import { db } from '../../utils/db'

const CITY_COORDS: Record<string, { lat: number, lon: number }> = {
  'aachen': { lat: 50.7753, lon: 6.0839 },
  'augsburg': { lat: 48.3706, lon: 10.8978 },
  'berlin': { lat: 52.5200, lon: 13.4050 },
  'bielefeld': { lat: 52.0302, lon: 8.5325 },
  'bochum': { lat: 51.4818, lon: 7.2162 },
  'bonn': { lat: 50.7374, lon: 7.0982 },
  'bremen': { lat: 53.0793, lon: 8.8017 },
  'böblingen': { lat: 48.6864, lon: 9.0108 },
  'braunschweig': { lat: 52.2689, lon: 10.5268 },
  'darmstadt': { lat: 49.8728, lon: 8.6512 },
  'ditzingen': { lat: 48.8267, lon: 9.0667 },
  'dortmund': { lat: 51.5136, lon: 7.4653 },
  'dresden': { lat: 51.0504, lon: 13.7373 },
  'duisburg': { lat: 51.4344, lon: 6.7623 },
  'düsseldorf': { lat: 51.2277, lon: 6.7735 },
  'dusseldorf': { lat: 51.2277, lon: 6.7735 },
  'erfurt': { lat: 50.9848, lon: 11.0299 },
  'erlangen': { lat: 49.5897, lon: 11.0078 },
  'essen': { lat: 51.4556, lon: 7.0116 },
  'frankfurt': { lat: 50.1109, lon: 8.6821 },
  'frankfurt am main': { lat: 50.1109, lon: 8.6821 },
  'freiburg': { lat: 47.9990, lon: 7.8421 },
  'freiburg im breisgau': { lat: 47.9990, lon: 7.8421 },
  'göttingen': { lat: 51.5413, lon: 9.9158 },
  'gottingen': { lat: 51.5413, lon: 9.9158 },
  'hamburg': { lat: 53.5511, lon: 9.9937 },
  'hannover': { lat: 52.3759, lon: 9.7320 },
  'hanover': { lat: 52.3759, lon: 9.7320 },
  'heidelberg': { lat: 49.3988, lon: 8.6724 },
  'heilbronn': { lat: 49.1427, lon: 9.2109 },
  'herzogenaurach': { lat: 49.5683, lon: 10.8822 },
  'ingolstadt': { lat: 48.7665, lon: 11.4258 },
  'jena': { lat: 50.9271, lon: 11.5892 },
  'karlsruhe': { lat: 49.0069, lon: 8.4037 },
  'kassel': { lat: 51.3127, lon: 9.4797 },
  'kiel': { lat: 54.3233, lon: 10.1228 },
  'köln': { lat: 50.9375, lon: 6.9603 },
  'cologne': { lat: 50.9375, lon: 6.9603 },
  'koln': { lat: 50.9375, lon: 6.9603 },
  'konstanz': { lat: 47.6603, lon: 9.1758 },
  'leipzig': { lat: 51.3397, lon: 12.3731 },
  'lübeck': { lat: 53.8655, lon: 10.6866 },
  'lubeck': { lat: 53.8655, lon: 10.6866 },
  'magdeburg': { lat: 52.1205, lon: 11.6276 },
  'mainz': { lat: 49.9929, lon: 8.2473 },
  'mannheim': { lat: 49.4875, lon: 8.4660 },
  'mörfelden-walldorf': { lat: 49.9833, lon: 8.5833 },
  'münchen': { lat: 48.1351, lon: 11.5820 },
  'munich': { lat: 48.1351, lon: 11.5820 },
  'munchen': { lat: 48.1351, lon: 11.5820 },
  'münster': { lat: 51.9607, lon: 7.6261 },
  'munster': { lat: 51.9607, lon: 7.6261 },
  'nürnberg': { lat: 49.4521, lon: 11.0767 },
  'nuremberg': { lat: 49.4521, lon: 11.0767 },
  'nurnberg': { lat: 49.4521, lon: 11.0767 },
  'paderborn': { lat: 51.7189, lon: 8.7575 },
  'potsdam': { lat: 52.3906, lon: 13.0645 },
  'regensburg': { lat: 49.0134, lon: 12.1016 },
  'renningen': { lat: 48.7700, lon: 8.9367 },
  'rostock': { lat: 54.0924, lon: 12.0991 },
  'saarbrücken': { lat: 49.2402, lon: 6.9969 },
  'saarbrucken': { lat: 49.2402, lon: 6.9969 },
  'sindelfingen': { lat: 48.7132, lon: 9.0029 },
  'stuttgart': { lat: 48.7758, lon: 9.1829 },
  'tübingen': { lat: 48.5216, lon: 9.0576 },
  'tubingen': { lat: 48.5216, lon: 9.0576 },
  'ulm': { lat: 48.4011, lon: 9.9876 },
  'walldorf': { lat: 49.3063, lon: 8.6425 },
  'wiesbaden': { lat: 50.0782, lon: 8.2398 },
  'wolfsburg': { lat: 52.4227, lon: 10.7865 },
  'wuppertal': { lat: 51.2562, lon: 7.1508 },
  'würzburg': { lat: 49.7913, lon: 9.9534 },
  'wurzburg': { lat: 49.7913, lon: 9.9534 },
  'chemnitz': { lat: 50.8278, lon: 12.9214 },
  'koblenz': { lat: 50.3569, lon: 7.5890 },
  'friedrichshafen': { lat: 47.6543, lon: 9.4801 },
  'gelsenkirchen': { lat: 51.5177, lon: 7.0857 },
  'ludwigshafen': { lat: 49.4774, lon: 8.4452 },
  'immenstaad': { lat: 47.6650, lon: 9.3600 },
  'kitzingen': { lat: 49.7342, lon: 10.1561 },
  'ramstein-miesenbach': { lat: 49.4467, lon: 7.5528 },
  'ottobrunn': { lat: 48.0653, lon: 11.6650 },
  'garching bei münchen': { lat: 48.2489, lon: 11.6511 },
  'germering': { lat: 48.1350, lon: 11.3700 },
  'offenburg': { lat: 48.4721, lon: 7.9408 },
  'remscheid': { lat: 51.1787, lon: 7.1896 },
  'wedel': { lat: 53.5833, lon: 9.7000 },
}

const CITY_ALIASES: Record<string, string> = {
  'metropolregion münchen': 'münchen',
  'metropolregion berlin/brandenburg': 'berlin',
  'metropolregion berlin': 'berlin',
  'region stuttgart': 'stuttgart',
  'region hannover': 'hannover',
  'großraum münchen': 'münchen',
  'großraum berlin': 'berlin',
  'großraum stuttgart': 'stuttgart',
  'raum münchen': 'münchen',
  'raum stuttgart': 'stuttgart',
  'raum frankfurt': 'frankfurt',
  'raum köln': 'köln',
  'metropolregion hannover-braunschweig-göttingen-wolfsburg': 'hannover',
  'metropole ruhr': 'essen',
}

const EXCLUDED_VALUES = new Set([
  'deutschland', 'germany',
  'home office', 'homeoffice', 'remote',
  'bayern', 'baden-württemberg', 'nordrhein-westfalen', 'hessen',
  'niedersachsen', 'sachsen', 'thüringen', 'schleswig-holstein',
  'rheinland-pfalz', 'brandenburg', 'mecklenburg-vorpommern',
  'saarland', 'sachsen-anhalt',
])

function resolveCity(raw: string): string | null {
  const key = raw.toLowerCase().trim()
  if (!key) return null
  if (EXCLUDED_VALUES.has(key)) return null
  if (CITY_ALIASES[key]) return CITY_ALIASES[key]
  return key
}

function lookupCoords(city: string): { lat: number | null, lon: number | null } {
  const key = city.toLowerCase().trim()
  const match = CITY_COORDS[key]
  if (match) return match
  for (const [name, coords] of Object.entries(CITY_COORDS)) {
    if (key.startsWith(name) || name.startsWith(key)) {
      return coords
    }
  }
  return { lat: null, lon: null }
}

export default defineEventHandler(async () => {
  const rows = await db
    .select({ city: jobs.city, count: count() })
    .from(jobs)
    .where(and(isNotNull(jobs.city), ne(jobs.city, '')))
    .groupBy(jobs.city)
    .orderBy(sql`count(*) DESC`)

  const cityMap = new Map<string, number>()
  for (const row of rows) {
    const resolved = resolveCity(row.city)
    if (!resolved) continue
    cityMap.set(resolved, (cityMap.get(resolved) || 0) + row.count)
  }

  return Array.from(cityMap.entries())
    .map(([city, count]) => {
      const coords = lookupCoords(city)
      return { city, count, lat: coords.lat, lon: coords.lon }
    })
    .sort((a, b) => b.count - a.count)
})
