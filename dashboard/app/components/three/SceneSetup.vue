<script setup lang="ts">
import { computed } from 'vue'
import { OrbitControls } from '@tresjs/cientos'

const props = withDefaults(
  defineProps<{
    mode?: 'map' | 'graph'
  }>(),
  { mode: 'map' },
)

const cameraPosition = computed<[number, number, number]>(() =>
  props.mode === 'graph' ? [0, 4, 16] : [0, 10, 14],
)

const controls = computed(() =>
  props.mode === 'graph'
    ? {
        enablePan: true,
        minDistance: 2,
        maxDistance: 60,
        maxPolarAngle: Math.PI,
        minPolarAngle: 0,
      }
    : {
        enablePan: false,
        minDistance: 6,
        maxDistance: 30,
        maxPolarAngle: Math.PI / 2.2,
        minPolarAngle: 0,
      },
)
</script>

<template>
  <TresCanvas
    clear-color="#00000000"
    :antialias="true"
    :alpha="true"
  >
    <TresPerspectiveCamera :position="cameraPosition" :look-at="[0, 0, 0]" />

    <TresAmbientLight :intensity="0.6" />
    <TresDirectionalLight :position="[8, 12, 8]" :intensity="0.4" />

    <OrbitControls
      make-default
      :enable-damping="true"
      :damping-factor="0.08"
      :enable-pan="controls.enablePan"
      :min-distance="controls.minDistance"
      :max-distance="controls.maxDistance"
      :max-polar-angle="controls.maxPolarAngle"
      :min-polar-angle="controls.minPolarAngle"
    />

    <slot />
  </TresCanvas>
</template>
