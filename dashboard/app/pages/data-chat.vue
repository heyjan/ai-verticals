<script setup lang="ts">
import {
  ArrowLeft,
  ChevronDown,
  Database,
  RotateCcw,
  Send,
  Square,
} from '@lucide/vue'
import { useChat } from '@ai-sdk/vue'
import DOMPurify from 'dompurify'
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  type UIMessagePart,
} from 'ai'
import { marked } from 'marked'

definePageMeta({ ssr: false })

const examples = [
  'Which companies mention LangChain in Berlin?',
  'How did agent-engineering postings trend since January?',
  'Which tools are growing fastest in active AI engineering roles?',
]

const { loggedIn } = useUserSession()
const input = ref('')
const transcript = ref<HTMLElement | null>(null)

marked.setOptions({ gfm: true, breaks: true })

const {
  messages,
  sendMessage,
  status,
  error,
  stop,
  clearError,
} = useChat({
  transport: new DefaultChatTransport({
    api: '/api/chat',
  }),
})

const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')

watch(
  () => [messages.value.length, status.value],
  async () => {
    await nextTick()
    transcript.value?.scrollTo({
      top: transcript.value.scrollHeight,
      behavior: status.value === 'streaming' ? 'auto' : 'smooth',
    })
  },
)

async function submit(prompt = input.value) {
  const text = prompt.trim()
  if (!text || isBusy.value || !loggedIn.value) return
  input.value = ''
  clearError()
  await sendMessage({ text })
}

function resetConversation() {
  if (isBusy.value) stop()
  messages.value = []
  input.value = ''
  clearError()
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  void submit()
}

function renderMarkdown(text: string) {
  return DOMPurify.sanitize(String(marked.parse(text)), {
    USE_PROFILES: { html: true },
  })
}

function isSqlPart(part: UIMessagePart) {
  return isToolUIPart(part) && getToolName(part) === 'sql'
}

function sqlQuery(part: UIMessagePart) {
  if (!isSqlPart(part)) return ''
  const inputValue = (part as any).input
  return typeof inputValue?.query === 'string' ? inputValue.query : ''
}

function sqlRowCount(part: UIMessagePart) {
  if (!isSqlPart(part)) return null
  const output = (part as any).output
  return typeof output?.rowCount === 'number' ? output.rowCount : null
}

function sqlState(part: UIMessagePart) {
  if (!isSqlPart(part)) return ''
  const state = (part as any).state
  if (state === 'output-error') return 'error'
  if (state === 'output-available') return 'complete'
  return 'running'
}
</script>

<template>
  <main class="data-chat-page min-h-screen bg-surface text-ink">
    <header class="data-chat-header">
      <div class="flex min-w-0 items-center gap-4">
        <NuxtLink
          to="/dashboard"
          class="icon-button"
          aria-label="Back to dashboard"
          title="Back to dashboard"
        >
          <ArrowLeft :size="17" />
        </NuxtLink>
        <div class="min-w-0">
          <div class="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-faint">AI Job Command Center</div>
          <h1 class="truncate font-mono text-[19px] font-700 uppercase tracking-0">Data Chat</h1>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="chat-status">
          <span class="chat-status-dot" :class="{ 'chat-status-dot--busy': isBusy }" />
          {{ isBusy ? status : 'ready' }}
        </span>
        <button
          type="button"
          class="icon-button"
          aria-label="Clear conversation"
          title="Clear conversation"
          :disabled="messages.length === 0"
          @click="resetConversation"
        >
          <RotateCcw :size="16" />
        </button>
      </div>
    </header>

    <section v-if="!loggedIn" class="mx-auto w-full max-w-3xl px-5 py-10">
      <div class="panel reg-marks p-6">
        <div class="panel-header">Access</div>
        <p class="text-[15px] text-ink-light">Login is required to query the jobs dataset.</p>
        <NuxtLink
          to="/login"
          class="mt-5 inline-block border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-ink hover:text-surface"
        >
          Login
        </NuxtLink>
      </div>
    </section>

    <div v-else class="data-chat-workspace">
      <section ref="transcript" class="chat-transcript" aria-live="polite">
        <div v-if="messages.length === 0" class="chat-empty">
          <div class="chat-empty-icon">
            <Database :size="22" />
          </div>
          <h2>Ask the jobs dataset</h2>
          <div class="example-grid">
            <button
              v-for="example in examples"
              :key="example"
              type="button"
              class="example-prompt"
              @click="submit(example)"
            >
              {{ example }}
            </button>
          </div>
        </div>

        <article
          v-for="message in messages"
          :key="message.id"
          class="chat-message"
          :class="`chat-message--${message.role}`"
        >
          <div class="chat-message-role">{{ message.role === 'user' ? 'You' : 'Analyst' }}</div>
          <div class="chat-message-content">
            <template v-for="(part, index) in message.parts" :key="`${message.id}-${index}`">
              <div
                v-if="part.type === 'text'"
                class="chat-markdown"
                v-html="renderMarkdown(part.text)"
              />

              <details v-else-if="isSqlPart(part)" class="sql-block">
                <summary>
                  <span class="sql-block-icon"><Database :size="14" /></span>
                  <span>ran SQL</span>
                  <span class="sql-block-meta">
                    {{ sqlRowCount(part) === null ? sqlState(part) : `${sqlRowCount(part)} rows` }}
                  </span>
                  <ChevronDown :size="14" class="sql-block-chevron" />
                </summary>
                <pre><code>{{ sqlQuery(part) || 'Preparing query...' }}</code></pre>
              </details>

              <details v-else-if="part.type === 'reasoning'" class="reasoning-block">
                <summary>Analysis</summary>
                <div>{{ part.text }}</div>
              </details>
            </template>
          </div>
        </article>

        <div v-if="status === 'submitted'" class="stream-indicator">
          <span />
          <span />
          <span />
        </div>
      </section>

      <footer class="chat-composer-shell">
        <div v-if="error" class="chat-error" role="alert">
          {{ error.message || 'The analytics request failed.' }}
        </div>
        <div class="chat-composer">
          <textarea
            v-model="input"
            rows="2"
            maxlength="4000"
            placeholder="Ask about companies, tools, locations, or trends"
            aria-label="Data chat prompt"
            :disabled="isBusy"
            @keydown="handleInputKeydown"
          />
          <button
            v-if="isBusy"
            type="button"
            class="composer-action"
            aria-label="Stop response"
            title="Stop response"
            @click="stop"
          >
            <Square :size="16" fill="currentColor" />
          </button>
          <button
            v-else
            type="button"
            class="composer-action"
            aria-label="Send prompt"
            title="Send prompt"
            :disabled="!input.trim()"
            @click="submit()"
          >
            <Send :size="17" />
          </button>
        </div>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.data-chat-page {
  display: grid;
  grid-template-rows: 65px minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}

.data-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--color-grid-line);
  padding: 10px 20px;
  background: var(--color-surface);
}

.icon-button,
.composer-action {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-grid-line);
  color: var(--color-ink);
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}

.icon-button:hover:not(:disabled),
.composer-action:hover:not(:disabled) {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-surface);
}

.icon-button:disabled,
.composer-action:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.chat-status {
  display: inline-flex;
  min-width: 92px;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--color-grid-line);
  padding: 9px 11px;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  color: var(--color-ink-faint);
}

.chat-status-dot {
  width: 6px;
  height: 6px;
  background: #10b981;
}

.chat-status-dot--busy {
  background: var(--color-accent);
  animation: chat-pulse 1s steps(2, end) infinite;
}

.data-chat-workspace {
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  background-image:
    linear-gradient(var(--color-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-grid-line) 1px, transparent 1px);
  background-size: 24px 24px;
  background-position: -1px -1px;
}

.chat-transcript {
  min-height: 0;
  overflow-y: auto;
  padding: 28px max(20px, calc((100vw - 880px) / 2)) 48px;
  scrollbar-gutter: stable;
}

.chat-empty {
  display: grid;
  min-height: 100%;
  align-content: center;
  justify-items: center;
  gap: 18px;
  padding: 24px 0;
}

.chat-empty-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border: 1px solid var(--color-ink);
  background: var(--color-surface);
  color: var(--color-accent);
}

.chat-empty h2 {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  text-transform: uppercase;
}

.example-grid {
  display: grid;
  width: min(100%, 760px);
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.example-prompt {
  min-height: 82px;
  border: 1px solid var(--color-grid-line);
  background: var(--color-surface);
  padding: 13px;
  text-align: left;
  font-size: 13px;
  line-height: 1.45;
  transition: border-color 120ms ease, background 120ms ease;
}

.example-prompt:hover {
  border-color: var(--color-ink);
  background: var(--color-surface-warm);
}

.chat-message {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  border-top: 1px solid var(--color-grid-line);
  background: var(--color-surface);
}

.chat-message:last-of-type {
  border-bottom: 1px solid var(--color-grid-line);
}

.chat-message-role {
  padding: 17px 12px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-ink-faint);
}

.chat-message--assistant .chat-message-role {
  color: var(--color-accent);
}

.chat-message-content {
  min-width: 0;
  border-left: 1px solid var(--color-grid-line);
  padding: 15px 18px 18px;
}

.chat-markdown {
  font-size: 14px;
  line-height: 1.6;
}

.chat-markdown + .chat-markdown,
.chat-markdown + .sql-block,
.sql-block + .chat-markdown {
  margin-top: 12px;
}

:deep(.chat-markdown p) {
  margin: 0 0 10px;
}

:deep(.chat-markdown p:last-child) {
  margin-bottom: 0;
}

:deep(.chat-markdown ul),
:deep(.chat-markdown ol) {
  margin: 8px 0;
  padding-left: 22px;
}

:deep(.chat-markdown ul) {
  list-style: disc;
}

:deep(.chat-markdown ol) {
  list-style: decimal;
}

:deep(.chat-markdown code) {
  background: var(--color-surface-ruled);
  padding: 1px 4px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

:deep(.chat-markdown a) {
  color: var(--color-accent);
  text-decoration: underline;
}

.sql-block,
.reasoning-block {
  margin: 10px 0;
  border: 1px solid var(--color-grid-line);
  background: var(--color-surface-warm);
}

.sql-block summary,
.reasoning-block summary {
  display: flex;
  min-height: 38px;
  cursor: pointer;
  list-style: none;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-ink-light);
}

.sql-block summary::-webkit-details-marker,
.reasoning-block summary::-webkit-details-marker {
  display: none;
}

.sql-block-icon {
  color: var(--color-accent);
}

.sql-block-meta {
  margin-left: auto;
  color: var(--color-ink-faint);
}

.sql-block-chevron {
  transition: transform 120ms ease;
}

.sql-block[open] .sql-block-chevron {
  transform: rotate(180deg);
}

.sql-block pre {
  overflow-x: auto;
  border-top: 1px solid var(--color-grid-line);
  padding: 12px;
  white-space: pre-wrap;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-ink-light);
}

.reasoning-block > div {
  border-top: 1px solid var(--color-grid-line);
  padding: 10px;
  white-space: pre-wrap;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-ink-faint);
}

.stream-indicator {
  display: flex;
  width: fit-content;
  gap: 4px;
  margin-top: 14px;
  border: 1px solid var(--color-grid-line);
  background: var(--color-surface);
  padding: 10px 12px;
}

.stream-indicator span {
  width: 5px;
  height: 5px;
  background: var(--color-accent);
  animation: stream-step 900ms steps(2, end) infinite;
}

.stream-indicator span:nth-child(2) { animation-delay: 150ms; }
.stream-indicator span:nth-child(3) { animation-delay: 300ms; }

.chat-composer-shell {
  border-top: 1px solid var(--color-ink);
  background: var(--color-surface);
  padding: 12px max(20px, calc((100vw - 880px) / 2)) 16px;
}

.chat-error {
  margin-bottom: 8px;
  border: 1px solid var(--color-accent);
  background: var(--color-accent-dim);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--color-ink);
}

.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.chat-composer textarea {
  width: 100%;
  min-height: 58px;
  max-height: 160px;
  resize: vertical;
  border: 1px solid var(--color-grid-line);
  background: var(--color-surface);
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.45;
  outline: none;
}

.chat-composer textarea:focus {
  border-color: var(--color-ink);
}

.composer-action {
  width: 42px;
  height: 42px;
  flex-basis: 42px;
  border-color: var(--color-ink);
}

@keyframes chat-pulse {
  50% { opacity: 0.25; }
}

@keyframes stream-step {
  50% { opacity: 0.2; }
}

@media (max-width: 720px) {
  .data-chat-header {
    padding-inline: 12px;
  }

  .chat-status {
    min-width: 0;
  }

  .example-grid {
    grid-template-columns: 1fr;
  }

  .example-prompt {
    min-height: 58px;
  }

  .chat-transcript,
  .chat-composer-shell {
    padding-inline: 12px;
  }

  .chat-message {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .chat-message-role {
    padding-inline: 8px;
    font-size: 8px;
  }

  .chat-message-content {
    padding-inline: 12px;
  }
}
</style>
