<script setup lang="ts">
/**
 * Knowledge graph — "The Mechanism".
 *
 * A precision-instrument diagram: 13 cohort discs orbit a circular world
 * ring like the gears of an astronomical clock; sub-segments are satellites
 * of each cohort; tools constellate at the world's centre. Every connection
 * is a curved arc that threads through the world's centre, so the eye reads
 * the graph the way you read a polar plot.
 *
 * - 2D SVG only.
 * - Layout is deterministic (categories sorted alphabetically → fixed angular slot).
 * - Three states: idle, hover (a node or its neighbourhood lights up), focus (a
 *   cohort is clicked and blooms outward while everything else recedes).
 * - Pure black/white/grey; the warm-red accent only appears on the active focal point.
 */

import { computed, ref } from 'vue'

interface GraphNode {
  id: string
  label: string
  level: 1 | 2 | 3
  count: number
  parent?: string
}

interface GraphEdge {
  source: string
  target: string
  kind: 'hierarchy' | 'cooccurrence'
  weight: number
}

const props = defineProps<{
  data: { nodes: GraphNode[]; edges: GraphEdge[] }
}>()

const emit = defineEmits<{
  (
    e: 'hover',
    payload: { label: string; count: number; level: number; screenX: number; screenY: number } | null,
  ): void
}>()

// ── Geometry ──────────────────────────────────────────────────────────────
const VIEW_BOX = '-500 -500 1000 1000'
const WORLD_R = 410       // outer world ring
const RING_R_3 = 350      // guide ring (between cohorts and world)
const COHORT_RING_R = 300 // distance from origin to cohort centres
const RING_R_2 = 200      // mid guide ring
const RING_R_1 = 110      // tool-cluster boundary

const COHORT_R_MIN = 36
const COHORT_R_MAX = 56
const SUB_R_MIN = 1.8
const SUB_R_MAX = 3.6
const TOOL_R_MIN = 2.4
const TOOL_R_MAX = 4.6
const TOOL_RING_R = 64

// ── State ─────────────────────────────────────────────────────────────────
const hoveredId = ref<string | null>(null)
const focusedCohortId = ref<string | null>(null)

// ── Helpers ───────────────────────────────────────────────────────────────
function logScale(count: number, min: number, max: number, divisor: number): number {
  const t = Math.min(Math.max(Math.log10(count + 1) / divisor, 0), 1)
  return min + t * (max - min)
}

function polar(compassDeg: number, r: number): { x: number; y: number } {
  const rad = (compassDeg - 90) * (Math.PI / 180) // 0° = north, clockwise+
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) }
}

function labelAnchor(compassDeg: number) {
  const rad = (compassDeg - 90) * (Math.PI / 180)
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  let anchor: 'start' | 'middle' | 'end'
  let baseline: 'auto' | 'hanging' | 'middle'
  if (dx > 0.34) anchor = 'start'
  else if (dx < -0.34) anchor = 'end'
  else anchor = 'middle'
  if (dy > 0.34) baseline = 'hanging'
  else if (dy < -0.34) baseline = 'auto'
  else baseline = 'middle'
  return { anchor, baseline }
}

// ── Layout (memoised by data identity) ────────────────────────────────────
interface SubView {
  id: string
  label: string
  count: number
  parent: string
  // Position in cohort-local coords:
  lx: number
  ly: number
  // Position in world coords (for cooccurrence arcs):
  wx: number
  wy: number
  r: number
  hierarchyD: string
  // Label position + anchoring (cohort-local coords)
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  labelBaseline: 'auto' | 'hanging' | 'middle'
}

interface CohortView {
  id: string
  label: string
  count: number
  compassDeg: number
  x: number
  y: number
  r: number
  labelX: number
  labelY: number
  labelAnchor: 'start' | 'middle' | 'end'
  labelBaseline: 'auto' | 'hanging' | 'middle'
  subs: SubView[]
}

interface ToolView {
  id: string
  label: string
  count: number
  x: number
  y: number
  r: number
}

const layout = computed(() => {
  const cats = props.data.nodes
    .filter((n) => n.level === 1)
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))

  const subsByCat = new Map<string, GraphNode[]>()
  for (const n of props.data.nodes) {
    if (n.level !== 2 || !n.parent) continue
    const arr = subsByCat.get(n.parent) ?? []
    arr.push(n)
    subsByCat.set(n.parent, arr)
  }
  for (const arr of subsByCat.values()) {
    arr.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }

  const N = cats.length
  const cohorts: CohortView[] = cats.map((cat, i) => {
    const compassDeg = (i * 360) / N
    const { x: cx, y: cy } = polar(compassDeg, COHORT_RING_R)
    const r = logScale(cat.count, COHORT_R_MIN, COHORT_R_MAX, 3.0)
    const subs = subsByCat.get(cat.id) ?? []
    const orbitR = r * 0.62
    // Start the sub-ring at the outward radial direction (away from world centre)
    // so the visual rhythm reads outward, then sweep clockwise.
    const startOffset = compassDeg + 180
    const subViews: SubView[] = subs.map((sub, j) => {
      const localCompass = startOffset + (j * 360) / subs.length
      const { x: lx, y: ly } = polar(localCompass, orbitR)
      const subR = logScale(sub.count, SUB_R_MIN, SUB_R_MAX, 2.2)
      // Hierarchy arc: bend tangent to the orbit. Control point = midpoint
      // displaced perpendicular to the line from cohort centre (0,0) to (lx,ly).
      const perpX = -ly
      const perpY = lx
      const perpLen = Math.hypot(perpX, perpY) || 1
      const bend = orbitR * 0.28
      const cpX = lx / 2 + (perpX / perpLen) * bend
      const cpY = ly / 2 + (perpY / perpLen) * bend
      // Label sits just past the sub dot along the radial-outward direction.
      const subDist = Math.hypot(lx, ly) || 1
      const subDx = lx / subDist
      const subDy = ly / subDist
      const labelOffset = subR + 3.2
      const labelX = lx + subDx * labelOffset
      const labelY = ly + subDy * labelOffset
      let labelAnchor: 'start' | 'middle' | 'end'
      if (subDx > 0.34) labelAnchor = 'start'
      else if (subDx < -0.34) labelAnchor = 'end'
      else labelAnchor = 'middle'
      let labelBaseline: 'auto' | 'hanging' | 'middle'
      if (subDy > 0.34) labelBaseline = 'hanging'
      else if (subDy < -0.34) labelBaseline = 'auto'
      else labelBaseline = 'middle'

      return {
        id: sub.id,
        label: sub.label,
        count: sub.count,
        parent: cat.id,
        lx,
        ly,
        wx: cx + lx,
        wy: cy + ly,
        r: subR,
        hierarchyD: `M 0 0 Q ${cpX.toFixed(2)} ${cpY.toFixed(2)} ${lx.toFixed(2)} ${ly.toFixed(2)}`,
        labelX,
        labelY,
        labelAnchor,
        labelBaseline,
      }
    })
    const labelOuter = r + 16
    const labelX = cx + (cx / COHORT_RING_R) * labelOuter
    const labelY = cy + (cy / COHORT_RING_R) * labelOuter
    const { anchor, baseline } = labelAnchor(compassDeg)
    return {
      id: cat.id,
      label: cat.label,
      count: cat.count,
      compassDeg,
      x: cx,
      y: cy,
      r,
      labelX,
      labelY,
      labelAnchor: anchor,
      labelBaseline: baseline,
      subs: subViews,
    }
  })

  const toolsArr = props.data.nodes
    .filter((n) => n.level === 3)
    .slice()
    .sort((a, b) => b.count - a.count)
  const T = toolsArr.length
  const toolViews: ToolView[] = toolsArr.map((t, i) => {
    // Offset start so a tool isn't sitting directly underneath the 0° guide tick.
    const compassDeg = (i * 360) / T + (360 / T) * 0.5
    const { x, y } = polar(compassDeg, TOOL_RING_R)
    return {
      id: t.id,
      label: t.label,
      count: t.count,
      x,
      y,
      r: logScale(t.count, TOOL_R_MIN, TOOL_R_MAX, 2.5),
    }
  })

  return { cohorts, toolViews }
})

// ── Edge geometry ─────────────────────────────────────────────────────────
interface CoArc {
  id: string
  d: string
  subId: string
  toolId: string
  cohortId: string
}

const cooccurrenceArcs = computed<CoArc[]>(() => {
  const subById = new Map<string, SubView>()
  for (const c of layout.value.cohorts) for (const s of c.subs) subById.set(s.id, s)
  const toolById = new Map<string, ToolView>()
  for (const t of layout.value.toolViews) toolById.set(t.id, t)

  const out: CoArc[] = []
  for (const e of props.data.edges) {
    if (e.kind !== 'cooccurrence') continue
    const sub = subById.get(e.source)
    const tool = toolById.get(e.target)
    if (!sub || !tool) continue
    // Cubic bezier with both control points pulled toward the world's centre.
    // Result: every arc bends through the inner region — the world's
    // "gravitational well" — instead of taking a straight line.
    const c1x = sub.wx * 0.18
    const c1y = sub.wy * 0.18
    const c2x = tool.x * 0.45
    const c2y = tool.y * 0.45
    out.push({
      id: `${e.source}::${e.target}`,
      d: `M ${sub.wx.toFixed(2)} ${sub.wy.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${tool.x.toFixed(2)} ${tool.y.toFixed(2)}`,
      subId: e.source,
      toolId: e.target,
      cohortId: sub.parent,
    })
  }
  return out
})

// ── Adjacency lookups ─────────────────────────────────────────────────────
const adjacency = computed(() => {
  const cohortToTools = new Map<string, Set<string>>()
  const cohortToSubs = new Map<string, Set<string>>()
  const subToTools = new Map<string, Set<string>>()
  const toolToSubs = new Map<string, Set<string>>()
  const subToCohort = new Map<string, string>()

  for (const c of layout.value.cohorts) {
    const subSet = new Set<string>()
    for (const s of c.subs) {
      subSet.add(s.id)
      subToCohort.set(s.id, c.id)
    }
    cohortToSubs.set(c.id, subSet)
    cohortToTools.set(c.id, new Set())
  }
  for (const arc of cooccurrenceArcs.value) {
    if (!subToTools.has(arc.subId)) subToTools.set(arc.subId, new Set())
    subToTools.get(arc.subId)!.add(arc.toolId)
    if (!toolToSubs.has(arc.toolId)) toolToSubs.set(arc.toolId, new Set())
    toolToSubs.get(arc.toolId)!.add(arc.subId)
    cohortToTools.get(arc.cohortId)?.add(arc.toolId)
  }
  return { cohortToTools, cohortToSubs, subToTools, toolToSubs, subToCohort }
})

// ── Highlight set (which nodes are "active" right now) ────────────────────
const activeIds = computed<Set<string>>(() => {
  const out = new Set<string>()
  const id = focusedCohortId.value ?? hoveredId.value
  if (!id) return out
  out.add(id)
  const adj = adjacency.value
  if (adj.cohortToSubs.has(id)) {
    // cohort
    adj.cohortToSubs.get(id)!.forEach((s) => out.add(s))
    adj.cohortToTools.get(id)!.forEach((t) => out.add(t))
  } else if (adj.toolToSubs.has(id)) {
    // tool
    adj.toolToSubs.get(id)!.forEach((s) => {
      out.add(s)
      const c = adj.subToCohort.get(s)
      if (c) out.add(c)
    })
  } else if (adj.subToTools.has(id) || adj.subToCohort.has(id)) {
    // sub
    const c = adj.subToCohort.get(id)
    if (c) out.add(c)
    adj.subToTools.get(id)?.forEach((t) => out.add(t))
  }
  return out
})

const isAnyActive = computed(() => focusedCohortId.value !== null || hoveredId.value !== null)

function isDim(id: string): boolean {
  if (!isAnyActive.value) return false
  return !activeIds.value.has(id)
}
function isPrimary(id: string): boolean {
  return id === (focusedCohortId.value ?? hoveredId.value)
}

// Per-arc visibility:
function arcState(arc: CoArc): 'primary' | 'related' | 'dim' | 'idle' {
  const hovOrFocus = focusedCohortId.value ?? hoveredId.value
  if (!hovOrFocus) return 'idle'
  // Arc is "primary" if either endpoint OR its cohort is the active node
  if (
    arc.subId === hovOrFocus ||
    arc.toolId === hovOrFocus ||
    arc.cohortId === hovOrFocus
  )
    return 'primary'
  // "Related" if either endpoint is in the active set
  if (activeIds.value.has(arc.subId) && activeIds.value.has(arc.toolId)) return 'related'
  return 'dim'
}

// ── Interaction ───────────────────────────────────────────────────────────
function emitHover(label: string, count: number, level: number, e: PointerEvent) {
  emit('hover', { label, count, level, screenX: e.clientX, screenY: e.clientY })
}

function onCohortEnter(c: CohortView, e: PointerEvent) {
  hoveredId.value = c.id
  emitHover(c.label, c.count, 1, e)
}
function onCohortMove(c: CohortView, e: PointerEvent) {
  if (hoveredId.value === c.id) emitHover(c.label, c.count, 1, e)
}
function onCohortClick(c: CohortView, e: MouseEvent) {
  e.stopPropagation()
  focusedCohortId.value = focusedCohortId.value === c.id ? null : c.id
}

function onSubEnter(s: SubView, e: PointerEvent) {
  hoveredId.value = s.id
  emitHover(s.label, s.count, 2, e)
}
function onSubMove(s: SubView, e: PointerEvent) {
  if (hoveredId.value === s.id) emitHover(s.label, s.count, 2, e)
}

function onToolEnter(t: ToolView, e: PointerEvent) {
  hoveredId.value = t.id
  emitHover(t.label, t.count, 3, e)
}
function onToolMove(t: ToolView, e: PointerEvent) {
  if (hoveredId.value === t.id) emitHover(t.label, t.count, 3, e)
}

function onNodeLeave() {
  hoveredId.value = null
  emit('hover', null)
}

function onBackgroundClick() {
  if (focusedCohortId.value) focusedCohortId.value = null
}

// ── Cohort transform (handles morph in focus mode) ────────────────────────
// Returns an SVG `transform` attribute value. SVG transforms compose
// left-to-right: translate first, then scale relative to the translated
// origin — which is exactly the cohort-local origin we want to scale
// around. Modern browsers (Chrome 87+, Firefox 92+, Safari 16+) interpolate
// the SVG transform attribute via CSS transitions automatically.
function cohortTransform(c: CohortView): string {
  const focusedId = focusedCohortId.value
  if (focusedId === null) {
    const scale = hoveredId.value === c.id ? 1.06 : 1
    return `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(${scale})`
  }
  if (c.id === focusedId) {
    // Bloom — pulled toward the centre and scaled up.
    const focusedX = c.x * 0.55
    const focusedY = c.y * 0.55
    return `translate(${focusedX.toFixed(2)} ${focusedY.toFixed(2)}) scale(1.55)`
  }
  // Other cohorts: stay in place; opacity does the heavy lifting.
  return `translate(${c.x.toFixed(2)} ${c.y.toFixed(2)}) scale(0.9)`
}

function toolTransform(t: ToolView): string {
  return `translate(${t.x.toFixed(2)} ${t.y.toFixed(2)})`
}

// ── Render order — push focused cohort to the end so it paints on top ────
// SVG has no z-index; paint order = document order.
const cohortRenderOrder = computed(() => {
  const cohorts = layout.value.cohorts
  const focusedId = focusedCohortId.value
  if (!focusedId) return cohorts
  const focused = cohorts.find((c) => c.id === focusedId)
  if (!focused) return cohorts
  return [...cohorts.filter((c) => c.id !== focusedId), focused]
})

// ── Compass ticks ─────────────────────────────────────────────────────────
const ticks = computed(() => {
  const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
  for (let deg = 0; deg < 360; deg += 6) {
    const major = deg % 30 === 0
    const cardinal = deg % 90 === 0
    const inner = WORLD_R - (cardinal ? 14 : major ? 8 : 4)
    const outer = WORLD_R
    const { x: x1, y: y1 } = polar(deg, inner)
    const { x: x2, y: y2 } = polar(deg, outer)
    out.push({ x1, y1, x2, y2, major: major || cardinal })
  }
  return out
})

const cardinalLabels = computed(() =>
  [0, 90, 180, 270].map((deg) => {
    const { x, y } = polar(deg, WORLD_R + 28)
    return {
      deg,
      x,
      y,
      label: ['000°', '090°', '180°', '270°'][deg / 90]!,
    }
  }),
)

// ── Tool ranking for the engaged cohort ───────────────────────────────────
// When a cohort is hovered or focused, list its linked centre-tools ranked by
// how many jobs connect them (co-occurrence weight summed across the cohort's
// sub-segments). Answers "which tools are these arcs pointing to, and which
// matter most" without needing to hover each centre dot.
const activeCohort = computed<CohortView | null>(() => {
  const id = focusedCohortId.value ?? hoveredId.value
  if (!id) return null
  return layout.value.cohorts.find((c) => c.id === id) ?? null
})

const TOOLLIST_LIMIT = 12

const activeCohortTools = computed(() => {
  const c = activeCohort.value
  if (!c) return []
  const subIds = new Set(c.subs.map((s) => s.id))
  const weightByTool = new Map<string, number>()
  for (const e of props.data.edges) {
    if (e.kind !== 'cooccurrence' || !subIds.has(e.source)) continue
    weightByTool.set(e.target, (weightByTool.get(e.target) ?? 0) + e.weight)
  }
  const labelById = new Map(layout.value.toolViews.map((t) => [t.id, t.label]))
  return [...weightByTool.entries()]
    .map(([id, weight]) => ({ id, label: labelById.get(id) ?? id, weight }))
    .sort((a, b) => b.weight - a.weight)
})
</script>

<template>
  <div class="kg-root" @click="onBackgroundClick">
    <svg
      :viewBox="VIEW_BOX"
      class="kg-svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Knowledge graph"
    >
      <!-- ── BACKGROUND FRAME ───────────────────────────────────────── -->
      <g class="kg-frame">
        <circle r="110" class="kg-guide-ring" />
        <circle r="200" class="kg-guide-ring" />
        <circle r="300" class="kg-guide-ring kg-guide-ring--prominent" />
        <circle r="350" class="kg-guide-ring" />
        <circle :r="WORLD_R" class="kg-world-ring" />

        <!-- Compass tick marks around the world ring -->
        <g class="kg-ticks">
          <line
            v-for="(t, i) in ticks"
            :key="i"
            :x1="t.x1"
            :y1="t.y1"
            :x2="t.x2"
            :y2="t.y2"
            :class="t.major ? 'kg-tick kg-tick--major' : 'kg-tick'"
          />
        </g>

        <!-- Cardinal numerals -->
        <g class="kg-compass">
          <text
            v-for="c in cardinalLabels"
            :key="c.deg"
            :x="c.x"
            :y="c.y"
            text-anchor="middle"
            dominant-baseline="middle"
          >{{ c.label }}</text>
        </g>

        <!-- Centre crosshair — drafting reference point -->
        <g class="kg-centre-cross">
          <line x1="-8" y1="0" x2="8" y2="0" />
          <line x1="0" y1="-8" x2="0" y2="8" />
          <circle r="2.2" />
        </g>
      </g>

      <!-- ── COOCCURRENCE ARCS (drawn under everything) ─────────────── -->
      <g class="kg-arcs" :class="{ 'kg-arcs--focused': focusedCohortId !== null }">
        <path
          v-for="arc in cooccurrenceArcs"
          :key="arc.id"
          :d="arc.d"
          :class="[
            'kg-arc',
            `kg-arc--${arcState(arc)}`,
          ]"
        />
      </g>

      <!-- ── TOOL CONSTELLATION (centre) ───────────────────────────── -->
      <g class="kg-tools">
        <g
          v-for="t in layout.toolViews"
          :key="t.id"
          class="kg-tool"
          :class="{
            'kg-tool--primary': isPrimary(t.id),
            'kg-tool--active': activeIds.has(t.id) && !isPrimary(t.id),
            'kg-tool--dim': isDim(t.id),
          }"
          :transform="toolTransform(t)"
          @pointerenter="onToolEnter(t, $event)"
          @pointermove="onToolMove(t, $event)"
          @pointerleave="onNodeLeave"
        >
          <!-- Plus-cross drafting mark -->
          <path
            :d="`M ${-t.r * 1.6} 0 L ${t.r * 1.6} 0 M 0 ${-t.r * 1.6} L 0 ${t.r * 1.6}`"
            class="kg-tool-cross"
          />
          <circle :r="t.r * 0.9" class="kg-tool-dot" />
          <!-- Pointer hit target -->
          <circle :r="Math.max(t.r * 3.2, 9)" class="kg-tool-hit" />
        </g>
      </g>

      <!-- ── COHORTS ───────────────────────────────────────────────── -->
      <g class="kg-cohorts">
        <g
          v-for="c in cohortRenderOrder"
          :key="c.id"
          class="kg-cohort"
          :class="{
            'kg-cohort--primary': isPrimary(c.id),
            'kg-cohort--active': activeIds.has(c.id) && !isPrimary(c.id),
            'kg-cohort--dim': isDim(c.id),
            'kg-cohort--focused': focusedCohortId === c.id,
            'kg-cohort--unfocused': focusedCohortId !== null && focusedCohortId !== c.id,
          }"
          :transform="cohortTransform(c)"
        >
          <!-- The cohort disc itself -->
          <circle :r="c.r" class="kg-cohort-disc" />
          <!-- Inner orbit guide (where subs sit) -->
          <circle :r="c.r * 0.62" class="kg-cohort-orbit" />

          <!-- Hierarchy arcs (cat-centre → sub) -->
          <g class="kg-hierarchy">
            <path
              v-for="s in c.subs"
              :key="s.id"
              :d="s.hierarchyD"
              class="kg-hierarchy-arc"
            />
          </g>

          <!-- Sub-segments -->
          <g class="kg-subs">
            <circle
              v-for="s in c.subs"
              :key="s.id"
              :cx="s.lx"
              :cy="s.ly"
              :r="s.r"
              :class="[
                'kg-sub',
                {
                  'kg-sub--primary': isPrimary(s.id),
                  'kg-sub--active': activeIds.has(s.id) && !isPrimary(s.id),
                  'kg-sub--dim': isDim(s.id),
                },
              ]"
              @pointerenter="onSubEnter(s, $event)"
              @pointermove="onSubMove(s, $event)"
              @pointerleave="onNodeLeave"
            />
          </g>

          <!-- Sub-segment labels — hidden until the cohort is engaged
               (hovered, focused, or a child sub/tool of it is hovered) -->
          <g class="kg-sub-labels">
            <text
              v-for="s in c.subs"
              :key="`l-${s.id}`"
              :x="s.labelX"
              :y="s.labelY"
              :text-anchor="s.labelAnchor"
              :dominant-baseline="s.labelBaseline"
              :class="[
                'kg-sub-label',
                {
                  'kg-sub-label--primary': isPrimary(s.id),
                },
              ]"
            >{{ s.label }}</text>
          </g>

          <!-- Cohort centre — drafting target -->
          <g class="kg-cohort-centre">
            <circle r="3.2" />
            <line x1="-7" y1="0" x2="7" y2="0" />
            <line x1="0" y1="-7" x2="0" y2="7" />
          </g>

          <!-- Pointer hit target covers the whole cohort area -->
          <circle
            :r="c.r * 1.12"
            class="kg-cohort-hit"
            @pointerenter="onCohortEnter(c, $event)"
            @pointermove="onCohortMove(c, $event)"
            @pointerleave="onNodeLeave"
            @click="onCohortClick(c, $event)"
          />
        </g>
      </g>

      <!-- ── COHORT LABELS (drawn on top of everything) ────────────── -->
      <g class="kg-labels">
        <g
          v-for="c in cohortRenderOrder"
          :key="c.id"
          class="kg-label-group"
          :class="{
            'kg-label-group--primary': isPrimary(c.id),
            'kg-label-group--focused': focusedCohortId === c.id,
            'kg-label-group--dim': isDim(c.id),
          }"
        >
          <text
            :x="c.labelX"
            :y="c.labelY"
            :text-anchor="c.labelAnchor"
            :dominant-baseline="c.labelBaseline"
            class="kg-label"
          >{{ c.label }}</text>
          <text
            :x="c.labelX"
            :y="c.labelY"
            :text-anchor="c.labelAnchor"
            :dominant-baseline="c.labelBaseline"
            class="kg-label-count"
            :dy="c.labelBaseline === 'auto' ? -11 : c.labelBaseline === 'hanging' ? 11 : 0"
            :dx="c.labelAnchor === 'middle' ? 0 : 0"
          >{{ c.count.toLocaleString('en-US') }} jobs</text>
        </g>
      </g>

      <!-- ── INSTRUMENT LEGEND (corner badge) ──────────────────────── -->
      <g class="kg-legend" transform="translate(-470 -470)">
        <text x="0" y="0" class="kg-legend-eyebrow">FIG. 01 // mechanism</text>
        <text x="0" y="14" class="kg-legend-meta">cohorts {{ layout.cohorts.length }} · subs {{ layout.cohorts.reduce((s, c) => s + c.subs.length, 0) }} · tools {{ layout.toolViews.length }}</text>
      </g>
      <g class="kg-legend kg-legend--right" transform="translate(470 -470)">
        <text x="0" y="0" class="kg-legend-eyebrow" text-anchor="end">scale // log₁₀(count)</text>
        <text x="0" y="14" class="kg-legend-meta" text-anchor="end">arcs · {{ cooccurrenceArcs.length }} cooccurrence</text>
      </g>
      <g class="kg-legend" transform="translate(-470 460)">
        <text x="0" y="0" class="kg-legend-meta">drag · scroll disabled · click cohort to focus</text>
      </g>
    </svg>

    <!-- Tool ranking for the engaged cohort — sits in the empty top-left
         corner (outside the circular ring) so it never covers the graph. -->
    <Transition name="kg-toollist">
      <div v-if="activeCohort && activeCohortTools.length" class="kg-toollist">
        <div class="kg-toollist-head">
          <span class="kg-toollist-eyebrow">Tools · Skills</span>
          <span class="kg-toollist-cohort">{{ activeCohort.label }}</span>
        </div>
        <ul class="kg-toollist-items">
          <li
            v-for="t in activeCohortTools.slice(0, TOOLLIST_LIMIT)"
            :key="t.id"
            class="kg-toollist-item"
          >
            <span class="kg-toollist-label">{{ t.label }}</span>
            <span class="kg-toollist-count">{{ t.weight.toLocaleString('en-US') }}</span>
          </li>
        </ul>
        <div v-if="activeCohortTools.length > TOOLLIST_LIMIT" class="kg-toollist-more">
          +{{ activeCohortTools.length - TOOLLIST_LIMIT }} more
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.kg-root {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface);
  cursor: default;
  overflow: hidden;
}

.kg-svg {
  width: 100%;
  height: 100%;
  display: block;
  /* Subtle paper-texture vignette so the centre feels brighter than the edges */
  background:
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 1) 0%, rgba(250, 250, 248, 1) 55%, rgba(245, 245, 240, 1) 100%);
  animation: kg-entrance 700ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes kg-entrance {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Background frame ─────────────────────────────────────────────── */
.kg-frame {
  fill: none;
  stroke: var(--color-ink-ghost);
  stroke-width: 0.5;
}
.kg-guide-ring {
  stroke: var(--color-ink-ghost);
  stroke-opacity: 0.22;
  stroke-dasharray: 1 4;
}
.kg-guide-ring--prominent {
  stroke-opacity: 0.32;
  stroke-dasharray: 2 6;
}
.kg-world-ring {
  stroke: var(--color-ink);
  stroke-width: 0.8;
  stroke-opacity: 0.55;
  animation: kg-world-draw 1100ms cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes kg-world-draw {
  from {
    stroke-dasharray: 0 2600;
    stroke-dashoffset: 0;
  }
  to {
    stroke-dasharray: 2600 0;
    stroke-dashoffset: 0;
  }
}
.kg-tick {
  stroke: var(--color-ink);
  stroke-width: 0.6;
  stroke-opacity: 0.35;
}
.kg-tick--major {
  stroke-width: 0.9;
  stroke-opacity: 0.7;
}
.kg-compass text {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.18em;
  fill: var(--color-ink-faint);
}
.kg-centre-cross {
  fill: var(--color-ink);
  stroke: var(--color-ink);
  stroke-width: 0.8;
}
.kg-centre-cross circle {
  fill: var(--color-surface);
  stroke: var(--color-ink);
  stroke-width: 1;
}

/* ── Cooccurrence arcs ────────────────────────────────────────────── */
.kg-arcs {
  fill: none;
  pointer-events: none;
}
.kg-arc {
  fill: none;
  stroke: var(--color-ink);
  stroke-width: 0.5;
  stroke-linecap: round;
  transition:
    stroke-opacity 240ms cubic-bezier(0.16, 1, 0.3, 1),
    stroke-width 240ms cubic-bezier(0.16, 1, 0.3, 1),
    stroke 240ms ease-out;
}
.kg-arc--idle    { stroke-opacity: 0.18; }
.kg-arc--primary { stroke-opacity: 0.85; stroke-width: 1.0; stroke: var(--color-ink); }
.kg-arc--related { stroke-opacity: 0.55; stroke-width: 0.8; }
.kg-arc--dim     { stroke-opacity: 0.04; }

/* ── Cohorts ──────────────────────────────────────────────────────── */
.kg-cohorts {
  /* No transform — children handle their own */
}
.kg-cohort {
  transition:
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 320ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
  animation: kg-cohort-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(60ms + var(--kg-stagger, 0ms));
}
@keyframes kg-cohort-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.kg-cohort-disc {
  fill: var(--color-surface);
  stroke: var(--color-ink);
  stroke-width: 0.8;
  stroke-opacity: 0.45;
  transition: stroke 240ms ease-out, stroke-opacity 240ms ease-out, stroke-width 240ms ease-out;
}
.kg-cohort-orbit {
  fill: none;
  stroke: var(--color-ink-ghost);
  stroke-width: 0.4;
  stroke-opacity: 0.45;
  stroke-dasharray: 1 3;
}
.kg-cohort-centre {
  fill: var(--color-ink);
  stroke: var(--color-ink);
  stroke-width: 0.6;
  pointer-events: none;
  transition: fill 240ms ease-out, stroke 240ms ease-out;
}
.kg-cohort-centre line {
  stroke-opacity: 0.7;
}
.kg-cohort-hit {
  fill: transparent;
  cursor: pointer;
}
.kg-cohort-hit:hover {
  /* No visual change — handled by parent class */
}

/* Cohort states */
.kg-cohort--dim { opacity: 0.16; }
.kg-cohort--active .kg-cohort-disc { stroke-opacity: 0.85; }
.kg-cohort--active .kg-cohort-centre { fill: var(--color-ink); }
/* Hover emphasis stays monochrome — the warm-red accent is reserved for the
   focal point (a clicked/focused cohort), so plain hover no longer reds. */
.kg-cohort--primary .kg-cohort-disc {
  stroke: var(--color-ink);
  stroke-opacity: 1;
  stroke-width: 1.4;
}
.kg-cohort--primary .kg-cohort-centre {
  fill: var(--color-ink);
  stroke: var(--color-ink);
}
.kg-cohort--primary .kg-cohort-orbit {
  stroke: var(--color-ink-faint);
  stroke-opacity: 0.8;
}
.kg-cohort--focused .kg-cohort-disc {
  stroke: var(--color-accent);
  stroke-opacity: 1;
  stroke-width: 1.6;
}
.kg-cohort--focused .kg-cohort-centre {
  fill: var(--color-accent);
  stroke: var(--color-accent);
}
.kg-cohort--unfocused {
  opacity: 0.12;
}

/* Hierarchy arcs within a cohort */
.kg-hierarchy {
  fill: none;
  pointer-events: none;
}
.kg-hierarchy-arc {
  fill: none;
  stroke: var(--color-ink);
  stroke-width: 0.5;
  stroke-opacity: 0.35;
  transition: stroke-opacity 240ms ease-out, stroke 240ms ease-out;
}
.kg-cohort--active .kg-hierarchy-arc,
.kg-cohort--primary .kg-hierarchy-arc {
  stroke-opacity: 0.85;
}

/* Sub-segment labels — fade in when the parent cohort is engaged.
   They render inside the cohort's group transform, so they scale up
   automatically when the cohort blooms in focus mode. */
.kg-sub-labels {
  pointer-events: none;
}
.kg-sub-label {
  font-family: var(--font-mono);
  font-size: 5.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  fill: var(--color-ink-faint);
  opacity: 0;
  transition: opacity 240ms ease-out, fill 200ms ease-out;
}
.kg-cohort--active .kg-sub-label,
.kg-cohort--primary .kg-sub-label,
.kg-cohort--focused .kg-sub-label {
  opacity: 1;
  fill: var(--color-ink);
}
.kg-sub-label--primary {
  fill: var(--color-accent) !important;
  font-weight: 600;
}

/* Sub-segments */
.kg-sub {
  fill: var(--color-ink);
  stroke: var(--color-surface);
  stroke-width: 0.6;
  cursor: pointer;
  transition:
    fill 200ms ease-out,
    r 200ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 200ms ease-out;
}
.kg-sub:hover { fill: var(--color-accent); }
.kg-sub--dim { opacity: 0.18; }
.kg-sub--active { fill: var(--color-ink); }
.kg-sub--primary {
  fill: var(--color-accent);
}

/* ── Tools (centre constellation) ─────────────────────────────────── */
.kg-tools {
  /* Group transforms applied per-tool */
}
.kg-tool {
  transition:
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 240ms ease-out;
  animation: kg-tool-in 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 380ms;
}
@keyframes kg-tool-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.kg-tool-cross {
  stroke: var(--color-ink);
  stroke-width: 0.8;
  stroke-opacity: 0.65;
  transition: stroke 240ms ease-out, stroke-opacity 240ms ease-out, stroke-width 240ms ease-out;
}
.kg-tool-dot {
  fill: var(--color-surface);
  stroke: var(--color-ink);
  stroke-width: 0.7;
  transition: fill 240ms ease-out, stroke 240ms ease-out;
}
.kg-tool-hit {
  fill: transparent;
  cursor: pointer;
}
.kg-tool--dim { opacity: 0.15; }
.kg-tool--active .kg-tool-cross { stroke-opacity: 1; stroke-width: 1.1; }
.kg-tool--active .kg-tool-dot   { fill: var(--color-ink); }
.kg-tool--primary .kg-tool-cross { stroke: var(--color-accent); stroke-opacity: 1; stroke-width: 1.2; }
.kg-tool--primary .kg-tool-dot   { fill: var(--color-accent); stroke: var(--color-accent); }

/* ── Labels ───────────────────────────────────────────────────────── */
.kg-labels {
  pointer-events: none;
}
.kg-label-group {
  transition: opacity 240ms ease-out;
}
.kg-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  fill: var(--color-ink);
  transition: fill 200ms ease-out;
}
.kg-label-count {
  font-family: var(--font-mono);
  font-size: 7.5px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  fill: var(--color-ink-faint);
}
.kg-label-group--dim { opacity: 0.2; }
/* Hover keeps the label in ink; only the focused cohort's label goes accent. */
.kg-label-group--primary .kg-label { fill: var(--color-ink); }
.kg-label-group--focused .kg-label { fill: var(--color-accent); }
.kg-label-group--focused .kg-label-count { fill: var(--color-accent); }

/* ── Corner legends ───────────────────────────────────────────────── */
.kg-legend text {
  font-family: var(--font-mono);
  fill: var(--color-ink-faint);
}
.kg-legend-eyebrow {
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
}
.kg-legend-meta {
  font-size: 7.5px;
  font-weight: 400;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  fill: var(--color-ink-ghost);
}

/* ── Stagger in entrance for cohorts (set inline via CSS vars in template?
   Instead, use nth-child) ─────────────────────────────────────────── */
.kg-cohort:nth-child(1)  { animation-delay: 80ms; }
.kg-cohort:nth-child(2)  { animation-delay: 120ms; }
.kg-cohort:nth-child(3)  { animation-delay: 160ms; }
.kg-cohort:nth-child(4)  { animation-delay: 200ms; }
.kg-cohort:nth-child(5)  { animation-delay: 240ms; }
.kg-cohort:nth-child(6)  { animation-delay: 280ms; }
.kg-cohort:nth-child(7)  { animation-delay: 320ms; }
.kg-cohort:nth-child(8)  { animation-delay: 360ms; }
.kg-cohort:nth-child(9)  { animation-delay: 400ms; }
.kg-cohort:nth-child(10) { animation-delay: 440ms; }
.kg-cohort:nth-child(11) { animation-delay: 480ms; }
.kg-cohort:nth-child(12) { animation-delay: 520ms; }
.kg-cohort:nth-child(13) { animation-delay: 560ms; }

/* ── Cohort tool ranking box (top-left corner overlay) ────────────── */
.kg-toollist {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 5;
  width: 190px;
  padding: 9px 11px 10px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--color-ink-ghost);
  pointer-events: none;
}
.kg-toollist-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 7px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-ink-ghost);
}
.kg-toollist-eyebrow {
  font-family: var(--font-mono);
  font-size: 7.5px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--color-ink-faint);
}
.kg-toollist-cohort {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-ink);
}
.kg-toollist-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.kg-toollist-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.kg-toollist-label {
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-ink-light);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.kg-toollist-item:first-child .kg-toollist-label {
  color: var(--color-ink);
  font-weight: 600;
}
.kg-toollist-count {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 8.5px;
  font-variant-numeric: tabular-nums;
  color: var(--color-ink-faint);
}
.kg-toollist-more {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 8px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-ink-faint);
}
.kg-toollist-enter-active,
.kg-toollist-leave-active {
  transition: opacity 180ms ease-out;
}
.kg-toollist-enter-from,
.kg-toollist-leave-to {
  opacity: 0;
}
</style>
