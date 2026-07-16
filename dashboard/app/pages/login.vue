<script setup lang="ts">
const { loggedIn, user, fetch: refreshSession, clear } = useUserSession()
const { register, authenticate, isSupported } = useWebAuthn()

const route = useRoute()
const email = ref('')
const busy = ref(false)
const error = ref<string | null>(
  route.query.error ? `Sign-in with ${route.query.error} failed. Please try again.` : null,
)

const providers = [
  { key: 'github', label: 'GitHub' },
  { key: 'google', label: 'Google' },
  { key: 'x', label: 'X' },
  { key: 'linkedin', label: 'LinkedIn' },
] as const

async function passkeyRegister() {
  if (!email.value) return (error.value = 'Enter an email to register a passkey.')
  error.value = null
  busy.value = true
  try {
    await register({ userName: email.value })
    await refreshSession()
    await navigateTo('/dashboard')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Passkey registration failed.'
  } finally {
    busy.value = false
  }
}

async function passkeyLogin() {
  error.value = null
  busy.value = true
  try {
    await authenticate(email.value || undefined)
    await refreshSession()
    await navigateTo('/dashboard')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Passkey login failed.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="blueprint-grid min-h-screen flex items-center justify-center p-6">
    <div class="panel w-full max-w-md p-8">
      <h1 class="font-mono text-xl font-600 text-ink mb-1">Sign in</h1>
      <p class="text-sm text-ink-faint mb-6">AI Job Command Center</p>

      <div v-if="loggedIn" class="space-y-4">
        <p class="text-sm text-ink">
          Signed in as
          <span class="font-mono font-600">{{ user?.name || user?.email || `user #${user?.id}` }}</span>
          <span class="text-ink-faint"> via {{ user?.provider }}</span>
        </p>
        <button
          class="w-full border border-ink/20 rounded px-4 py-2 font-mono text-sm hover:bg-surface-warm"
          @click="clear().then(() => refreshSession())"
        >
          Sign out
        </button>
        <NuxtLink to="/dashboard" class="block text-center text-sm text-accent hover:underline">
          → Back to dashboard
        </NuxtLink>
      </div>

      <div v-else class="space-y-6">
        <div class="grid grid-cols-2 gap-3">
          <a
            v-for="p in providers"
            :key="p.key"
            :href="`/auth/${p.key}`"
            class="border border-ink/20 rounded px-4 py-2.5 font-mono text-sm text-center hover:bg-surface-warm hover:border-accent transition-colors"
          >
            {{ p.label }}
          </a>
        </div>

        <div class="flex items-center gap-3 text-ink-ghost text-xs">
          <span class="h-px flex-1 bg-grid-line" />
          OR PASSKEY
          <span class="h-px flex-1 bg-grid-line" />
        </div>

        <div class="space-y-3">
          <input
            v-model="email"
            type="email"
            autocomplete="username webauthn"
            placeholder="you@example.com"
            class="w-full border border-ink/20 rounded px-3 py-2 font-mono text-sm bg-surface focus:outline-none focus:border-accent"
          >
          <div class="grid grid-cols-2 gap-3">
            <button
              :disabled="busy || !isSupported"
              class="border border-ink/20 rounded px-4 py-2 font-mono text-sm hover:bg-surface-warm disabled:opacity-40"
              @click="passkeyLogin"
            >
              Log in
            </button>
            <button
              :disabled="busy || !isSupported"
              class="border border-accent bg-accent/10 rounded px-4 py-2 font-mono text-sm text-accent hover:bg-accent/20 disabled:opacity-40"
              @click="passkeyRegister"
            >
              Register
            </button>
          </div>
          <p v-if="!isSupported" class="text-xs text-ink-ghost">
            This browser does not support passkeys.
          </p>
        </div>

        <p v-if="error" class="text-sm text-accent">{{ error }}</p>
      </div>
    </div>
  </div>
</template>
