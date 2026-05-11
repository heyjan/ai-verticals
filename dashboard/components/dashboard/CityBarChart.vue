<script setup lang="ts">
import { computed } from 'vue'

interface CityCount {
  city: string
  count: number
}

const props = defineProps<{
  data: CityCount[]
}>()

const top10 = computed(() =>
  [...props.data]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10),
)

const maxCount = computed(() =>
  top10.value.length > 0 ? top10.value[0].count : 1,
)
</script>

<template>
  <div class="panel p-5">
    <div class="panel-header flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
      Top Cities
    </div>

    <div class="space-y-2.5 mt-3">
      <div
        v-for="(item, index) in top10"
        :key="item.city"
        class="group"
      >
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm text-gray-300 group-hover:text-cyber-cyan transition-colors truncate mr-2">
            {{ item.city }}
          </span>
          <span class="font-display text-sm text-cyber-cyan tabular-nums shrink-0">
            {{ item.count }}
          </span>
        </div>
        <div class="relative h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            class="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
            :style="{
              width: `${(item.count / maxCount) * 100}%`,
              background: `linear-gradient(90deg, #00ffff ${60 - index * 5}%, #4466ff)`,
              transitionDelay: `${index * 60}ms`,
            }"
          />
          <!-- Glow effect on hover -->
          <div
            class="absolute inset-y-0 left-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity blur-sm"
            :style="{
              width: `${(item.count / maxCount) * 100}%`,
              background: `linear-gradient(90deg, #00ffff, #4466ff)`,
            }"
          />
        </div>
      </div>
    </div>
  </div>
</template>
