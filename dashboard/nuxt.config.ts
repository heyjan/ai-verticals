import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-11',
  modules: [
    '@tresjs/nuxt',
    'nuxt-auth-utils',
  ],
  // Enable WebAuthn (passkey) server handlers + `useWebAuthn()` composable.
  auth: {
    webAuthn: true,
  },
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
    // Encrypts the sealed session cookie. Override with NUXT_SESSION_PASSWORD
    // (>= 32 chars) in every non-dev environment; auth-utils auto-generates an
    // ephemeral one in dev if unset.
    session: {
      // Empty by design: bound at runtime from NUXT_SESSION_PASSWORD (and
      // auto-generated in dev when unset). Never commit a real value here.
      password: '',
      maxAge: 60 * 60 * 24 * 7, // 1 week
    },
    // OAuth client credentials. Values are intentionally empty here and bound
    // at runtime from NUXT_OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET
    // (and optional _REDIRECT_URL). Keeping the keys declared makes the env
    // override work in the built Nitro server.
    oauth: {
      github: { clientId: '', clientSecret: '' },
      google: { clientId: '', clientSecret: '' },
      x: { clientId: '', clientSecret: '' },
      linkedin: { clientId: '', clientSecret: '' },
    },
  },
})
