/**
 * Composable that fetches all dashboard statistics from the API.
 *
 * Each endpoint is fetched lazily so the page can render immediately
 * while data streams in.
 */
export function useStats() {
  const overview = useFetch('/api/stats/overview', { lazy: true })
  const byCategory = useFetch('/api/stats/by-category', { lazy: true })
  const byCity = useFetch('/api/stats/by-city', { lazy: true })
  const byLevel = useFetch('/api/stats/by-level', { lazy: true })
  const topCompanies = useFetch('/api/stats/top-companies', { lazy: true })

  return { overview, byCategory, byCity, byLevel, topCompanies }
}
