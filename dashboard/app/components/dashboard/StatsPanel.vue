<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'

interface Stats {
  totalJobs: number
  totalCompanies: number
  totalCities: number
  topCategory?: string
  [key: string]: any
}

const props = defineProps<{
  stats: Stats
}>()

const displayJobs = ref(0)
const displayCompanies = ref(0)
const displayCities = ref(0)

function animateValue(
  target: number,
  setter: (v: number) => void,
  duration = 1200,
) {
  const start = performance.now()
  const step = (now: number) => {
    const elapsed = now - start
    const progress = Math.min(elapsed / duration, 1)
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3)
    setter(Math.round(target * eased))
    if (progress < 1) {
      requestAnimationFrame(step)
    }
  }
  requestAnimationFrame(step)
}

onMounted(() => {
  animateValue(props.stats.totalJobs, (v) => (displayJobs.value = v))
  animateValue(props.stats.totalCompanies, (v) => (displayCompanies.value = v), 1000)
  animateValue(props.stats.totalCities, (v) => (displayCities.value = v), 800)
})

watch(
  () => props.stats,
  (newStats) => {
    animateValue(newStats.totalJobs, (v) => (displayJobs.value = v))
    animateValue(newStats.totalCompanies, (v) => (displayCompanies.value = v), 1000)
    animateValue(newStats.totalCities, (v) => (displayCities.value = v), 800)
  },
)

const statItems = [
  { key: 'jobs', label: 'Total Jobs', icon: '///' },
  { key: 'companies', label: 'Companies', icon: '::' },
  { key: 'cities', label: 'Cities', icon: '<>' },
]
</script>

<template>
  <div class="panel p-5">
    <div class="panel-header flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
      System Overview
    </div>

    <div class="grid grid-cols-3 gap-4 mt-4">
      <!-- Total Jobs -->
      <div class="text-center">
        <div class="stat-value glow-text">
          {{ displayJobs.toLocaleString() }}
        </div>
        <div class="stat-label">Total Jobs</div>
      </div>

      <!-- Companies -->
      <div class="text-center">
        <div class="stat-value glow-text">
          {{ displayCompanies.toLocaleString() }}
        </div>
        <div class="stat-label">Companies</div>
      </div>

      <!-- Cities -->
      <div class="text-center">
        <div class="stat-value glow-text">
          {{ displayCities.toLocaleString() }}
        </div>
        <div class="stat-label">Cities</div>
      </div>
    </div>

    <!-- Top category indicator -->
    <div
      v-if="stats.topCategory"
      class="mt-4 pt-3 border-t border-cyan-500/10 flex items-center justify-between"
    >
      <span class="text-xs text-gray-500 uppercase tracking-wider">Top Category</span>
      <span class="font-display text-sm text-cyber-cyan">{{ stats.topCategory }}</span>
    </div>
  </div>
</template>
