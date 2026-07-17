import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2025-05-11',
  modules: [
    '@tresjs/nuxt',
    'nuxt-auth-utils',
    '@nuxtjs/google-fonts',
  ],
  googleFonts: {
    families: {
      'IBM Plex Sans': [300, 400, 500, 600, 700],
      'IBM Plex Mono': [400, 500, 600, 700],
      'Inter Tight': [400, 500, 600, 700],
      Montserrat: [300, 400, 500, 600, 700],
      'Noto Sans': [300, 400, 500, 600, 700],
      Lato: [300, 400, 700],
    },
    display: 'swap',
    download: false,
    useStylesheet: true,
  },
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
  css: [
    '@fontsource/lato/latin-400.css',
    '@fontsource/lato/latin-700.css',
    '@fontsource/montserrat/latin-400.css',
    '@fontsource/montserrat/latin-700.css',
    '@fontsource/noto-sans/latin-400.css',
    '@fontsource/noto-sans/latin-700.css',
    '~/assets/css/main.css',
  ],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        'three',
        '@tresjs/core',
        '@tresjs/cientos',
        '@tiptap/starter-kit',
        '@tiptap/vue-3',
        '@tiptap/extension-image',
        '@tiptap/extension-link',
        '@tiptap/extension-table',
        '@tiptap/extension-table-row',
        '@tiptap/extension-table-cell',
        '@tiptap/extension-table-header',
        '@tiptap/extension-text-align',
        '@tiptap/extension-text-style',
      ],
    },
  },
  app: {
    head: {
      title: 'AI Job Command Center',
    },
  },
  nitro: {
    experimental: {
      asyncContext: true,
    },
  },
  routeRules: {
    // The page formerly known as the CV Builder; keep old links working.
    '/cv-builder': { redirect: { to: '/template-editor', statusCode: 301 } },
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    analyticsUrl: process.env.NUXT_ANALYTICS_URL || 'http://localhost:8000',
    cvBuilder: {
      // Override with NUXT_CV_BUILDER_ADMIN_ONLY=false to let every logged-in
      // user access the feature while it is still behind this rollout switch.
      adminOnly: process.env.NUXT_CV_BUILDER_ADMIN_ONLY !== 'false',
      // Private server-side storage; never serve this directory statically.
      storageRoot: process.env.NUXT_CV_BUILDER_STORAGE_ROOT || '.data/cv-builder',
    },
    // SMTP for transactional mail (waitlist notifications). All values are
    // bound at runtime from NUXT_SMTP_* / NUXT_WAITLIST_NOTIFY_TO. When host
    // is unset the waitlist endpoint simply skips sending and still records
    // the signup, so local dev needs no mail server.
    smtp: {
      host: process.env.NUXT_SMTP_HOST || '',
      port: process.env.NUXT_SMTP_PORT || '587',
      secure: process.env.NUXT_SMTP_SECURE === 'true',
      user: process.env.NUXT_SMTP_USER || '',
      pass: process.env.NUXT_SMTP_PASS || '',
      from: process.env.NUXT_SMTP_FROM || 'ai-verticals <noreply@ai-verticals.de>',
    },
    // Where waitlist signup notifications are sent. Defaults to the Impressum
    // contact address.
    waitlistNotifyTo: process.env.NUXT_WAITLIST_NOTIFY_TO || 'jan@heyjan.de',
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
