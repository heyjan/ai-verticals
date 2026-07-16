<script setup lang="ts">
const { loggedIn } = useUserSession()

const steps = [
  {
    step: '01',
    title: 'Design a template',
    text: 'Clone a built-in layout in the Template Editor and place slots (⬚) where text should go — an intro slot, a bullet slot per job, and so on. Everything outside the slots stays fixed.',
  },
  {
    step: '02',
    title: 'Write text blocks',
    text: 'In the CV Editor, build a library of reusable text blocks — intros, achievements, bullets — and tag each one with the roles it fits, e.g. Manager or Product Owner.',
  },
  {
    step: '03',
    title: 'Compose per application',
    text: 'Set the target role, and matching blocks rank first. Drag them into the template slots, reorder until it reads right.',
  },
  {
    step: '04',
    title: 'Export',
    text: 'Download the finished CV as PDF or DOCX. Editing a text block later updates every CV that uses it.',
  },
]
</script>

<template>
  <main class="min-h-screen bg-surface text-ink">
    <div class="border-b border-grid-line px-5 py-4 lg:px-8">
      <div>
        <NuxtLink to="/dashboard" class="font-mono text-[10px] font-600 uppercase tracking-[0.18em] text-ink-faint">
          AI Job Command Center
        </NuxtLink>
        <h1 class="mt-1 font-mono text-[22px] font-700 uppercase tracking-0 text-ink">CV Studio</h1>
      </div>
    </div>

    <div class="w-full px-5 py-8 lg:px-8">
      <p class="max-w-2xl text-[15px] leading-relaxed text-ink-light">
        Build CVs from reusable, tagged text blocks instead of rewriting the same document
        for every application. Templates define the layout once — text blocks fill it per role.
      </p>

      <div v-if="!loggedIn" class="mt-5 max-w-2xl border border-grid-line bg-surface-warm px-4 py-3">
        <p class="text-[13px] text-ink-light">
          <NuxtLink class="underline hover:text-ink" to="/login">Login</NuxtLink>
          is required to create templates, text blocks, and CVs.
        </p>
      </div>

      <div class="mt-8 grid gap-5 lg:grid-cols-2">
        <NuxtLink to="/template-editor" class="panel reg-marks group block p-6 transition-colors hover:border-ink">
          <div class="panel-header">Design</div>
          <h2 class="font-mono text-[18px] font-700 uppercase tracking-[0.06em] text-ink">Template Editor</h2>
          <p class="mt-3 text-[14px] leading-relaxed text-ink-light">
            Define the fixed structure of a CV: layout, fonts, page margins, headings, and tables.
            Mark the interchangeable spots as <span class="font-mono text-accent">⬚ slots</span> —
            text slots for intros, bullet slots for experience points.
          </p>
          <ul class="mt-4 space-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
            <li>· Clone built-in layouts, keep them read-only</li>
            <li>· Rich text, tables, images, fonts, margins</li>
            <li>· + Slot / + Bullet Slot placeholders</li>
          </ul>
          <span class="mt-5 inline-block border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] group-hover:bg-ink group-hover:text-surface">
            Open Template Editor
          </span>
        </NuxtLink>

        <NuxtLink to="/cv-editor" class="panel reg-marks group block p-6 transition-colors hover:border-ink">
          <div class="panel-header">Compose</div>
          <h2 class="font-mono text-[18px] font-700 uppercase tracking-[0.06em] text-ink">CV Editor</h2>
          <p class="mt-3 text-[14px] leading-relaxed text-ink-light">
            Compose an actual CV: pick a template, then drag tagged text blocks from your library
            into its slots. Set a target role like <span class="font-mono">Manager</span> and
            matching blocks are ranked first. Export as PDF or DOCX.
          </p>
          <ul class="mt-4 space-y-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
            <li>· Reusable text blocks with tags</li>
            <li>· Drag & drop into template slots</li>
            <li>· Role-based ranking · PDF / DOCX export</li>
          </ul>
          <span class="mt-5 inline-block border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] group-hover:bg-ink group-hover:text-surface">
            Open CV Editor
          </span>
        </NuxtLink>
      </div>

      <div class="mt-10">
        <div class="panel-header">How it works</div>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div v-for="entry in steps" :key="entry.step" class="border border-grid-line p-4">
            <div class="font-mono text-[10px] font-600 uppercase tracking-[0.18em] text-accent">{{ entry.step }}</div>
            <h3 class="mt-2 font-mono text-[13px] font-700 uppercase tracking-[0.08em] text-ink">{{ entry.title }}</h3>
            <p class="mt-2 text-[13px] leading-relaxed text-ink-light">{{ entry.text }}</p>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
