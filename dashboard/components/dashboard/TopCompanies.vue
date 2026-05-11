<script setup lang="ts">
import { computed } from 'vue'

interface CompanyDatum {
  company: string
  count: number
  categories?: string[]
}

const props = defineProps<{
  data: CompanyDatum[]
}>()

const sorted = computed(() =>
  [...props.data].sort((a, b) => b.count - a.count),
)

const categoryColors: Record<string, string> = {
  'Data Science/ML': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'Engineering/Development': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Research': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'Consulting': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Data Engineering': 'bg-teal-500/20 text-teal-300 border-teal-500/30',
  'Product/Design': 'bg-pink-500/20 text-pink-300 border-pink-500/30',
  'Sales/Marketing': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Management': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Robotics/Hardware': 'bg-red-500/20 text-red-300 border-red-500/30',
  'Training/Annotation': 'bg-lime-500/20 text-lime-300 border-lime-500/30',
  'HR/People': 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'Finance/Legal': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  'Operations/Logistics': 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  'Other': 'bg-gray-500/20 text-gray-300 border-gray-500/30',
}

function getCategoryClass(cat: string): string {
  return categoryColors[cat] || categoryColors['Other']
}
</script>

<template>
  <div class="panel p-5 flex flex-col">
    <div class="panel-header flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full bg-cyber-cyan animate-pulse" />
      Top Companies
    </div>

    <div class="mt-3 space-y-1 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar">
      <div
        v-for="(item, index) in sorted"
        :key="item.company"
        class="flex items-center justify-between py-2 px-3 rounded-md hover:bg-white/[0.03] transition-colors group"
      >
        <div class="flex items-center gap-3 min-w-0">
          <span class="font-display text-xs text-cyber-cyan/40 w-5 text-right tabular-nums shrink-0">
            {{ index + 1 }}
          </span>
          <div class="min-w-0">
            <div class="text-sm text-gray-200 group-hover:text-white transition-colors truncate">
              {{ item.company }}
            </div>
            <div v-if="item.categories?.length" class="flex flex-wrap gap-1 mt-1">
              <span
                v-for="cat in item.categories.slice(0, 3)"
                :key="cat"
                class="inline-block text-[10px] px-1.5 py-0.5 rounded border"
                :class="getCategoryClass(cat)"
              >
                {{ cat }}
              </span>
            </div>
          </div>
        </div>

        <span class="font-display text-sm text-cyber-cyan tabular-nums shrink-0 ml-3">
          {{ item.count }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 255, 255, 0.15);
  border-radius: 2px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 255, 255, 0.3);
}
</style>
