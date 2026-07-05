<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface PostingPoint { date: string; count: number; dow: number }
interface IntakePoint { date: string; count: number }
interface Summary {
  total: number
  new_last3: number
  posted_last7: number
  posted_prev7: number
  with_posted: number
  sources: number
  total_companies: number
  new_companies3: number
  total_cities: number
  new_cities3: number
}
interface GrowthData { summary: Summary; posting: PostingPoint[]; intake: IntakePoint[] }
interface RecentJob {
  id: number
  title: string
  company: string
  city: string
  category: string
  salary: string
  url: string
  source: string
  posted_date: string
  age_days: number
}

const props = defineProps<{
  data: GrowthData | undefined
  jobs: RecentJob[]
  pending: boolean
}>()

const summary = computed(() => props.data?.summary)
const posting = computed(() => props.data?.posting ?? [])
const intake = computed(() => props.data?.intake ?? [])

// ── KPIs ──────────────────────────────────────────────────────────────
const velocity = computed(() =>
  summary.value ? Math.round(summary.value.posted_last7 / 7) : 0,
)
const peak = computed(() => {
  let best: PostingPoint | null = null
  for (const p of posting.value) if (!best || p.count > best.count) best = p
  return best
})

// 3-day movement for an entity count (companies / cities). Net-new entities
// only ever rise as we discover them, but the renderer handles a negative
// (e.g. pruning) too, colouring up/down accordingly.
function deltaLabel(n: number): string {
  if (n > 0) return `+${n} new · 3d`
  if (n < 0) return `${n} · 3d`
  return 'no change · 3d'
}

// ── Posting-activity bars ────────────────────────────────────────────
const postingMax = computed(() =>
  Math.max(1, ...posting.value.map((p) => p.count)),
)
function barHeight(c: number): string {
  // floor at 3% so a single-job day is still a visible sliver
  return `${Math.max((c / postingMax.value) * 100, c > 0 ? 4 : 0)}%`
}
const isWeekend = (dow: number) => dow === 0 || dow === 6

// Label only a handful of x-ticks so they don't collide.
function xTickLabel(p: PostingPoint, i: number): string | null {
  const n = posting.value.length
  const step = n > 14 ? 4 : n > 8 ? 2 : 1
  if (i === n - 1 || i % step === 0) return shortDate(p.date)
  return null
}

// ── Cumulative dataset-growth line (from intake running sum) ──────────
const cumulative = computed(() => {
  let acc = 0
  return intake.value.map((d) => {
    acc += d.count
    return { date: d.date, total: acc }
  })
})
const VW = 100
const VH = 32
// step path: hold each level until the next ingest day, then jump.
const cumulativePath = computed(() => {
  const pts = cumulative.value
  if (pts.length < 1) return { line: '', area: '' }
  const max = pts[pts.length - 1].total || 1
  const n = pts.length
  const x = (i: number) => (n === 1 ? VW : (i / (n - 1)) * VW)
  const y = (v: number) => VH - (v / max) * (VH - 2) - 1
  let line = `M 0 ${y(0).toFixed(2)}`
  pts.forEach((p, i) => {
    const px = x(i).toFixed(2)
    line += ` L ${px} ${y(i === 0 ? 0 : pts[i - 1].total).toFixed(2)}`
    line += ` L ${px} ${y(p.total).toFixed(2)}`
  })
  line += ` L ${VW} ${y(pts[n - 1].total).toFixed(2)}`
  const area = `${line} L ${VW} ${VH} L 0 ${VH} Z`
  return { line, area }
})

// ── Date helpers ─────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[Number(m)]} ${Number(d)}`
}

// ── Fresh-jobs feed (one at a time) ──────────────────────────────────
// Optional title filter: drop student/thesis/intern/Werkstudent roles.
const EXCLUDE_RE = /\b(student|thesis|intern(ship)?|werkstudent|praktikum|praxissemester)\b/i
const showSettings = ref(false)
const excludeJunior = ref(false)
const filteredJobs = computed(() =>
  excludeJunior.value
    ? props.jobs.filter((j) => !EXCLUDE_RE.test(j.title))
    : props.jobs,
)

const idx = ref(0)
watch(
  [filteredJobs],
  () => { idx.value = 0 },
)
const job = computed(() => filteredJobs.value[idx.value] ?? null)
function prev() { if (idx.value > 0) idx.value-- }
function next() { if (idx.value < filteredJobs.value.length - 1) idx.value++ }

function ageLabel(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}
function salaryLabel(raw: string): string | null {
  if (!raw) return null
  const m = raw.match(/^(\d{4,6})-(\d{4,6})/)
  if (!m) return null
  const k = (n: number) => `${Math.round(n / 1000)}k`
  return `${k(Number(m[1]))}–${k(Number(m[2]))}`
}
</script>

<template>
  <div class="growth">
    <!-- ── Loading skeleton ── -->
    <template v-if="pending && !data">
      <div class="growth-kpis">
        <div v-for="i in 6" :key="i" class="kpi-tile">
          <div class="h-6 w-16 animate-pulse bg-surface-ruled" />
          <div class="mt-2 h-2 w-12 animate-pulse bg-surface-ruled" />
        </div>
      </div>
      <div class="mt-3 h-full animate-pulse bg-surface-ruled/50" />
    </template>

    <template v-else-if="summary">
      <!-- ════ left: charts ════ -->
      <div class="growth-main">
        <!-- KPI tiles -->
        <div class="growth-kpis">
          <div class="kpi-tile stagger-item" style="animation-delay: 0.05s">
            <p class="kpi-value">{{ summary.total.toLocaleString('de-DE') }}</p>
            <p class="kpi-label">jobs tracked</p>
            <p class="kpi-sub kpi-sub--up">+{{ summary.new_last3 }} new · 3d</p>
          </div>
          <div class="kpi-tile stagger-item" style="animation-delay: 0.1s">
            <p class="kpi-value">{{ summary.total_companies.toLocaleString('de-DE') }}</p>
            <p class="kpi-label">companies</p>
            <p
              class="kpi-sub"
              :class="summary.new_companies3 > 0 ? 'kpi-sub--up' : summary.new_companies3 < 0 ? 'kpi-sub--down' : ''"
            >{{ deltaLabel(summary.new_companies3) }}</p>
          </div>
          <div class="kpi-tile stagger-item" style="animation-delay: 0.15s">
            <p class="kpi-value">{{ summary.total_cities.toLocaleString('de-DE') }}</p>
            <p class="kpi-label">cities</p>
            <p
              class="kpi-sub"
              :class="summary.new_cities3 > 0 ? 'kpi-sub--up' : summary.new_cities3 < 0 ? 'kpi-sub--down' : ''"
            >{{ deltaLabel(summary.new_cities3) }}</p>
          </div>
          <div class="kpi-tile stagger-item" style="animation-delay: 0.2s">
            <p class="kpi-value">{{ summary.posted_last7.toLocaleString('de-DE') }}</p>
            <p class="kpi-label">posted · 7d</p>
            <p class="kpi-sub">live in the last week</p>
          </div>
          <div class="kpi-tile stagger-item" style="animation-delay: 0.25s">
            <p class="kpi-value">{{ velocity }}<span class="kpi-unit">/d</span></p>
            <p class="kpi-label">velocity</p>
            <p class="kpi-sub">avg postings / day</p>
          </div>
          <div class="kpi-tile stagger-item" style="animation-delay: 0.3s">
            <p class="kpi-value">{{ peak?.count ?? 0 }}</p>
            <p class="kpi-label">peak day</p>
            <p class="kpi-sub">{{ peak ? shortDate(peak.date) : '—' }}</p>
          </div>
        </div>

        <!-- Posting-activity bar chart -->
        <div class="chart-block chart-block--grow">
          <div class="chart-head">
            <span class="chart-title">posting activity</span>
            <span class="chart-legend">
              <span class="legend-swatch legend-swatch--day" /> weekday
              <span class="legend-swatch legend-swatch--weekend ml-2" /> weekend
            </span>
          </div>
          <div class="bars">
            <div
              v-for="(p, i) in posting"
              :key="p.date"
              class="bar-col"
              :title="`${shortDate(p.date)} — ${p.count} posted`"
            >
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :class="isWeekend(p.dow) ? 'bar-fill--weekend' : ''"
                  :style="{ height: barHeight(p.count), animationDelay: `${i * 0.02}s` }"
                />
              </div>
              <span class="bar-tick">{{ xTickLabel(p, i) }}</span>
            </div>
          </div>
        </div>

        <!-- Cumulative dataset growth -->
        <div class="chart-block">
          <div class="chart-head">
            <span class="chart-title">dataset growth</span>
            <span class="chart-legend">cumulative · {{ summary.total.toLocaleString('de-DE') }}</span>
          </div>
          <svg
            class="cumulative-svg"
            :viewBox="`0 0 ${VW} ${VH}`"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path :d="cumulativePath.area" class="cumulative-area" />
            <path :d="cumulativePath.line" class="cumulative-line" />
          </svg>
          <div class="chart-foot">
            <span>{{ cumulative.length ? shortDate(cumulative[0].date) : '' }}</span>
            <span>now</span>
          </div>
        </div>
      </div>

      <!-- ════ right: fresh-jobs feed ════ -->
      <div class="growth-feed">
        <div class="feed-card">
          <div class="feed-head">
            <span class="chart-title">fresh postings</span>
            <div class="feed-head-right">
              <span class="feed-window">last 3 days</span>
              <button class="feed-settings" aria-label="Filter settings" @click="showSettings = true">
                <svg viewBox="0 0 16 16" class="w-3 h-3" aria-hidden="true">
                  <path
                    d="M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM7 1.5h2l.3 1.7a5 5 0 011.4.8l1.6-.7 1 1.7-1.3 1.1a5 5 0 010 1.6l1.3 1.1-1 1.7-1.6-.7a5 5 0 01-1.4.8L9 14.5H7l-.3-1.7a5 5 0 01-1.4-.8l-1.6.7-1-1.7 1.3-1.1a5 5 0 010-1.6L2.7 6.9l1-1.7 1.6.7a5 5 0 011.4-.8L7 1.5z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- ── filter modal ── -->
          <div v-if="showSettings" class="feed-modal" @click.self="showSettings = false">
            <div class="feed-modal-box">
              <div class="feed-modal-head">
                <span class="chart-title">filter postings</span>
                <button class="feed-modal-close" aria-label="Close" @click="showSettings = false">×</button>
              </div>
              <label class="feed-modal-row">
                <input v-model="excludeJunior" type="checkbox" />
                <span>Hide Student, Thesis, Intern, Werkstudent, Praktikum &amp; Praxissemester roles</span>
              </label>
            </div>
          </div>

          <template v-if="job">
            <div class="feed-nav-row">
              <p class="feed-counter">
                <span class="text-ink tabular-nums">{{ idx + 1 }}</span>
                <span class="text-ink-ghost"> / </span>
                <span class="tabular-nums">{{ filteredJobs.length }}</span>
              </p>
              <div class="flex items-center gap-1">
                <button class="feed-nav" :disabled="idx === 0" aria-label="Previous job" @click="prev">
                  <svg viewBox="0 0 16 16" class="w-3 h-3" aria-hidden="true">
                    <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
                  </svg>
                </button>
                <button class="feed-nav" :disabled="idx >= filteredJobs.length - 1" aria-label="Next job" @click="next">
                  <svg viewBox="0 0 16 16" class="w-3 h-3" aria-hidden="true">
                    <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" />
                  </svg>
                </button>
              </div>
            </div>

            <div class="feed-meta-row">
              <span class="feed-age" :class="job.age_days <= 0 ? 'feed-age--today' : ''">{{ ageLabel(job.age_days) }}</span>
              <span class="feed-source">{{ job.source }}</span>
            </div>

            <p class="feed-job-title">
              <a v-if="job.url" :href="job.url" target="_blank" rel="noopener">{{ job.title }}</a>
              <span v-else>{{ job.title }}</span>
            </p>
            <p class="feed-company">{{ job.company }}</p>

            <div class="feed-tags">
              <span v-if="job.city" class="feed-tag">{{ job.city }}</span>
              <span v-if="job.category && job.category !== 'Other'" class="feed-tag">{{ job.category }}</span>
              <span v-if="salaryLabel(job.salary)" class="feed-tag feed-tag--salary">{{ salaryLabel(job.salary) }}</span>
            </div>
          </template>

          <template v-else>
            <p class="feed-empty">No postings in the last 3 days yet.<br />The daily scrape fills this in.</p>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.growth {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr 268px;
  gap: 14px;
  padding: 46px 18px 26px;
  overflow: hidden;
}
.growth-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

/* ── KPI tiles ── */
.growth-kpis {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.kpi-tile {
  border: 1px solid var(--color-ink-ghost);
  background: rgba(255, 255, 255, 0.6);
  padding: 10px 12px;
}
.kpi-value {
  font-family: var(--font-mono);
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--color-ink);
  font-variant-numeric: tabular-nums;
}
.kpi-unit { font-size: 12px; font-weight: 400; color: var(--color-ink-faint); }
.kpi-label {
  font-family: var(--font-mono);
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--color-ink-faint);
  margin-top: 6px;
}
.kpi-sub {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-ink-ghost);
  margin-top: 3px;
}
.kpi-sub--up { color: var(--color-accent); }
.kpi-sub--down { color: #dc2626; }

/* ── chart blocks ── */
.chart-block {
  border: 1px solid var(--color-ink-ghost);
  background: rgba(255, 255, 255, 0.6);
  padding: 10px 12px 8px;
  display: flex;
  flex-direction: column;
}
.chart-block--grow { flex: 1; min-height: 0; }
.chart-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8px;
}
.chart-title {
  font-family: var(--font-mono);
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--color-ink-faint);
}
.chart-legend {
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.08em;
  color: var(--color-ink-ghost);
  display: inline-flex;
  align-items: center;
}
.legend-swatch {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
}
.legend-swatch--day { background: var(--color-ink); }
.legend-swatch--weekend {
  background: repeating-linear-gradient(45deg, var(--color-ink-faint) 0 2px, transparent 2px 4px);
  border: 1px solid var(--color-ink-ghost);
}

/* ── bar chart ── */
.bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 3px;
  min-height: 90px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  min-width: 0;
}
.bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.bar-fill {
  width: 100%;
  max-width: 22px;
  background: var(--color-ink);
  transform-origin: bottom;
  animation: bar-grow 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.bar-fill--weekend {
  background: repeating-linear-gradient(45deg, var(--color-ink-faint) 0 2px, transparent 2px 4px);
  border: 1px solid var(--color-ink-ghost);
  border-bottom: 0;
}
.bar-col:hover .bar-fill { background: var(--color-accent); }
.bar-col:hover .bar-fill--weekend {
  background: repeating-linear-gradient(45deg, var(--color-accent) 0 2px, transparent 2px 4px);
}
@keyframes bar-grow {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}
.bar-tick {
  font-family: var(--font-mono);
  font-size: 7px;
  letter-spacing: 0.04em;
  color: var(--color-ink-ghost);
  margin-top: 4px;
  white-space: nowrap;
  height: 9px;
}

/* ── cumulative line ── */
.cumulative-svg {
  width: 100%;
  height: 48px;
  display: block;
}
.cumulative-area { fill: var(--color-accent); opacity: 0.08; }
.cumulative-line {
  fill: none;
  stroke: var(--color-accent);
  stroke-width: 0.8;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 400;
  stroke-dashoffset: 400;
  animation: line-draw 1.1s ease-out 0.2s forwards;
}
@keyframes line-draw { to { stroke-dashoffset: 0; } }
.chart-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 7.5px;
  color: var(--color-ink-ghost);
}

/* ── fresh-jobs feed ── */
.growth-feed { min-width: 0; display: flex; }
.feed-card {
  position: relative;
  border: 1px solid var(--color-ink-ghost);
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(6px);
  padding: 12px 14px;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.feed-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-ink-ghost);
}
.feed-head-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.feed-window {
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-ink-ghost);
}
.feed-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--color-ink-ghost);
  cursor: pointer;
  transition: color 160ms ease-out;
}
.feed-settings:hover { color: var(--color-ink); }

/* ── filter modal ── */
.feed-modal {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(2px);
}
.feed-modal-box {
  width: min(280px, 90%);
  border: 1px solid var(--color-ink);
  background: var(--color-surface);
  padding: 14px 16px;
}
.feed-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-ink-ghost);
}
.feed-modal-close {
  font-family: var(--font-mono);
  font-size: 16px;
  line-height: 1;
  color: var(--color-ink-faint);
  cursor: pointer;
}
.feed-modal-close:hover { color: var(--color-ink); }
.feed-modal-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.5;
  color: var(--color-ink-light);
  cursor: pointer;
}
.feed-modal-row input {
  margin-top: 1px;
  accent-color: var(--color-accent);
  cursor: pointer;
}
.feed-nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.feed-counter {
  font-family: var(--font-mono);
  font-size: 8.5px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-ink-faint);
}
.feed-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: 1px solid var(--color-ink-ghost);
  background: var(--color-surface);
  color: var(--color-ink-faint);
  cursor: pointer;
  transition: color 160ms ease-out, border-color 160ms ease-out;
}
.feed-nav:hover:not(:disabled) { color: var(--color-ink); border-color: var(--color-ink); }
.feed-nav:disabled { opacity: 0.25; cursor: default; }
.feed-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.feed-age {
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--color-ink-faint);
  border: 1px solid var(--color-ink-ghost);
  padding: 1px 6px;
}
.feed-age--today {
  color: var(--color-surface);
  background: var(--color-accent);
  border-color: var(--color-accent);
}
.feed-source {
  font-family: var(--font-mono);
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--color-ink-ghost);
}
.feed-job-title {
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--color-ink);
  margin-bottom: 4px;
  word-break: break-word;
}
.feed-job-title a:hover { color: var(--color-accent); }
.feed-company {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-ink-light);
  margin-bottom: 12px;
}
.feed-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: auto; }
.feed-tag {
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.05em;
  color: var(--color-ink-light);
  border: 1px solid var(--color-ink-ghost);
  padding: 2px 7px;
}
.feed-tag--salary { color: var(--color-accent); border-color: var(--color-accent); }
.feed-empty {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.6;
  color: var(--color-ink-faint);
  margin-top: 8px;
}

@media (max-width: 900px) {
  .growth {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
    overflow-y: auto;
  }
  .growth-kpis { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 480px) {
  .growth-kpis { grid-template-columns: repeat(2, 1fr); }
  .kpi-tile { padding: 8px 10px; }
  .kpi-value { font-size: 19px; }
}
</style>
