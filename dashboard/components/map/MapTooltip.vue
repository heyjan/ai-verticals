<script setup lang="ts">
defineProps<{
  city: string
  count: number
  x: number
  y: number
  visible: boolean
}>()
</script>

<template>
  <Transition name="tooltip">
    <div
      v-if="visible"
      class="pointer-events-none fixed z-50 bg-white border border-wire-black px-3 py-2 min-w-[120px] corner-marks"
      :style="{
        left: `${x + 12}px`,
        top: `${y - 30}px`,
      }"
    >
      <div class="font-display text-[10px] uppercase tracking-[0.2em] text-wire-mid">
        {{ city }}
      </div>
      <div class="flex items-baseline gap-2">
        <span class="font-display text-xl font-bold text-wire-black">
          {{ count }}
        </span>
        <span class="text-[9px] text-wire-mid uppercase tracking-wider">jobs</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tooltip-enter-active {
  transition: opacity 0.1s ease;
}
.tooltip-leave-active {
  transition: opacity 0.08s ease;
}
.tooltip-enter-from,
.tooltip-leave-to {
  opacity: 0;
}
</style>
