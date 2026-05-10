export function useStats() {
  const overview = useFetch('/api/stats/overview', { lazy: true })
  const byCategory = useFetch('/api/stats/by-category', { lazy: true })
  const byCity = useFetch('/api/stats/by-city', { lazy: true })
  const byLevel = useFetch('/api/stats/by-level', { lazy: true })

  const companyFilter = ref<'all' | 'us'>('all')
  const topCompanies = useFetch('/api/stats/top-companies', {
    lazy: true,
    params: { filter: companyFilter },
    watch: [companyFilter],
  })

  return { overview, byCategory, byCity, byLevel, topCompanies, companyFilter }
}
