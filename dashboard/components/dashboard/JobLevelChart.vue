<script setup lang="ts">
import { computed } from 'vue'

interface LevelDatum {
  level: string
  count: number
}

const props = defineProps<{
  data: LevelDatum[]
}>()

const sorted = computed(() =>
  [...props.data].sort((a, b) => b.count - a.count),
)

const maxCount = computed(() =>
  sorted.value.length > 0 ? sorted.value[0].count : 1,
)

const levelColors: Record<string, string> = {
  'Entry': '#00ff88',
  'Junior': '#00ffff',
  'Mid': '#4466ff',
  'Senior': '#8844ff',
  'Lead': '#ff44aa',
  'Manager': '#ff8844',
  'Director': '#ffaa00',
  'VP': '#ff4444',
  'C-Level': '#ff0088',
}

function getLevelColor(level: string): string {
  // Try exact match first, then partial match
  if (levelColors[level]) return levelColors[level]
  for (const [key, color] of Object.entries(levelColors)) {
    if (level.toLowerCase().includes(key.toLowerCase())) return color
  }
  return '#00ffff'
}
</script>

<template>
  <div class="panel p-5">
    <div class="panel-header flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
      Job Level Distribution
    </div>

    <div class="space-y-3 mt-3">
      <div
        v-for="(item, index) in sorted"
        :key="item.level"
        class="group"
      >
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span
              class="inline-block w-2 h-2 rounded-full shrink-0"
              :style="{ backgroundColor: getLevelColor(item.level) }"
            />
            <span class="text-sm text-gray-300 group-hover:text-white transition-colors">
              {{ item.level || 'Unspecified' }}
            </span>
          </div>
          <span class="font-display text-sm text-cyber-cyan tabular-nums">
            {{ item.count }}
          </span>
        </div>
        <div class="relative h-2 rounded-full bg-white/5 overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
            :style="{
              width: `${(item.count / maxCount) * 100}%`,
              backgroundColor: getLevelColor(item.level),
              opacity: 0.75,
              transitionDelay: `${index * 80}ms`,
            }"
          />
        </div>
      </div>

      <div v-if="sorted.length === 0" class="text-sm text-gray-500 text-center py-4">
        No level data available
      </div>
    </div>
  </div>
</template>
