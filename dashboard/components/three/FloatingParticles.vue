<script setup lang="ts">
import { ref } from 'vue'
import { useRenderLoop } from '@tresjs/core'
import * as THREE from 'three'

const PARTICLE_COUNT = 100
const SPREAD_X = 20
const SPREAD_Y = 10
const SPREAD_Z = 20

const positionsArray = new Float32Array(PARTICLE_COUNT * 3)
for (let i = 0; i < PARTICLE_COUNT; i++) {
  positionsArray[i * 3] = (Math.random() - 0.5) * SPREAD_X * 2
  positionsArray[i * 3 + 1] = Math.random() * SPREAD_Y
  positionsArray[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_Z * 2
}

const geometry = new THREE.BufferGeometry()
geometry.setAttribute('position', new THREE.BufferAttribute(positionsArray, 3))

const pointsRef = ref<THREE.Points | null>(null)

const { onLoop } = useRenderLoop()

onLoop(({ delta }) => {
  if (!pointsRef.value) return
  const positions = pointsRef.value.geometry.attributes.position
  const arr = positions.array as Float32Array
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    arr[i * 3 + 1] += 0.08 * delta
    if (arr[i * 3 + 1] > SPREAD_Y) {
      arr[i * 3 + 1] = 0
      arr[i * 3] = (Math.random() - 0.5) * SPREAD_X * 2
      arr[i * 3 + 2] = (Math.random() - 0.5) * SPREAD_Z * 2
    }
  }
  positions.needsUpdate = true
})
</script>

<template>
  <TresPoints ref="pointsRef" :geometry="geometry">
    <TresPointsMaterial
      color="#999999"
      :size="0.04"
      :transparent="true"
      :opacity="0.3"
      :depth-write="false"
      :size-attenuation="true"
    />
  </TresPoints>
</template>
