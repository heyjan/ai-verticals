import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-11',
  modules: [
    '@tresjs/nuxt',
  ],
  components: [
    { path: '~/components', pathPrefix: false },
  ],
  tres: {
    glsl: true,
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['three', '@tresjs/core', '@tresjs/cientos'],
    },
  },
  app: {
    head: {
      title: 'AI Job Command Center',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap' },
      ],
    },
  },
  nitro: {
    experimental: {
      asyncContext: true,
    },
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
  },
})
