<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRenderLoop } from '@tresjs/core'
import type { Group } from 'three'

interface CategoryDatum {
  category: string
  count: number
}

const props = defineProps<{
  data: CategoryDatum[]
}>()

const emit = defineEmits<{
  (e: 'hover', payload: { category: string; count: number } | null): void
}>()

// ── Color palette ───────────────────────────────────────────
const PALETTE = [
  '#00ffff', // cyan
  '#4466ff', // blue
  '#8844ff', // purple
  '#00ff88', // green
  '#ff44aa', // pink
  '#ffaa00', // amber
  '#ff4444', // red
  '#44ffaa', // teal
  '#ff8844', // orange
  '#aa44ff', // violet
  '#44aaff', // sky
  '#ffff44', // yellow
  '#ff44ff', // magenta
  '#88ff44', // lime
]

// ── Ring segments ───────────────────────────────────────────
const INNER_RADIUS = 2.0
const OUTER_RADIUS = 3.0
const GAP = 0.03 // gap between segments in radians

const total = computed(() =>
  props.data.reduce((sum, d) => sum + d.count, 0) || 1,
)

const segments = computed(() => {
  const sorted = [...props.data].sort((a, b) => b.count - a.count)
  let startAngle = 0
  return sorted.map((d, i) => {
    const segAngle = (d.count / total.value) * Math.PI * 2 - GAP
    const seg = {
      category: d.category,
      count: d.count,
      startAngle,
      endAngle: startAngle + Math.max(segAngle, 0.02),
      color: PALETTE[i % PALETTE.length],
      percentage: ((d.count / total.value) * 100).toFixed(1),
    }
    startAngle += segAngle + GAP
    return seg
  })
})

// ── Animation ───────────────────────────────────────────────
const ringGroupRef = ref<Group | null>(null)

const { onLoop } = useRenderLoop()

onLoop(({ elapsed }) => {
  if (!ringGroupRef.value) return
  ringGroupRef.value.rotation.z = elapsed * 0.1
})

// ── Hover ───────────────────────────────────────────────────
const hoveredIndex = ref<number | null>(null)

function onSegmentEnter(index: number, seg: typeof segments.value[0]) {
  hoveredIndex.value = index
  emit('hover', { category: seg.category, count: seg.count })
}

function onSegmentLeave() {
  hoveredIndex.value = null
  emit('hover', null)
}
</script>

<template>
  <!-- 3D ring chart rendered flat facing camera -->
  <TresGroup ref="ringGroupRef" :rotation="[-Math.PI / 2, 0, 0]">
    <TresMesh
      v-for="(seg, i) in segments"
      :key="seg.category"
      :position="[0, 0, hoveredIndex === i ? 0.1 : 0]"
      @pointer-enter="() => onSegmentEnter(i, seg)"
      @pointer-leave="onSegmentLeave"
    >
      <TresRingGeometry
        :args="[
          INNER_RADIUS,
          hoveredIndex === i ? OUTER_RADIUS + 0.15 : OUTER_RADIUS,
          32,
          1,
          seg.startAngle,
          seg.endAngle - seg.startAngle,
        ]"
      />
      <TresMeshStandardMaterial
        :color="seg.color"
        :emissive="seg.color"
        :emissive-intensity="hoveredIndex === i ? 0.8 : 0.4"
        :transparent="true"
        :opacity="hoveredIndex === i ? 0.95 : 0.7"
        :side="2"
      />
    </TresMesh>
  </TresGroup>
</template>
