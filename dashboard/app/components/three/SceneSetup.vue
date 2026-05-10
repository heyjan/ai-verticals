<script setup lang="ts">
import { OrbitControls } from '@tresjs/cientos'
</script>

<template>
  <TresCanvas
    clear-color="#00000000"
    :antialias="true"
    :alpha="true"
  >
    <TresPerspectiveCamera :position="[0, 10, 14]" :look-at="[0, 0, 0]" />

    <TresAmbientLight :intensity="0.6" />
    <TresDirectionalLight :position="[8, 12, 8]" :intensity="0.4" />

    <OrbitControls
      :enable-damping="true"
      :damping-factor="0.08"
      :min-distance="6"
      :max-distance="30"
      :enable-pan="false"
      :max-polar-angle="Math.PI / 2.2"
    />

    <slot />
  </TresCanvas>
</template>
