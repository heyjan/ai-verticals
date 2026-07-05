<script setup lang="ts">
const { overview, byCategory, byCity, byLevel, topCompanies, companyFilter, knowledgeGraph, growth, recentJobs } = useStats()

const stats = computed(() => overview.data.value as Record<string, any> | undefined)
const categories = computed(() => (byCategory.data.value as any[] | undefined) ?? [])
const cities = computed(() => (byCity.data.value as any[] | undefined) ?? [])
const levels = computed(() => (byLevel.data.value as any[] | undefined) ?? [])
const companies = computed(() => (topCompanies.data.value as any[] | undefined) ?? [])

const isLoading = computed(
  () => overview.pending.value || byCategory.pending.value,
)

const lastUpdated = computed(() => {
  const iso = (stats.value as any)?.lastUpdated
  if (!iso) return null
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
})

const maxCategoryCount = computed(() => {
  if (!categories.value.length) return 1
  return Math.max(...categories.value.map((c: any) => c.count))
})

const maxCityCount = computed(() => {
  if (!cities.value.length) return 1
  return Math.max(...cities.value.map((c: any) => c.count))
})

const meaningfulLevels = computed(() =>
  levels.value.filter(
    (l: any) => l.level && l.level !== 'N/A' && l.level !== 'Keine Angabe' && l.level !== '',
  ),
)

const maxLevelCount = computed(() => {
  if (!meaningfulLevels.value.length) return 1
  return Math.max(...meaningfulLevels.value.map((l: any) => l.count))
})

const unspecifiedCount = computed(() =>
  levels.value
    .filter((l: any) => !l.level || l.level === 'N/A' || l.level === 'Keine Angabe' || l.level === '')
    .reduce((s: number, l: any) => s + l.count, 0),
)

const mappableCities = computed(() =>
  cities.value.filter((c: any) => c.lat != null && c.lon != null),
)

const tooltip = ref<{ city: string; count: number; x: number; y: number } | null>(null)

function onMapHover(payload: { city: string; count: number; screenX: number; screenY: number } | null) {
  tooltip.value = payload
    ? { city: payload.city, count: payload.count, x: payload.screenX, y: payload.screenY }
    : null
}

type ViewportMode = 'metrics' | 'graph' | 'map'
const viewportMode = ref<ViewportMode>('metrics')
const graphData = computed(() => {
  const data = knowledgeGraph.data.value as { nodes: any[]; edges: any[] } | undefined
  return data && Array.isArray(data.nodes) ? data : { nodes: [], edges: [] }
})

const growthData = computed(() => growth.data.value as any | undefined)
const recentJobsData = computed<any[]>(() => {
  const d = recentJobs.data.value as { jobs?: any[] } | undefined
  return Array.isArray(d?.jobs) ? d!.jobs : []
})

// ── Fullscreen: take the viewport panel to the full screen via the
// Fullscreen API. Works for both map (TresJS canvas) and graph (SVG)
// because they're both children of the same panel element. Escape exits
// natively; we listen to `fullscreenchange` so the button stays in sync.
const viewportRef = ref<HTMLElement | null>(null)
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (!viewportRef.value) return
  if (!document.fullscreenElement) {
    viewportRef.value.requestFullscreen?.().catch(() => {
      // Some browsers reject without a user gesture in the right frame;
      // not much we can do here besides ignore.
    })
  } else {
    document.exitFullscreen?.().catch(() => {})
  }
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === viewportRef.value
}

// Guard <Teleport> against SSR — the target div doesn't exist in the
// SSR HTML pass; we only enable teleporting after the client mounts.
const isMounted = ref(false)
onMounted(() => {
  isMounted.value = true
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})

function onDocumentPointerDown(e: PointerEvent) {
  // Dismiss the company tooltip when tapping/clicking outside an info icon.
  // The icon itself stops propagation via @click.stop, but pointerdown still
  // bubbles, so we check the target.
  const target = e.target as HTMLElement | null
  if (!target?.closest('[data-company-info]')) {
    hideCompanyTooltip()
  }
}

const graphTooltip = ref<{ label: string; count: number; level: number; x: number; y: number } | null>(null)
function onGraphHover(
  payload: { label: string; count: number; level: number; screenX: number; screenY: number } | null,
) {
  graphTooltip.value = payload
    ? { label: payload.label, count: payload.count, level: payload.level, x: payload.screenX, y: payload.screenY }
    : null
}

const selectedCity = ref<string | null>(null)
const cityDetail = ref<any>(null)
const cityDetailPending = ref(false)
const currentJobIndex = ref(0)
// Sequence number so a slower fetch for a previous city can't overwrite
// the result of a newer click. Without this, rapid city switches can
// leave the panel showing data for the wrong city.
let cityFetchSeq = 0

async function onCitySelect(city: string) {
  if (selectedCity.value === city) {
    selectedCity.value = null
    cityDetail.value = null
    currentJobIndex.value = 0
    return
  }
  const seq = ++cityFetchSeq
  selectedCity.value = city
  cityDetailPending.value = true
  // Don't clear cityDetail here — the stale data keeps the card and
  // summary rendered while the new fetch is in flight, so switching
  // cities feels instant instead of unmounting/remounting the card.
  // The seq check below discards the response if the user has moved on.
  currentJobIndex.value = 0
  try {
    const data = await $fetch('/api/stats/city-detail', { params: { city } })
    if (seq !== cityFetchSeq) return
    cityDetail.value = data
  } catch {
    if (seq !== cityFetchSeq) return
    cityDetail.value = null
  }
  if (seq !== cityFetchSeq) return
  cityDetailPending.value = false
}

function closeCityDetail() {
  cityFetchSeq++
  selectedCity.value = null
  cityDetail.value = null
  currentJobIndex.value = 0
}

function formatSalary(n: number): string {
  return `${Math.round(n / 1000)}k`
}

const jobsWithSalary = computed<any[]>(() => {
  const r = cityDetail.value?.ranges
  return Array.isArray(r) ? r : []
})

const currentJob = computed(() => jobsWithSalary.value[currentJobIndex.value] ?? null)

function prevJob() {
  if (currentJobIndex.value > 0) currentJobIndex.value--
}
function nextJob() {
  if (currentJobIndex.value < jobsWithSalary.value.length - 1) currentJobIndex.value++
}

const companyTooltip = ref<{ text: string; x: number; y: number } | null>(null)

function showCompanyTooltip(e: Event, description: string) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  companyTooltip.value = {
    text: description,
    x: rect.left + rect.width / 2,
    y: rect.top,
  }
}

function hideCompanyTooltip() {
  companyTooltip.value = null
}

function toggleCompanyTooltip(e: Event, description: string) {
  if (companyTooltip.value?.text === description) {
    hideCompanyTooltip()
  } else {
    showCompanyTooltip(e, description)
  }
}

const companiesPage = ref(0)
const companiesPerPage = 10
const companiesPageCount = computed(() => Math.ceil(companies.value.length / companiesPerPage))

function toggleCompanyFilter() {
  companyFilter.value = companyFilter.value === 'all' ? 'us' : 'all'
  companiesPage.value = 0
}
const pagedCompanies = computed(() => {
  const start = companiesPage.value * companiesPerPage
  return companies.value.slice(start, start + companiesPerPage)
})

function pct(value: number, max: number): string {
  return `${Math.max((value / max) * 100, 2)}%`
}
</script>

<template>
  <div class="dash blueprint-grid">
    <!-- ════════ HEADER ════════ -->
    <header class="dash-header">
      <div class="header-inner">
        <img src="/logo.png" alt="ai-verticals.dev" class="header-logo" />

        <div class="header-meta">
          <span class="font-mono text-[9.5px] uppercase tracking-[0.25em] text-ink-faint">
            {{ stats?.total ?? '...' }} records
          </span>
          <span class="status-flicker flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">
            <span
              class="block h-[5px] w-[5px] rounded-full"
              :class="isLoading ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'"
            />
            {{ isLoading ? 'SYNCING' : 'ACTIVE' }}
          </span>
          <span v-if="lastUpdated" class="font-mono text-[9.5px] tracking-[0.15em] text-ink-ghost hidden sm:inline">
            Last updated {{ lastUpdated }}
          </span>
        </div>
      </div>
    </header>

    <!-- ════════ STATS COLUMN ════════ -->
    <aside class="dash-stats panel reg-marks p-5">
      <h2 class="panel-header">SYS.info</h2>

      <p class="text-[13px] leading-relaxed text-ink-light mb-4">
        Wo wird KI in Deutschland wirklich eingesetzt? Dieses Dashboard analysiert
        Stellenanzeigen und macht sichtbar, welche Unternehmen KI-Lösungen implementieren
        &mdash; in welchen Städten, Branchen und Rollen. Ein ausgezeichnetes Werkzeug
        zur Identifikation von KI-Anwendungsfällen (Use Cases).
      </p>
    </aside>

    <!-- ════════ VIEWPORT ════════ -->
    <section
      ref="viewportRef"
      class="dash-viewport panel reg-marks relative overflow-hidden p-0"
      :class="{ 'dash-viewport--fullscreen': isFullscreen }"
    >
      <!-- Registration marks inner element for all 4 corners -->
      <div class="reg-marks-full absolute inset-0 pointer-events-none z-10" />

      <!-- Tooltip teleport target. Lives inside the viewport panel so it's
           a descendant of the fullscreen element when fullscreen is active
           (Teleport-to-body would render outside the fullscreen tree and
           the OS hides anything outside that subtree). -->
      <div id="viewport-overlay-root" class="viewport-overlay-root" />

      <!-- Top-right toolbar: fullscreen toggle + mode toggle -->
      <div class="absolute top-3 right-3 z-20 flex items-center gap-2">
        <button
          class="viewport-fs-btn"
          :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
          :title="isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'"
          @click="toggleFullscreen"
        >
          <svg v-if="!isFullscreen" viewBox="0 0 16 16" class="viewport-fs-icon" aria-hidden="true">
            <!-- Four corner brackets — expand icon -->
            <path d="M2 5V2h3" />
            <path d="M11 2h3v3" />
            <path d="M14 11v3h-3" />
            <path d="M5 14H2v-3" />
          </svg>
          <svg v-else viewBox="0 0 16 16" class="viewport-fs-icon" aria-hidden="true">
            <!-- Inward corner brackets — collapse icon -->
            <path d="M5 2v3H2" />
            <path d="M11 5V2h3" />
            <path d="M14 11h-3v3" />
            <path d="M2 11h3v3" />
          </svg>
        </button>
        <div class="flex font-mono text-[8.5px] uppercase tracking-[0.18em] viewport-toggle">
          <button
            class="viewport-toggle-btn"
            :class="viewportMode === 'metrics' ? 'viewport-toggle-btn--active' : ''"
            @click="viewportMode = 'metrics'"
          >growth</button>
          <button
            class="viewport-toggle-btn viewport-toggle-btn--right"
            :class="viewportMode === 'graph' ? 'viewport-toggle-btn--active' : ''"
            @click="viewportMode = 'graph'"
          >graph</button>
          <button
            class="viewport-toggle-btn viewport-toggle-btn--right"
            :class="viewportMode === 'map' ? 'viewport-toggle-btn--active' : ''"
            @click="viewportMode = 'map'"
          >map</button>
        </div>
      </div>

      <ClientOnly>
        <GrowthDashboard
          v-if="viewportMode === 'metrics'"
          :data="growthData"
          :jobs="recentJobsData"
          :pending="growth.pending.value"
        />
        <SceneSetup v-else-if="viewportMode === 'map'" mode="map">
          <AnimatedGrid />
          <GermanyMap
            v-if="mappableCities.length"
            :city-data="mappableCities"
            @hover="onMapHover"
            @select="onCitySelect"
          />
        </SceneSetup>
        <KnowledgeGraph
          v-else-if="graphData.nodes.length"
          :data="graphData"
          @hover="onGraphHover"
        />
        <template #fallback>
          <div class="flex h-full items-center justify-center">
            <span class="font-mono text-[10.5px] uppercase tracking-[0.3em] text-ink-faint animate-pulse">
              Initialising viewport
            </span>
          </div>
        </template>
      </ClientOnly>

      <!-- Empty state for graph mode -->
      <div
        v-if="viewportMode === 'graph' && !graphData.nodes.length && !knowledgeGraph.pending.value"
        class="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      >
        <div class="text-center px-4">
          <p class="font-mono text-[10.5px] uppercase tracking-[0.32em] mb-2 text-ink-faint">— signal not found —</p>
          <p class="font-mono text-[10.5px] tracking-[0.05em] text-ink-light">
            run <code class="font-mono px-1.5 py-0.5 bg-surface-ruled border border-ink-ghost/50 text-ink">make discover</code>
            then <code class="font-mono px-1.5 py-0.5 bg-surface-ruled border border-ink-ghost/50 text-ink">make classify</code>
          </p>
        </div>
      </div>

      <!-- Map tooltip — teleported into the viewport overlay so it's visible
           in fullscreen mode too. -->
      <Teleport to="#viewport-overlay-root" :disabled="!isMounted">
        <Transition
          enter-active-class="transition-all duration-150 ease-out"
          leave-active-class="transition-all duration-100 ease-in"
          enter-from-class="opacity-0 translate-y-1"
          leave-to-class="opacity-0 translate-y-1"
        >
          <div
            v-if="tooltip"
            class="tooltip-panel fixed z-50"
            :style="{ left: `${tooltip.x + 16}px`, top: `${tooltip.y - 20}px` }"
          >
            <p class="font-mono text-[9.5px] uppercase tracking-[0.2em] text-ink-faint">{{ tooltip.city }}</p>
            <p class="font-mono text-[18.5px] font-bold text-ink mt-0.5">{{ tooltip.count }}<span class="text-[9.5px] font-normal text-ink-faint ml-1">jobs</span></p>
          </div>
        </Transition>
      </Teleport>

      <!-- Graph tooltip (matches the map tooltip aesthetic) — same overlay target -->
      <Teleport to="#viewport-overlay-root" :disabled="!isMounted">
        <Transition
          enter-active-class="transition-all duration-150 ease-out"
          leave-active-class="transition-all duration-100 ease-in"
          enter-from-class="opacity-0 translate-y-1"
          leave-to-class="opacity-0 translate-y-1"
        >
          <div
            v-if="graphTooltip"
            class="tooltip-panel fixed z-50 graph-tooltip"
            :style="{ left: `${graphTooltip.x + 16}px`, top: `${graphTooltip.y - 20}px` }"
          >
            <p class="font-mono text-[8.5px] uppercase tracking-[0.22em] text-ink-faint flex items-center gap-2">
              <span class="graph-tooltip-marker" :data-level="graphTooltip.level" />
              {{ graphTooltip.level === 1 ? 'Cohort' : graphTooltip.level === 2 ? 'Sub-segment' : 'Tool · Skill' }}
            </p>
            <p class="font-mono text-[13px] font-semibold text-ink mt-1 leading-tight">{{ graphTooltip.label }}</p>
            <p class="font-mono text-[9.5px] tabular-nums text-ink-light mt-0.5">{{ graphTooltip.count.toLocaleString('en-US') }} <span class="text-ink-faint">jobs</span></p>
          </div>
        </Transition>
      </Teleport>

      <!-- City detail stack: salary summary + swipeable per-job card -->
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        leave-active-class="transition-all duration-150 ease-in"
        enter-from-class="opacity-0 translate-x-4"
        leave-to-class="opacity-0 translate-x-4"
      >
        <div
          v-if="selectedCity"
          class="city-detail-stack absolute top-3 left-3 z-20 w-[280px] flex flex-col gap-2"
        >
          <div class="city-detail-panel">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-mono text-[11.5px] uppercase tracking-[0.2em] text-ink font-bold">{{ selectedCity }}</h3>
              <button
                class="font-mono text-[9.5px] text-ink-faint hover:text-ink transition-colors cursor-pointer"
                @click="closeCityDetail"
              >&times; close</button>
            </div>

            <template v-if="cityDetailPending && !cityDetail">
              <div class="animate-pulse space-y-2">
                <div class="h-3 w-3/4 bg-surface-ruled" />
                <div class="h-3 w-1/2 bg-surface-ruled" />
              </div>
            </template>

            <template v-else-if="cityDetail && cityDetail.count > 0">
              <p class="font-mono text-[8.5px] uppercase tracking-[0.15em] text-ink-faint mb-3">
                {{ cityDetail.count }} jobs with salary data
              </p>

              <div class="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
                <div>
                  <p class="font-mono text-[14.5px] font-bold text-ink">{{ formatSalary(cityDetail.medianLow) }}&ndash;{{ formatSalary(cityDetail.medianHigh) }}</p>
                  <p class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint">Median range</p>
                </div>
                <div>
                  <p class="font-mono text-[14.5px] font-bold text-ink">{{ formatSalary(cityDetail.avgLow) }}&ndash;{{ formatSalary(cityDetail.avgHigh) }}</p>
                  <p class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint">Average range</p>
                </div>
                <div>
                  <p class="font-mono text-[12.5px] text-ink-light">{{ formatSalary(cityDetail.min) }}</p>
                  <p class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint">Lowest</p>
                </div>
                <div>
                  <p class="font-mono text-[12.5px] text-ink-light">{{ formatSalary(cityDetail.max) }}</p>
                  <p class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint">Highest</p>
                </div>
              </div>

              <div class="salary-distribution">
                <p class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint mb-2">Distribution (EUR/year)</p>
                <div class="space-y-[2px]">
                  <div
                    v-for="(r, i) in cityDetail.ranges.slice(0, 20)"
                    :key="i"
                    class="salary-bar-row"
                  >
                    <div
                      class="salary-bar"
                      :style="{
                        left: `${(r.low / cityDetail.max) * 100}%`,
                        width: `${((r.high - r.low) / cityDetail.max) * 100}%`,
                      }"
                    />
                  </div>
                </div>
                <div class="flex justify-between mt-1">
                  <span class="font-mono text-[7.5px] text-ink-ghost">0k</span>
                  <span class="font-mono text-[7.5px] text-ink-ghost">{{ formatSalary(cityDetail.max) }}</span>
                </div>
              </div>
            </template>

            <template v-else>
              <p class="font-mono text-[9.5px] text-ink-faint">No salary data available for this city.</p>
            </template>
          </div>

          <!-- Swipeable per-job card: one job at a time, prev/next arrows.
               Stays mounted across city switches as long as some data is
               available; content is replaced reactively when the fetch
               settles. -->
          <div
            v-if="currentJob"
            class="city-detail-panel city-job-card"
          >
            <div class="flex items-center justify-between mb-3">
              <p class="font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink-faint">
                Job <span class="text-ink tabular-nums">{{ currentJobIndex + 1 }}</span>
                <span class="text-ink-ghost"> / </span>
                <span class="tabular-nums">{{ jobsWithSalary.length }}</span>
              </p>
              <div class="flex items-center gap-1">
                <button
                  class="city-job-nav"
                  :disabled="currentJobIndex === 0"
                  :aria-label="'Previous job'"
                  @click="prevJob"
                >
                  <svg viewBox="0 0 16 16" class="w-3 h-3" aria-hidden="true">
                    <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" />
                  </svg>
                </button>
                <button
                  class="city-job-nav"
                  :disabled="currentJobIndex >= jobsWithSalary.length - 1"
                  :aria-label="'Next job'"
                  @click="nextJob"
                >
                  <svg viewBox="0 0 16 16" class="w-3 h-3" aria-hidden="true">
                    <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" />
                  </svg>
                </button>
              </div>
            </div>

            <p class="font-mono text-[11.5px] text-ink font-bold leading-snug mb-1 break-words">
              <a
                v-if="currentJob.url"
                :href="currentJob.url"
                target="_blank"
                rel="noopener"
                class="hover:text-accent transition-colors"
              >{{ currentJob.title }}</a>
              <span v-else>{{ currentJob.title }}</span>
            </p>
            <p class="font-mono text-[9.5px] text-ink-light mb-3 truncate">{{ currentJob.company }}</p>

            <div class="flex items-baseline justify-between mb-2">
              <p class="font-mono text-[14.5px] font-bold text-ink">
                {{ formatSalary(currentJob.low) }}&ndash;{{ formatSalary(currentJob.high) }}
              </p>
              <span
                v-if="currentJob.category && currentJob.category !== 'Other'"
                class="font-mono text-[7.5px] uppercase tracking-[0.15em] text-ink-faint"
              >{{ currentJob.category }}</span>
            </div>

            <div class="salary-bar-row">
              <div
                class="salary-bar"
                :style="{
                  left: `${(currentJob.low / cityDetail.max) * 100}%`,
                  width: `${((currentJob.high - currentJob.low) / cityDetail.max) * 100}%`,
                }"
              />
            </div>
            <div class="flex justify-between mt-1">
              <span class="font-mono text-[7.5px] text-ink-ghost">0k</span>
              <span class="font-mono text-[7.5px] text-ink-ghost">{{ formatSalary(cityDetail.max) }}</span>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Viewport labels -->
      <template v-if="viewportMode === 'map'">
        <div class="absolute bottom-2 left-3 z-10 pointer-events-none">
          <p class="font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            geo.distribution // perspective
          </p>
        </div>
        <div class="absolute top-2 left-3 z-10 pointer-events-none">
          <p class="status-flicker font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            viewport.3d
          </p>
        </div>
      </template>
      <template v-else-if="viewportMode === 'graph'">
        <div class="absolute bottom-2 left-3 z-10 pointer-events-none">
          <p class="font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            knowledge.mechanism // schematic
          </p>
        </div>
        <div class="absolute top-2 left-3 z-10 pointer-events-none">
          <p class="status-flicker font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            viewport.2d
          </p>
        </div>
      </template>
      <template v-else>
        <div class="absolute bottom-2 left-3 z-10 pointer-events-none">
          <p class="font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            growth.timeseries // telemetry
          </p>
        </div>
        <div class="absolute top-2 left-3 z-10 pointer-events-none">
          <p class="status-flicker font-mono text-[7.5px] uppercase tracking-[0.3em] text-ink-faint/40">
            viewport.data
          </p>
        </div>
      </template>
    </section>

    <!-- ════════ CATEGORY BREAKDOWN ════════ -->
    <aside class="dash-categories panel reg-marks overflow-y-auto p-5">
      <h2 class="panel-header">CAT.segments</h2>

      <template v-if="categories.length">
        <div class="space-y-3">
          <div
            v-for="(cat, idx) in categories"
            :key="cat.category"
            class="stagger-item group"
            :style="{ animationDelay: `${0.05 * idx}s` }"
          >
            <div class="flex items-baseline justify-between mb-1">
              <span class="text-[11.5px] text-ink-light group-hover:text-ink transition-colors">{{ cat.category }}</span>
              <span class="font-mono text-[10.5px] tabular-nums text-ink-faint group-hover:text-accent transition-colors">
                {{ cat.count }}
              </span>
            </div>
            <div class="data-bar-track">
              <div
                class="data-bar-fill group-hover:bg-accent! transition-colors"
                :style="{ width: pct(cat.count, maxCategoryCount) }"
              />
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-for="i in 10" :key="i" class="mb-3">
          <div class="h-3 w-3/4 animate-pulse bg-surface-ruled" />
          <div class="mt-1 h-[3px] animate-pulse bg-surface-ruled" />
        </div>
      </template>
    </aside>

    <!-- ════════ TOP CITIES ════════ -->
    <section class="dash-cities panel reg-marks overflow-y-auto p-5">
      <h2 class="panel-header">GEO.cities</h2>

      <template v-if="cities.length">
        <div class="space-y-2">
          <div
            v-for="(city, idx) in cities.slice(0, 10)"
            :key="city.city"
            class="stagger-item flex items-center gap-2 group"
            :style="{ animationDelay: `${0.05 * idx}s` }"
          >
            <span class="font-mono text-[8.5px] tabular-nums text-ink-ghost w-4 text-right shrink-0">
              {{ String(idx + 1).padStart(2, '0') }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline justify-between mb-0.5">
                <span class="text-[11.5px] text-ink-light truncate group-hover:text-ink transition-colors">
                  {{ city.city || 'Remote' }}
                </span>
                <span class="font-mono text-[10.5px] tabular-nums text-ink-faint ml-2 shrink-0">{{ city.count }}</span>
              </div>
              <div class="data-bar-track">
                <div
                  class="data-bar-fill group-hover:bg-accent! transition-colors"
                  :style="{ width: pct(city.count, maxCityCount) }"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- ════════ EXPERIENCE LEVELS ════════ -->
    <!-- Hidden when scrapes ran without detail-page fetching (no
         seniority_level captured). Reappears automatically once a
         detail-fetching scrape populates job_level. -->
    <section v-if="meaningfulLevels.length" class="dash-levels panel reg-marks overflow-hidden p-5">
      <h2 class="panel-header">LVL.experience</h2>

      <template v-if="meaningfulLevels.length">
        <div class="space-y-3">
          <div
            v-for="(level, idx) in meaningfulLevels"
            :key="level.level"
            class="stagger-item group"
            :style="{ animationDelay: `${0.05 * idx}s` }"
          >
            <div class="flex items-baseline justify-between mb-1">
              <span class="text-[11.5px] text-ink-light group-hover:text-ink transition-colors">{{ level.level }}</span>
              <span class="font-mono text-[10.5px] tabular-nums text-ink-faint group-hover:text-accent transition-colors">{{ level.count }}</span>
            </div>
            <div class="data-bar-track">
              <div
                class="data-bar-fill-accent"
                :style="{ width: pct(level.count, maxLevelCount) }"
              />
            </div>
          </div>
        </div>

        <div v-if="unspecifiedCount" class="mt-4 pt-3 border-t border-ink-ghost/30">
          <div class="flex items-baseline justify-between">
            <span class="font-mono text-[8.5px] uppercase tracking-[0.15em] text-ink-ghost">Unspecified</span>
            <span class="font-mono text-[9.5px] tabular-nums text-ink-ghost">{{ unspecifiedCount }}</span>
          </div>
        </div>
      </template>
    </section>

    <!-- ════════ TOP COMPANIES ════════ -->
    <section class="dash-companies panel reg-marks overflow-y-auto p-5">
      <div class="flex items-center justify-between mb-0">
        <h2 class="panel-header mb-0!">ORG.companies</h2>
        <button
          class="company-filter-toggle font-mono text-[8.5px] uppercase tracking-[0.15em] px-2 py-0.5 rounded cursor-pointer transition-colors"
          :class="companyFilter === 'us' ? 'bg-accent text-white' : 'text-ink-faint hover:text-ink border border-ink-ghost/40'"
          @click="toggleCompanyFilter"
        >
          {{ companyFilter === 'us' ? 'US$' : 'ALL' }}
        </button>
      </div>

      <template v-if="companies.length">
        <table class="w-full">
          <tbody>
            <tr
              v-for="(company, idx) in pagedCompanies"
              :key="company.company"
              class="stagger-item group border-b border-ink-ghost/20 last:border-0"
              :style="{ animationDelay: `${0.04 * idx}s` }"
            >
              <td class="py-1.5 pr-2 align-top">
                <span
                  class="font-mono text-[8.5px] tabular-nums"
                  :class="companiesPage * companiesPerPage + idx < 3 ? 'text-accent font-bold' : 'text-ink-ghost'"
                >
                  {{ String(companiesPage * companiesPerPage + idx + 1).padStart(2, '0') }}
                </span>
              </td>
              <td class="py-1.5 align-top">
                <span class="text-[11.5px] text-ink-light group-hover:text-ink transition-colors inline-flex items-center gap-1.5 truncate max-w-[280px]">
                  {{ company.company }}
                  <button
                    v-if="company.description"
                    type="button"
                    data-company-info
                    class="shrink-0 cursor-help -m-2 p-2 inline-flex items-center justify-center"
                    aria-label="Show company description"
                    @mouseenter="showCompanyTooltip($event, company.description)"
                    @mouseleave="hideCompanyTooltip"
                    @click.stop="toggleCompanyTooltip($event, company.description)"
                  >
                    <svg class="w-3 h-3 text-ink-ghost group-hover:text-ink-faint transition-colors" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 7v4M8 5.5v0" stroke-linecap="round" />
                    </svg>
                  </button>
                  <svg v-else class="w-3 h-3 text-ink-ghost/30 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 7v4M8 5.5v0" stroke-linecap="round" />
                  </svg>
                </span>
              </td>
              <td class="py-1.5 pl-2 text-right align-top">
                <span class="font-mono text-[10.5px] tabular-nums text-ink-faint">{{ company.count }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="companiesPageCount > 1" class="flex items-center justify-between mt-3 pt-2 border-t border-ink-ghost/30">
          <button
            class="font-mono text-[8.5px] uppercase tracking-[0.15em] text-ink-faint hover:text-ink transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
            :disabled="companiesPage === 0"
            @click="companiesPage--"
          >&larr; prev</button>
          <span class="font-mono text-[8.5px] tabular-nums text-ink-ghost">
            {{ companiesPage + 1 }} / {{ companiesPageCount }}
          </span>
          <button
            class="font-mono text-[8.5px] uppercase tracking-[0.15em] text-ink-faint hover:text-ink transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
            :disabled="companiesPage >= companiesPageCount - 1"
            @click="companiesPage++"
          >next &rarr;</button>
        </div>
      </template>
    </section>

    <!-- ════════ FOOTER ════════ -->
    <footer class="dash-footer flex items-center justify-between">
      <span class="font-mono text-[9.5px] tracking-[0.1em] text-ink-faint">
        built with &lt;3 by
        <a href="https://heyjan.de" target="_blank" rel="noopener" class="text-ink-light hover:text-accent transition-colors">heyjan.de</a>
      </span>
      <div class="flex items-center gap-4">
        <a href="https://github.com/heyjan" target="_blank" rel="noopener" class="text-ink-faint hover:text-ink transition-colors" aria-label="GitHub">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
        </a>
        <a href="https://linkedin.com/in/heyjan" target="_blank" rel="noopener" class="text-ink-faint hover:text-ink transition-colors" aria-label="LinkedIn">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
        </a>
      </div>
    </footer>
  </div>

  <Teleport to="body">
    <div
      v-if="companyTooltip"
      class="company-tooltip"
      :style="{ left: companyTooltip.x + 'px', top: companyTooltip.y + 'px' }"
    >
      {{ companyTooltip.text }}
    </div>
  </Teleport>
</template>

<style scoped>
.dash {
  display: grid;
  grid-template-columns: 242px 1fr 286px;
  grid-template-rows: 90px minmax(600px, 1fr) auto auto;
  gap: 6px;
  padding: 0 16px;
  width: 100vw;
}

.dash-header {
  grid-column: 1 / -1;
  grid-row: 1;
  background: #fff;
  border-bottom: 1px solid var(--color-ink-ghost);
  margin: 0 -16px;
  padding: 0 32px;
}
.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}
.header-logo {
  height: 100%;
  object-fit: contain;
  object-position: left;
  flex-shrink: 0;
}
.header-meta {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
}
.dash-stats      { grid-column: 1; grid-row: 2; }
.dash-viewport   { grid-column: 2; grid-row: 2; }
.dash-categories { grid-column: 3; grid-row: 2; }
.dash-cities     { grid-column: 1; grid-row: 3; }
.dash-companies  { grid-column: 2; grid-row: 3; }
.dash-levels     { grid-column: 3; grid-row: 3; }
.dash-footer {
  grid-column: 1 / -1;
  margin: 0 -16px;
  padding: 0 32px;
  height: 48px;
  border-top: 1px solid var(--color-ink-ghost);
}

.city-detail-panel {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border: 1px solid var(--color-ink-ghost);
  border-radius: 4px;
  padding: 14px 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

/* Let clicks pass through the panel surface to the 3D canvas behind it,
   so cities that project beneath the panel (NW Germany) stay clickable
   while the panel is open. Only interactive elements catch events.
   The !important on the auto rule is intentional: the universal-selector
   .none rule above otherwise wins specificity and renders buttons inert. */
.city-detail-stack,
.city-detail-stack .city-detail-panel,
.city-detail-stack .city-detail-panel * {
  pointer-events: none;
}
.city-detail-stack button,
.city-detail-stack a {
  pointer-events: auto !important;
}
.salary-bar-row {
  position: relative;
  height: 4px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 1px;
}
.salary-bar {
  position: absolute;
  top: 0;
  height: 100%;
  background: var(--color-accent);
  opacity: 0.6;
  border-radius: 1px;
}

/* Per-job card nav (prev/next arrows) — same monochrome register
   as the fullscreen + viewport-toggle buttons. */
.city-job-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--color-ink-ghost);
  background: var(--color-surface);
  color: var(--color-ink-faint);
  cursor: pointer;
  transition: color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out;
}
.city-job-nav:hover:not(:disabled) {
  color: var(--color-ink);
  border-color: var(--color-ink);
}
.city-job-nav:disabled {
  opacity: 0.25;
  cursor: default;
}

/* Teleport target — a zero-size container that lives inside the
   viewport panel so tooltips render inside the fullscreen subtree. */
.viewport-overlay-root {
  position: absolute;
  width: 0;
  height: 0;
  top: 0;
  left: 0;
  pointer-events: none;
}

/* ── Fullscreen toggle button (top-right) ────────────────────────── */
.viewport-fs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--color-ink-ghost);
  background: var(--color-surface);
  color: var(--color-ink-faint);
  cursor: pointer;
  transition: color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out;
}
.viewport-fs-btn:hover {
  color: var(--color-ink);
  border-color: var(--color-ink);
}
.viewport-fs-icon {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: square;
  stroke-linejoin: miter;
}

/* When the viewport panel is in browser-native fullscreen, its host
   becomes the root of the screen. Stretch it edge-to-edge, drop the
   tiny panel border so the diagram has the whole canvas. */
.dash-viewport--fullscreen {
  width: 100vw;
  height: 100vh;
  border: 0;
}
.dash-viewport--fullscreen .reg-marks-full {
  display: none;
}

/* ── Viewport mode toggle (used by both map + graph) ─────────────── */
.viewport-toggle {
  background: var(--color-surface);
}
.viewport-toggle-btn {
  padding: 4px 10px;
  border: 1px solid var(--color-ink-ghost);
  background: var(--color-surface);
  color: var(--color-ink-faint);
  cursor: pointer;
  transition: color 160ms ease-out, background 160ms ease-out, border-color 160ms ease-out;
  font-family: var(--font-mono);
}
.viewport-toggle-btn--right {
  border-left: 0;
}
.viewport-toggle-btn:hover {
  color: var(--color-ink);
}
.viewport-toggle-btn--active {
  background: var(--color-ink);
  color: var(--color-surface);
  border-color: var(--color-ink);
}
.viewport-toggle-btn--active:hover {
  color: var(--color-surface);
}

@media (max-width: 1100px) {
  .dash {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto auto auto auto;
    height: auto;
  }
  .dash-header     { grid-column: 1 / -1; grid-row: 1; }
  .dash-stats      { grid-column: 1; grid-row: 2; }
  .dash-categories { grid-column: 2; grid-row: 2; }
  .dash-viewport   { grid-column: 1 / -1; grid-row: 3; min-height: 460px; }
  .dash-cities     { grid-column: 1; grid-row: 4; }
  .dash-companies  { grid-column: 2; grid-row: 4; }
  .dash-levels     { grid-column: 1 / -1; grid-row: 5; }
  .dash-footer     { grid-column: 1 / -1; grid-row: 6; }
}

@media (max-width: 640px) {
  .dash {
    grid-template-columns: 1fr;
    padding: 0 10px;
  }
  .dash-header {
    margin: 0 -10px;
    padding: 8px 12px;
    height: auto !important;
  }
  .header-inner {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .header-logo {
    height: 36px;
  }
  .header-meta {
    gap: 0.5rem;
  }
  .dash-footer {
    margin: 0 -10px;
    padding: 0 20px;
  }
  .dash-header, .dash-stats, .dash-viewport, .dash-categories,
  .dash-cities, .dash-levels, .dash-companies, .dash-footer {
    grid-column: 1;
    grid-row: auto;
  }
  .dash-viewport { min-height: 360px; }
}
</style>

<style>
.company-tooltip {
  position: fixed;
  transform: translateX(-50%) translateY(calc(-100% - 10px));
  width: 260px;
  padding: 10px 12px;
  background: #1a1a1a;
  color: #e5e5e5;
  font-family: ui-monospace, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  pointer-events: none;
}
.company-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: #1a1a1a;
}

/* Graph tooltip — uses .tooltip-panel base, adds a level marker glyph */
.graph-tooltip {
  min-width: 180px;
}
.graph-tooltip-marker {
  display: inline-block;
  width: 8px;
  height: 8px;
  border: 1.2px solid var(--color-ink);
  flex-shrink: 0;
}
/* level 1 = cohort: solid black square */
.graph-tooltip-marker[data-level="1"] {
  background: var(--color-ink);
}
/* level 2 = sub-segment: open square */
.graph-tooltip-marker[data-level="2"] {
  background: var(--color-surface);
}
/* level 3 = tool: crosshair */
.graph-tooltip-marker[data-level="3"] {
  background:
    linear-gradient(var(--color-ink), var(--color-ink)) center / 100% 1.2px no-repeat,
    linear-gradient(var(--color-ink), var(--color-ink)) center / 1.2px 100% no-repeat;
  border-color: transparent;
}
</style>
