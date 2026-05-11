<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type * as THREE from 'three'

const gridRef = ref<THREE.GridHelper | null>(null)

onMounted(() => {
  if (gridRef.value) {
    const mat = gridRef.value.material as THREE.Material
    mat.transparent = true
    mat.opacity = 0.15
    mat.depthWrite = false
  }
})
</script>

<template>
  <TresGridHelper
    ref="gridRef"
    :args="[40, 40, '#cccccc', '#e0e0e0']"
    :position="[0, -0.01, 0]"
  />
</template>
