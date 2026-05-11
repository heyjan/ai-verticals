<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRenderLoop } from '@tresjs/core'
import * as THREE from 'three'
import germanyGeoJson from '~/assets/geo/germany.json'

interface CityDatum {
  city: string
  count: number
  lat: number
  lon: number
}

const props = defineProps<{
  cityData: CityDatum[]
}>()

const emit = defineEmits<{
  (e: 'hover', payload: { city: string; count: number; screenX: number; screenY: number } | null): void
}>()

function project(lat: number, lon: number): [number, number] {
  const x = ((lon - 10.45) / 9.17) * 10
  const z = ((lat - 51.16) / 7.79) * -10
  return [x, z]
}

// Germany outline
const outlineGeometry = computed(() => {
  const coords = germanyGeoJson.features[0].geometry.coordinates[0]
  const points = coords.map(([lon, lat]: number[]) => {
    const [x, z] = project(lat, lon)
    return new THREE.Vector3(x, 0, z)
  })
  return new THREE.BufferGeometry().setFromPoints(points)
})

const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x111111,
  opacity: 0.6,
  transparent: true,
})

const outlineLine = computed(() => new THREE.Line(outlineGeometry.value, outlineMaterial))

// Country fill
const countryShape = computed(() => {
  const shape = new THREE.Shape()
  const coords = germanyGeoJson.features[0].geometry.coordinates[0]
  const first = project(coords[0][1], coords[0][0])
  shape.moveTo(first[0], -first[1])
  for (let i = 1; i < coords.length; i++) {
    const [x, z] = project(coords[i][1], coords[i][0])
    shape.lineTo(x, -z)
  }
  shape.closePath()
  return shape
})

const shapeGeometry = computed(() => new THREE.ShapeGeometry(countryShape.value))

// City bars
const maxCount = computed(() => {
  if (props.cityData.length === 0) return 1
  return Math.max(...props.cityData.map(d => d.count))
})

function barHeight(count: number): number {
  return (count / maxCount.value) * 5 + 0.1
}

const cityPositions = computed(() =>
  props.cityData.map(city => {
    const [x, z] = project(city.lat, city.lon)
    const h = barHeight(city.count)
    return { city, x, z, height: h }
  }),
)

const hoveredCity = ref<string | null>(null)

function onBarPointerEnter(city: CityDatum, event: any) {
  hoveredCity.value = city.city
  emit('hover', { city: city.city, count: city.count, screenX: event?.clientX ?? 0, screenY: event?.clientY ?? 0 })
}

function onBarPointerMove(city: CityDatum, event: any) {
  if (hoveredCity.value === city.city) {
    emit('hover', { city: city.city, count: city.count, screenX: event?.clientX ?? 0, screenY: event?.clientY ?? 0 })
  }
}

function onBarPointerLeave() {
  hoveredCity.value = null
  emit('hover', null)
}
</script>

<template>
  <TresGroup>
    <!-- Germany outline wireframe -->
    <primitive :object="outlineLine" />

    <!-- Country surface — very light fill -->
    <TresMesh
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, -0.005, 0]"
      :geometry="shapeGeometry"
    >
      <TresMeshBasicMaterial
        color="#e8e8e8"
        :opacity="0.5"
        :transparent="true"
        :side="2"
        :depth-write="false"
      />
    </TresMesh>

    <!-- City bars — wireframe style -->
    <TresGroup
      v-for="cp in cityPositions"
      :key="cp.city.city"
    >
      <!-- Wireframe bar -->
      <TresMesh
        :position="[cp.x, cp.height / 2, cp.z]"
        @pointer-enter="(e: any) => onBarPointerEnter(cp.city, e)"
        @pointer-move="(e: any) => onBarPointerMove(cp.city, e)"
        @pointer-leave="onBarPointerLeave"
      >
        <TresBoxGeometry :args="[0.12, cp.height, 0.12]" />
        <TresMeshBasicMaterial
          :color="hoveredCity === cp.city.city ? '#0055ff' : '#111111'"
          :wireframe="true"
        />
      </TresMesh>

      <!-- Solid inner bar -->
      <TresMesh :position="[cp.x, cp.height / 2, cp.z]">
        <TresBoxGeometry :args="[0.08, cp.height, 0.08]" />
        <TresMeshBasicMaterial
          :color="hoveredCity === cp.city.city ? '#0055ff' : '#333333'"
          :opacity="hoveredCity === cp.city.city ? 0.8 : 0.4"
          :transparent="true"
        />
      </TresMesh>

      <!-- Base dot -->
      <TresMesh
        :position="[cp.x, 0.01, cp.z]"
        :rotation="[-Math.PI / 2, 0, 0]"
      >
        <TresCircleGeometry :args="[0.15, 6]" />
        <TresMeshBasicMaterial
          color="#111111"
          :opacity="0.15"
          :transparent="true"
          :depth-write="false"
        />
      </TresMesh>
    </TresGroup>
  </TresGroup>
</template>
