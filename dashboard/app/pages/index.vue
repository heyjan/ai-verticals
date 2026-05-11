<script setup lang="ts">
const { overview, byCategory, byCity, byLevel, topCompanies } = useStats()

const stats = computed(() => overview.data.value as Record<string, any> | undefined)
const categories = computed(() => (byCategory.data.value as any[] | undefined) ?? [])
const cities = computed(() => (byCity.data.value as any[] | undefined) ?? [])
const levels = computed(() => (byLevel.data.value as any[] | undefined) ?? [])
const companies = computed(() => (topCompanies.data.value as any[] | undefined) ?? [])

const isLoading = computed(
  () => overview.pending.value || byCategory.pending.value,
)

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

function pct(value: number, max: number): string {
  return `${Math.max((value / max) * 100, 2)}%`
}
</script>

<template>
  <div class="dash blueprint-grid">
    <!-- ════════ HEADER ════════ -->
    <header class="dash-header">
      <div class="flex items-baseline gap-6">
        <h1
          class="glitch-title font-mono text-[15px] font-bold uppercase tracking-[0.35em] text-ink"
          data-text="AI JOB COMMAND CENTER"
        >
          AI JOB COMMAND CENTER
        </h1>
        <div class="h-px flex-1 bg-ink-ghost" />
        <div class="flex items-center gap-4">
          <span class="status-flicker flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">
            <span
              class="block h-[5px] w-[5px] rounded-full"
              :class="isLoading ? 'animate-pulse bg-amber-500' : 'bg-accent'"
            />
            {{ isLoading ? 'SYNCING' : 'ACTIVE' }}
          </span>
          <span class="font-mono text-[9px] tracking-[0.15em] text-ink-ghost">
            {{ new Date().toLocaleDateString('de-DE') }}
          </span>
        </div>
      </div>
      <p class="mt-2 font-mono text-[9px] uppercase tracking-[0.25em] text-ink-faint">
        Labour market intelligence &mdash; Federal Republic of Germany &mdash; {{ stats?.total ?? '...' }} records indexed
      </p>
    </header>

    <!-- ════════ STATS COLUMN ════════ -->
    <aside class="dash-stats panel reg-marks p-5">
      <h2 class="panel-header">SYS.overview</h2>

      <template v-if="stats">
        <div class="grid grid-cols-2 gap-x-4 gap-y-5">
          <div class="stagger-item" style="animation-delay: 0.1s">
            <p class="stat-value">{{ stats.total?.toLocaleString('de-DE') }}</p>
            <p class="stat-label">Jobs</p>
          </div>
          <div class="stagger-item" style="animation-delay: 0.2s">
            <p class="stat-value">{{ stats.totalCompanies?.toLocaleString('de-DE') }}</p>
            <p class="stat-label">Companies</p>
          </div>
          <div class="stagger-item" style="animation-delay: 0.3s">
            <p class="stat-value">{{ stats.totalCities?.toLocaleString('de-DE') }}</p>
            <p class="stat-label">Cities</p>
          </div>
          <div class="stagger-item" style="animation-delay: 0.4s">
            <p class="stat-value">{{ stats.totalCategories?.toLocaleString('de-DE') }}</p>
            <p class="stat-label">Segments</p>
          </div>
        </div>

        <!-- Source indicators -->
        <div class="mt-6 border-t border-ink-ghost/50 pt-4">
          <p class="font-mono text-[8px] uppercase tracking-[0.2em] text-ink-faint mb-3">Data sources</p>
          <div class="space-y-2">
            <div
              v-for="(count, source) in stats.sources"
              :key="source"
              class="flex items-center gap-3"
            >
              <span class="font-mono text-[9px] uppercase tracking-[0.15em] text-ink-light w-16">{{ source }}</span>
              <div class="flex-1 data-bar-track">
                <div
                  class="data-bar-fill"
                  :style="{ width: `${(count as number / stats.total) * 100}%` }"
                />
              </div>
              <span class="font-mono text-[10px] tabular-nums text-ink-light w-8 text-right">{{ count }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="grid grid-cols-2 gap-4">
          <div v-for="i in 4" :key="i">
            <div class="h-7 w-16 animate-pulse bg-surface-ruled" />
            <div class="mt-1 h-2 w-10 animate-pulse bg-surface-ruled" />
          </div>
        </div>
      </template>
    </aside>

    <!-- ════════ 3D VIEWPORT ════════ -->
    <section class="dash-viewport panel reg-marks relative overflow-hidden p-0">
      <!-- Registration marks inner element for all 4 corners -->
      <div class="reg-marks-full absolute inset-0 pointer-events-none z-10" />

      <ClientOnly>
        <SceneSetup>
          <AnimatedGrid />
          <FloatingParticles />
          <GermanyMap
            v-if="mappableCities.length"
            :city-data="mappableCities"
            @hover="onMapHover"
          />
        </SceneSetup>
        <template #fallback>
          <div class="flex h-full items-center justify-center">
            <span class="font-mono text-[10px] uppercase tracking-[0.3em] text-ink-faint animate-pulse">
              Initialising viewport
            </span>
          </div>
        </template>
      </ClientOnly>

      <!-- Map tooltip -->
      <Teleport to="body">
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
            <p class="font-mono text-[9px] uppercase tracking-[0.2em] text-ink-faint">{{ tooltip.city }}</p>
            <p class="font-mono text-[18px] font-bold text-ink mt-0.5">{{ tooltip.count }}<span class="text-[9px] font-normal text-ink-faint ml-1">jobs</span></p>
          </div>
        </Transition>
      </Teleport>

      <!-- Viewport labels -->
      <div class="absolute bottom-2 left-3 z-10 pointer-events-none">
        <p class="font-mono text-[7px] uppercase tracking-[0.3em] text-ink-faint/40">
          geo.distribution // perspective
        </p>
      </div>
      <div class="absolute top-2 right-3 z-10 pointer-events-none">
        <p class="status-flicker font-mono text-[7px] uppercase tracking-[0.3em] text-ink-faint/40">
          viewport.3d
        </p>
      </div>
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
              <span class="text-[11px] text-ink-light group-hover:text-ink transition-colors">{{ cat.category }}</span>
              <span class="font-mono text-[10px] tabular-nums text-ink-faint group-hover:text-accent transition-colors">
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
            <span class="font-mono text-[8px] tabular-nums text-ink-ghost w-4 text-right shrink-0">
              {{ String(idx + 1).padStart(2, '0') }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline justify-between mb-0.5">
                <span class="text-[11px] text-ink-light truncate group-hover:text-ink transition-colors">
                  {{ city.city || 'Remote' }}
                </span>
                <span class="font-mono text-[10px] tabular-nums text-ink-faint ml-2 shrink-0">{{ city.count }}</span>
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
    <section class="dash-levels panel reg-marks overflow-hidden p-5">
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
              <span class="text-[11px] text-ink-light group-hover:text-ink transition-colors">{{ level.level }}</span>
              <span class="font-mono text-[10px] tabular-nums text-ink-faint group-hover:text-accent transition-colors">{{ level.count }}</span>
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
            <span class="font-mono text-[8px] uppercase tracking-[0.15em] text-ink-ghost">Unspecified</span>
            <span class="font-mono text-[9px] tabular-nums text-ink-ghost">{{ unspecifiedCount }}</span>
          </div>
        </div>
      </template>
    </section>

    <!-- ════════ TOP COMPANIES ════════ -->
    <section class="dash-companies panel reg-marks overflow-y-auto p-5">
      <h2 class="panel-header">ORG.companies</h2>

      <template v-if="companies.length">
        <table class="w-full">
          <tbody>
            <tr
              v-for="(company, idx) in companies.slice(0, 12)"
              :key="company.company"
              class="stagger-item group border-b border-ink-ghost/20 last:border-0"
              :style="{ animationDelay: `${0.04 * idx}s` }"
            >
              <td class="py-1.5 pr-2 align-top">
                <span
                  class="font-mono text-[8px] tabular-nums"
                  :class="idx < 3 ? 'text-accent font-bold' : 'text-ink-ghost'"
                >
                  {{ String(idx + 1).padStart(2, '0') }}
                </span>
              </td>
              <td class="py-1.5 align-top">
                <span class="text-[11px] text-ink-light group-hover:text-ink transition-colors block truncate max-w-[160px]">
                  {{ company.company }}
                </span>
              </td>
              <td class="py-1.5 pl-2 text-right align-top">
                <span class="font-mono text-[10px] tabular-nums text-ink-faint">{{ company.count }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ════════ FOOTER LINE ════════ -->
    <footer class="dash-footer flex items-center justify-between">
      <span class="font-mono text-[7px] uppercase tracking-[0.3em] text-ink-ghost">
        LinkedIn + Glassdoor // merged dataset // deduplicated
      </span>
      <span class="font-mono text-[7px] uppercase tracking-[0.3em] text-ink-ghost">
        v1.0.0 // ai-job-classifier
      </span>
    </footer>
  </div>
</template>

<style scoped>
.dash {
  display: grid;
  grid-template-columns: 220px 1fr 260px;
  grid-template-rows: auto 1fr 220px auto;
  gap: 6px;
  padding: 16px;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.dash-header     { grid-column: 1 / -1; padding-bottom: 12px; border-bottom: 1px solid var(--color-ink-ghost); }
.dash-stats      { grid-column: 1; grid-row: 2; }
.dash-viewport   { grid-column: 2; grid-row: 2; }
.dash-categories { grid-column: 3; grid-row: 2; }
.dash-cities     { grid-column: 1; grid-row: 3; }
.dash-levels     { grid-column: 2; grid-row: 3; }
.dash-companies  { grid-column: 3; grid-row: 3; }
.dash-footer     { grid-column: 1 / -1; padding-top: 8px; border-top: 1px solid var(--color-ink-ghost); }

@media (max-width: 1100px) {
  .dash {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto auto auto auto;
    height: auto;
    overflow-y: auto;
  }
  .dash-header     { grid-column: 1 / -1; grid-row: 1; }
  .dash-stats      { grid-column: 1; grid-row: 2; }
  .dash-categories { grid-column: 2; grid-row: 2; }
  .dash-viewport   { grid-column: 1 / -1; grid-row: 3; min-height: 400px; }
  .dash-cities     { grid-column: 1; grid-row: 4; }
  .dash-levels     { grid-column: 2; grid-row: 4; }
  .dash-companies  { grid-column: 1 / -1; grid-row: 5; }
  .dash-footer     { grid-column: 1 / -1; grid-row: 6; }
}

@media (max-width: 640px) {
  .dash {
    grid-template-columns: 1fr;
    padding: 10px;
  }
  .dash-header, .dash-stats, .dash-viewport, .dash-categories,
  .dash-cities, .dash-levels, .dash-companies, .dash-footer {
    grid-column: 1;
    grid-row: auto;
  }
  .dash-viewport { min-height: 300px; }
}
</style>
