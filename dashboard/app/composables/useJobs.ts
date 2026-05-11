/**
 * Composable for paginated job listing with filters.
 *
 * All reactive query parameters are passed to the API and
 * automatically trigger a re-fetch when changed.
 */
export function useJobs() {
  const page = ref(1)
  const limit = ref(20)
  const category = ref('')
  const city = ref('')
  const search = ref('')

  const { data, pending, refresh } = useFetch('/api/jobs', {
    query: { page, limit, category, city, search },
    lazy: true,
  })

  return { data, pending, page, limit, category, city, search, refresh }
}
