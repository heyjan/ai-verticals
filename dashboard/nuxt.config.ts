export default defineNuxtConfig({
  compatibilityDate: '2025-05-11',
  modules: [
    '@nuxtjs/tailwindcss',
    '@tresjs/nuxt',
  ],
  components: [
    { path: '~/components', pathPrefix: false },
  ],
  tres: {
    glsl: true,
  },
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
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
    externals: {
      external: ['sql.js'],
    },
  },
  runtimeConfig: {
    dataFilePath: process.env.DATA_FILE_PATH || '../data/merged_jobs_20260511_083938.json',
    databasePath: process.env.DATABASE_PATH || '.data/jobs.db',
  },
})
