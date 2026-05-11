<script setup lang="ts">
const props = defineProps<{
  category: string
}>()

const iconMap: Record<string, string> = {
  engineering: 'engineering',
  'data-science': 'data-science',
  'data science': 'data-science',
  'data-engineering': 'data-engineering',
  'data engineering': 'data-engineering',
  product: 'product',
  consulting: 'consulting',
  research: 'research',
  sales: 'sales',
  hr: 'hr',
  'human resources': 'hr',
  management: 'management',
  operations: 'operations',
  finance: 'finance',
  training: 'training',
  robotics: 'robotics',
  other: 'other',
}

const iconName = computed(() => {
  const key = props.category?.toLowerCase().trim() ?? ''
  return iconMap[key] ?? 'other'
})

const icons = import.meta.glob('@/assets/icons/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

const svgContent = computed(() => {
  const match = Object.entries(icons).find(([key]) => key.endsWith(`/${iconName.value}.svg`))
  return match ? match[1] : ''
})
</script>

<template>
  <span class="category-icon" v-html="svgContent" />
</template>

<style scoped>
.category-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.category-icon :deep(svg) {
  width: 100%;
  height: 100%;
}
</style>
