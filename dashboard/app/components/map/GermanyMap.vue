<script setup lang="ts">
import { ref, computed, watchEffect } from 'vue'
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

function getRings(): number[][][] {
  const geom = germanyGeoJson.features[0].geometry
  if (geom.type === 'MultiPolygon') {
    return (geom.coordinates as number[][][][]).map(poly => poly[0])
  }
  return [(geom.coordinates as number[][][])[0]]
}

const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x111111,
  opacity: 0.6,
  transparent: true,
})

const outlineGroup = computed(() => {
  const group = new THREE.Group()
  for (const ring of getRings()) {
    const points = ring.map(([lon, lat]) => {
      const [x, z] = project(lat, lon)
      return new THREE.Vector3(x, 0, z)
    })
    const geom = new THREE.BufferGeometry().setFromPoints(points)
    const line = new THREE.LineLoop(geom, outlineMaterial)
    group.add(line)
  }
  return group
})

const fillGeometry = computed(() => {
  const shapes: THREE.Shape[] = []
  for (const ring of getRings()) {
    const shape = new THREE.Shape()
    const first = project(ring[0][1], ring[0][0])
    shape.moveTo(first[0], -first[1])
    for (let i = 1; i < ring.length; i++) {
      const [x, z] = project(ring[i][1], ring[i][0])
      shape.lineTo(x, -z)
    }
    shape.closePath()
    shapes.push(shape)
  }
  return new THREE.ShapeGeometry(shapes)
})

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

function getScreenCoords(event: any): { x: number; y: number } {
  const native = event?.nativeEvent ?? event
  return { x: native?.clientX ?? 0, y: native?.clientY ?? 0 }
}

function onBarPointerEnter(city: CityDatum, event: any) {
  hoveredCity.value = city.city
  const { x, y } = getScreenCoords(event)
  emit('hover', { city: city.city, count: city.count, screenX: x, screenY: y })
}

function onBarPointerMove(city: CityDatum, event: any) {
  if (hoveredCity.value === city.city) {
    const { x, y } = getScreenCoords(event)
    emit('hover', { city: city.city, count: city.count, screenX: x, screenY: y })
  }
}

function onBarPointerLeave() {
  hoveredCity.value = null
  emit('hover', null)
}

const outlineRef = ref<any>(null)
const fillRef = ref<any>(null)

watchEffect(() => {
  const outline = outlineRef.value
  if (outline) {
    outline.raycast = () => {}
    outline.pointerEvents = 'none'
    outline.traverse((child: any) => {
      child.raycast = () => {}
      child.pointerEvents = 'none'
    })
  }
})

watchEffect(() => {
  const fill = fillRef.value
  if (fill) {
    fill.raycast = () => {}
    fill.pointerEvents = 'none'
  }
})
</script>

<template>
  <TresGroup>
    <primitive ref="outlineRef" :object="outlineGroup" />

    <TresMesh
      ref="fillRef"
      :rotation="[-Math.PI / 2, 0, 0]"
      :position="[0, -0.005, 0]"
      :geometry="fillGeometry"
    >
      <TresMeshBasicMaterial
        color="#e8e8e8"
        :opacity="0.5"
        :transparent="true"
        :side="2"
        :depth-write="false"
      />
    </TresMesh>

    <TresGroup
      v-for="cp in cityPositions"
      :key="cp.city.city"
    >
      <TresMesh
        :position="[cp.x, cp.height / 2, cp.z]"
        :pointer-events="'auto'"
        @pointerenter="(e: any) => onBarPointerEnter(cp.city, e)"
        @pointermove="(e: any) => onBarPointerMove(cp.city, e)"
        @pointerleave="onBarPointerLeave"
      >
        <TresBoxGeometry :args="[0.2, cp.height, 0.2]" />
        <TresMeshBasicMaterial
          :color="hoveredCity === cp.city.city ? '#0055ff' : '#111111'"
          :wireframe="true"
        />
      </TresMesh>

      <TresMesh :position="[cp.x, cp.height / 2, cp.z]">
        <TresBoxGeometry :args="[0.08, cp.height, 0.08]" />
        <TresMeshBasicMaterial
          :color="hoveredCity === cp.city.city ? '#0055ff' : '#333333'"
          :opacity="hoveredCity === cp.city.city ? 0.8 : 0.4"
          :transparent="true"
        />
      </TresMesh>

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
