<script setup lang="ts">
import { generateHTML } from '@tiptap/core'
import { Image } from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import TextAlign from '@tiptap/extension-text-align'
import { FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'

import { TextBlockSlot, extractCvSlots, type CvSlotDefinition } from '~/utils/tiptap-slot'

definePageMeta({ ssr: false })

type CvPage = { size: 'A4' | 'Letter'; margin: { top: number; right: number; bottom: number; left: number } }
type CvAssignmentEntry = { blockId: number }
type CvAssignments = Record<string, CvAssignmentEntry[]>
type CvBlockKind = 'intro' | 'paragraph' | 'bullet' | 'heading'

type CvDocumentSummary = { id: number; title: string; templateId: string; updatedAt: string }
type CvDocumentFull = CvDocumentSummary & {
  content: Record<string, any>
  page: CvPage
  slotAssignments: CvAssignments | null
}
type CvTemplateSummary = {
  id: string
  name: string
  layout: 'one-column' | 'compact-three-column'
  source: 'builtin' | 'custom'
  theme: Record<string, any>
  page: CvPage
}
type CvBlock = {
  id: number
  label: string
  kind: CvBlockKind
  content: Record<string, any>
  tags: string[]
  updatedAt: string
}

const { loggedIn } = useUserSession()

const pending = ref(true)
const hasWorkspaceAccess = ref(false)
const errorMessage = ref('')
const saving = ref(false)
const savedAt = ref<Date | null>(null)
const exporting = ref<'html' | 'pdf' | 'docx' | null>(null)

const documents = ref<CvDocumentSummary[]>([])
const templates = ref<CvTemplateSummary[]>([])
const blocks = ref<CvBlock[]>([])
const currentDocument = ref<CvDocumentFull | null>(null)
const selectedDocumentId = ref<number | null>(null)
const newCvTemplateId = ref('')
const skeleton = ref<Record<string, any> | null>(null)
const slots = ref<CvSlotDefinition[]>([])
const assignments = ref<CvAssignments>({})

const librarySearch = ref('')
const roleTagsInput = ref('')
const activeTagFilters = ref<string[]>([])
const dragOverSlot = ref<string | null>(null)

const editingBlockId = ref<number | null>(null)
const blockLabel = ref('')
const blockKind = ref<CvBlockKind>('paragraph')
const blockTagsInput = ref('')
const savingBlock = ref(false)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePromise: Promise<void> | null = null

// Schema for rendering materialized document JSON to preview HTML. Mirrors the
// template editor's node set (plus slot placeholders for unfilled slots).
const CvPreviewImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
      textAlign: { default: null },
      grayscale: {
        default: false,
        renderHTML: (attributes) => attributes.grayscale === true || attributes.grayscale === 'true'
          ? { 'data-grayscale': 'true', style: 'filter: grayscale(1)' }
          : {},
      },
    }
  },
})

const CvPreviewTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        renderHTML: (attributes) => attributes.borderless
          ? { 'data-borderless': 'true', class: 'cv-table-borderless' }
          : {},
      },
    }
  },
})

const previewExtensions = [
  StarterKit.configure({ link: false }),
  TextStyle,
  FontSize,
  TextBlockSlot,
  Link,
  CvPreviewImage,
  CvPreviewTable,
  TableRow,
  TableHeader,
  TableCell,
  TextAlign.configure({
    types: ['heading', 'paragraph'],
    alignments: ['left', 'center', 'right'],
    defaultAlignment: 'left',
  }),
]

// Small rich-text editor for authoring text blocks in the library panel.
const blockEditor = useEditor({
  extensions: [StarterKit.configure({ link: false })],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  immediatelyRender: false,
  editorProps: {
    attributes: { class: 'cv-block-editor-content' },
  },
})

const currentTemplate = computed(() =>
  templates.value.find((template) => template.id === currentDocument.value?.templateId))

const customTemplates = computed(() => templates.value.filter((template) => template.source === 'custom'))
const builtinTemplates = computed(() => templates.value.filter((template) => template.source === 'builtin'))

const previewHtml = computed(() => {
  const content = currentDocument.value?.content
  if (!content) return ''
  try {
    return generateHTML(content, previewExtensions)
  } catch {
    return ''
  }
})

const previewClass = computed(() => currentTemplate.value?.layout === 'compact-three-column' ? 'cv-preview--compact-grid' : '')
const activeCvFont = computed(() => currentTemplate.value?.theme?.fonts?.body || 'Arial')
const cvFontStyle = computed(() => ({ '--cv-selected-font': activeCvFont.value }))
const previewPageStyle = computed(() => {
  const margin = currentDocument.value?.page.margin
  if (!margin) return cvFontStyle.value
  const pct = (mm: number) => `${Math.max(0, mm) / 210 * 100}%`
  return {
    ...cvFontStyle.value,
    padding: `${pct(margin.top)} ${pct(margin.right)} ${pct(margin.bottom)} ${pct(margin.left)}`,
  }
})

const blocksById = computed(() => new Map(blocks.value.map((block) => [block.id, block])))

const allTags = computed(() => {
  const tags = new Map<string, string>()
  for (const block of blocks.value) {
    for (const tag of block.tags) {
      const key = tag.toLowerCase()
      if (!tags.has(key)) tags.set(key, tag)
    }
  }
  return [...tags.values()].sort((a, b) => a.localeCompare(b))
})

const roleTags = computed(() => parseTags(roleTagsInput.value))

// Library ordering: filter by search + tag chips, then boost blocks whose tags
// overlap the target-role tags; ties fall back to most recently updated.
const filteredBlocks = computed(() => {
  const search = librarySearch.value.trim().toLowerCase()
  const filters = activeTagFilters.value.map((tag) => tag.toLowerCase())
  const role = roleTags.value.map((tag) => tag.toLowerCase())

  return blocks.value
    .filter((block) => {
      if (search && !block.label.toLowerCase().includes(search) && !blockText(block).toLowerCase().includes(search)) return false
      if (filters.length && !filters.some((filter) => block.tags.some((tag) => tag.toLowerCase() === filter))) return false
      return true
    })
    .map((block) => ({
      block,
      roleMatches: role.filter((tag) => block.tags.some((blockTag) => blockTag.toLowerCase() === tag)).length,
    }))
    .sort((a, b) =>
      b.roleMatches - a.roleMatches
      || Date.parse(b.block.updatedAt) - Date.parse(a.block.updatedAt))
})

onMounted(loadWorkspace)
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  blockEditor.value?.destroy()
})

watch(selectedDocumentId, async (id) => {
  if (id && id !== currentDocument.value?.id) await loadDocument(id)
  if (!id) {
    currentDocument.value = null
    skeleton.value = null
    slots.value = []
    assignments.value = {}
  }
})

async function loadWorkspace() {
  pending.value = true
  errorMessage.value = ''
  try {
    const [templateData, documentData, blockData] = await Promise.all([
      $fetch<{ templates: CvTemplateSummary[] }>('/api/cv/templates'),
      $fetch<{ documents: CvDocumentSummary[] }>('/api/cv/documents'),
      $fetch<{ blocks: CvBlock[] }>('/api/cv/blocks'),
    ])
    templates.value = templateData.templates
    documents.value = documentData.documents
    blocks.value = blockData.blocks
    // Custom templates are the ones with slots, so they are the sensible
    // default for a new CV; latest one first.
    const customs = templateData.templates.filter((template) => template.source === 'custom')
    newCvTemplateId.value = customs.at(-1)?.id ?? templateData.templates[0]?.id ?? ''
    hasWorkspaceAccess.value = true
    const firstDocumentId = documentData.documents[0]?.id ?? null
    if (firstDocumentId) await loadDocument(firstDocumentId)
    selectedDocumentId.value = firstDocumentId
  } catch (error: any) {
    hasWorkspaceAccess.value = false
    errorMessage.value = error?.statusMessage || error?.message || 'CV editor is unavailable'
  } finally {
    pending.value = false
  }
}

async function loadDocument(id: number) {
  const data = await $fetch<{ document: CvDocumentFull }>(`/api/cv/documents/${id}`)
  currentDocument.value = data.document
  assignments.value = data.document.slotAssignments ?? {}
  await loadTemplateSkeleton(data.document.templateId)
}

async function loadTemplateSkeleton(templateId: string) {
  try {
    const data = await $fetch<{ template: { skeleton: Record<string, any> } }>(`/api/cv/templates/${templateId}`)
    skeleton.value = data.template.skeleton
    slots.value = extractCvSlots(data.template.skeleton)
  } catch {
    skeleton.value = null
    slots.value = []
    errorMessage.value = `Template "${templateId}" could not be loaded`
  }
}

async function createDocument() {
  if (!newCvTemplateId.value) return
  errorMessage.value = ''
  try {
    const data = await $fetch<{ document: CvDocumentFull }>('/api/cv/documents', {
      method: 'POST',
      body: { templateId: newCvTemplateId.value, title: 'Untitled CV' },
    })
    documents.value.unshift(data.document)
    currentDocument.value = data.document
    assignments.value = data.document.slotAssignments ?? {}
    await loadTemplateSkeleton(data.document.templateId)
    selectedDocumentId.value = data.document.id
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'CV creation failed'
  }
}

async function deleteCurrentDocument() {
  if (!currentDocument.value) return
  if (!window.confirm(`Delete "${currentDocument.value.title}"?`)) return
  const documentId = currentDocument.value.id
  errorMessage.value = ''
  try {
    await $fetch(`/api/cv/documents/${documentId}`, { method: 'DELETE' })
    documents.value = documents.value.filter((document) => document.id !== documentId)
    selectedDocumentId.value = documents.value[0]?.id ?? null
    if (!selectedDocumentId.value) {
      currentDocument.value = null
      skeleton.value = null
      slots.value = []
      assignments.value = {}
    }
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Delete failed'
  }
}

async function switchTemplate(templateId: string) {
  if (!currentDocument.value || !templateId || templateId === currentDocument.value.templateId) return
  errorMessage.value = ''
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savePromise) await savePromise
  try {
    const data = await $fetch<{ document: CvDocumentFull }>(`/api/cv/documents/${currentDocument.value.id}`, {
      method: 'PATCH',
      body: { templateId },
    })
    currentDocument.value = data.document
    assignments.value = data.document.slotAssignments ?? {}
    await loadTemplateSkeleton(data.document.templateId)
    documents.value = documents.value.map((document) =>
      document.id === data.document.id
        ? { id: data.document.id, title: data.document.title, templateId: data.document.templateId, updatedAt: data.document.updatedAt }
        : document,
    )
    savedAt.value = new Date()
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Template switch failed'
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveDocument()
  }, 500)
}

async function saveDocument() {
  if (!currentDocument.value) return
  if (savePromise) return savePromise
  saving.value = true
  const documentId = currentDocument.value.id
  const payload = {
    title: currentDocument.value.title,
    slotAssignments: JSON.parse(JSON.stringify(assignments.value)) as CvAssignments,
  }
  savePromise = (async () => {
    errorMessage.value = ''
    try {
      const data = await $fetch<{ document: CvDocumentFull }>(`/api/cv/documents/${documentId}`, {
        method: 'PATCH',
        body: payload,
      })
      if (currentDocument.value?.id === data.document.id) {
        currentDocument.value = data.document
      }
      documents.value = documents.value.map((document) =>
        document.id === data.document.id
          ? { id: data.document.id, title: data.document.title, templateId: data.document.templateId, updatedAt: data.document.updatedAt }
          : document,
      )
      savedAt.value = new Date()
    } catch (error: any) {
      errorMessage.value = error?.statusMessage || error?.message || 'Save failed'
    } finally {
      saving.value = false
      savePromise = null
    }
  })()

  await savePromise
}

function slotEntries(slotName: string) {
  return assignments.value[slotName] ?? []
}

function assignBlock(slotName: string, blockId: number, index?: number) {
  const entries = [...slotEntries(slotName)]
  const entry = { blockId }
  if (typeof index === 'number' && index >= 0 && index <= entries.length) {
    entries.splice(index, 0, entry)
  } else {
    entries.push(entry)
  }
  assignments.value = { ...assignments.value, [slotName]: entries }
  scheduleSave()
}

function removeAssignment(slotName: string, index: number) {
  const entries = [...slotEntries(slotName)]
  entries.splice(index, 1)
  assignments.value = { ...assignments.value, [slotName]: entries }
  scheduleSave()
}

function moveAssignment(slotName: string, index: number, direction: -1 | 1) {
  const entries = [...slotEntries(slotName)]
  const target = index + direction
  if (target < 0 || target >= entries.length) return
  const [entry] = entries.splice(index, 1)
  entries.splice(target, 0, entry!)
  assignments.value = { ...assignments.value, [slotName]: entries }
  scheduleSave()
}

function onBlockDragStart(block: CvBlock, event: DragEvent) {
  event.dataTransfer?.setData('text/plain', String(block.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function onSlotDragOver(slotName: string, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  dragOverSlot.value = slotName
}

function onSlotDrop(slotName: string, event: DragEvent) {
  event.preventDefault()
  dragOverSlot.value = null
  const blockId = Number(event.dataTransfer?.getData('text/plain'))
  if (!Number.isInteger(blockId) || blockId <= 0 || !blocksById.value.has(blockId)) return
  assignBlock(slotName, blockId)
}

function parseTags(value: string) {
  const seen = new Set<string>()
  return value
    .split(',')
    .map((tag) => tag.trim().replace(/\s+/g, ' '))
    .filter((tag) => {
      if (!tag) return false
      const key = tag.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function toggleTagFilter(tag: string) {
  const key = tag.toLowerCase()
  activeTagFilters.value = activeTagFilters.value.some((entry) => entry.toLowerCase() === key)
    ? activeTagFilters.value.filter((entry) => entry.toLowerCase() !== key)
    : [...activeTagFilters.value, tag]
}

function isTagFilterActive(tag: string) {
  const key = tag.toLowerCase()
  return activeTagFilters.value.some((entry) => entry.toLowerCase() === key)
}

function blockText(block: CvBlock): string {
  const parts: string[] = []
  function visit(node: any) {
    if (!node || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(block.content)
  return parts.join(' ')
}

function blockSnippet(block: CvBlock) {
  const text = blockText(block)
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function startNewBlock() {
  editingBlockId.value = null
  blockLabel.value = ''
  blockKind.value = 'paragraph'
  blockTagsInput.value = roleTagsInput.value
  blockEditor.value?.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false })
}

function editBlock(block: CvBlock) {
  editingBlockId.value = block.id
  blockLabel.value = block.label
  blockKind.value = block.kind
  blockTagsInput.value = block.tags.join(', ')
  blockEditor.value?.commands.setContent(block.content, { emitUpdate: false })
}

async function saveBlock() {
  const label = blockLabel.value.trim()
  if (!label) {
    errorMessage.value = 'Text block label is required'
    return
  }
  savingBlock.value = true
  errorMessage.value = ''
  const body = {
    label,
    kind: blockKind.value,
    content: blockEditor.value?.getJSON() ?? { type: 'doc', content: [] },
    tags: parseTags(blockTagsInput.value),
  }
  try {
    if (editingBlockId.value === null) {
      const data = await $fetch<{ block: CvBlock }>('/api/cv/blocks', { method: 'POST', body })
      blocks.value.unshift(data.block)
      editingBlockId.value = data.block.id
    } else {
      const data = await $fetch<{ block: CvBlock }>(`/api/cv/blocks/${editingBlockId.value}`, { method: 'PATCH', body })
      blocks.value = blocks.value.map((block) => block.id === data.block.id ? data.block : block)
      // Re-save assignments so documents using this block get re-materialized.
      if (isBlockAssigned(data.block.id)) scheduleSave()
    }
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Text block save failed'
  } finally {
    savingBlock.value = false
  }
}

async function deleteBlock(block: CvBlock) {
  if (!window.confirm(`Delete text block "${block.label}"?`)) return
  errorMessage.value = ''
  try {
    await $fetch(`/api/cv/blocks/${block.id}`, { method: 'DELETE' })
    blocks.value = blocks.value.filter((entry) => entry.id !== block.id)
    if (editingBlockId.value === block.id) startNewBlock()

    // Drop dangling assignments in the open document.
    if (isBlockAssigned(block.id)) {
      const next: CvAssignments = {}
      for (const [slot, entries] of Object.entries(assignments.value)) {
        next[slot] = entries.filter((entry) => entry.blockId !== block.id)
      }
      assignments.value = next
      scheduleSave()
    }
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Text block delete failed'
  }
}

function isBlockAssigned(blockId: number) {
  return Object.values(assignments.value).some((entries) => entries.some((entry) => entry.blockId === blockId))
}

async function exportDocument(format: 'html' | 'pdf' | 'docx') {
  if (!currentDocument.value) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (savePromise) await savePromise
  await saveDocument()
  exporting.value = format
  errorMessage.value = ''
  try {
    const result = await $fetch<{ url: string }>(`/api/cv/documents/${currentDocument.value.id}/export`, {
      method: 'POST',
      body: { format },
    })
    await downloadExportFile(result.url, format)
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Export failed'
  } finally {
    exporting.value = null
  }
}

async function downloadExportFile(url: string, format: 'html' | 'pdf' | 'docx') {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok) {
    throw new Error(await exportErrorMessage(response))
  }

  const blob = await response.blob()
  await validateDownloadedExport(blob, format)

  const downloadUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = exportFileName(response, format)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(downloadUrl)
}

async function exportErrorMessage(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return `Export download failed (${response.status})`
  try {
    const payload = JSON.parse(text)
    return payload.statusMessage || payload.message || `Export download failed (${response.status})`
  } catch {
    return text.slice(0, 220)
  }
}

async function validateDownloadedExport(blob: Blob, format: 'html' | 'pdf' | 'docx') {
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const startsWith = (value: string) => value.split('').every((char, index) => head[index] === char.charCodeAt(0))

  if (format === 'pdf' && (blob.size < 1024 || !startsWith('%PDF-'))) {
    throw new Error('PDF export returned an invalid file')
  }
  if (format === 'docx' && (blob.size < 4096 || !startsWith('PK'))) {
    throw new Error('DOCX export returned an invalid file')
  }
  if (format === 'html' && blob.size < 64) {
    throw new Error('HTML export returned an invalid file')
  }
}

function exportFileName(response: Response, format: 'html' | 'pdf' | 'docx') {
  const disposition = response.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
  const name = match?.[1] ? decodeURIComponent(match[1]) : currentDocument.value?.title || 'CV'
  const extension = name.toLowerCase().endsWith(`.${format}`) ? '' : `.${format}`
  return `${name}${extension}`
}

function formatSavedAt(date: Date | null) {
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not saved yet'
}
</script>

<template>
  <main class="min-h-screen bg-surface text-ink">
    <div class="border-b border-grid-line px-5 py-4 lg:px-8">
      <div class="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <NuxtLink to="/cv" class="font-mono text-[10px] font-600 uppercase tracking-[0.18em] text-ink-faint">
            CV Studio
          </NuxtLink>
          <h1 class="mt-1 font-mono text-[22px] font-700 uppercase tracking-0 text-ink">CV Editor</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span class="border border-grid-line px-3 py-2 text-ink-faint">{{ saving ? 'Saving' : `Saved ${formatSavedAt(savedAt)}` }}</span>
          <NuxtLink class="border border-grid-line px-3 py-2 hover:border-ink" to="/template-editor">
            Template Editor
          </NuxtLink>
          <button
            class="border border-ink px-3 py-2 hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!currentDocument"
            @click="exportDocument('pdf')"
          >
            {{ exporting === 'pdf' ? 'PDF…' : 'PDF' }}
          </button>
          <button
            class="border border-ink px-3 py-2 hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!currentDocument"
            @click="exportDocument('docx')"
          >
            {{ exporting === 'docx' ? 'DOCX…' : 'DOCX' }}
          </button>
          <button
            class="border border-accent px-3 py-2 text-accent hover:bg-accent hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!currentDocument"
            @click="deleteCurrentDocument"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <div v-if="pending" class="w-full px-5 py-8 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-faint lg:px-8">
      Loading workspace
    </div>

    <div v-else-if="!loggedIn" class="w-full px-5 py-8 lg:px-8">
      <div class="panel reg-marks max-w-xl p-6">
        <div class="panel-header">Access</div>
        <p class="text-[15px] text-ink-light">Login is required before CVs can be composed.</p>
        <NuxtLink class="mt-5 inline-block border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-ink hover:text-surface" to="/login">
          Login
        </NuxtLink>
      </div>
    </div>

    <div v-else-if="!hasWorkspaceAccess" class="w-full px-5 py-8 lg:px-8">
      <div class="panel reg-marks max-w-xl p-6">
        <div class="panel-header">Restricted</div>
        <p class="text-[15px] text-ink-light">{{ errorMessage || 'The CV editor is currently restricted by the rollout switch.' }}</p>
      </div>
    </div>

    <div v-else class="grid w-full gap-5 px-5 py-5 lg:grid-cols-[340px_minmax(0,1fr)_minmax(340px,32vw)] lg:px-8">
      <!-- ── Library: CVs + text blocks ────────────────────────────── -->
      <aside class="panel reg-marks h-fit min-w-0 p-4">
        <div class="panel-header">My CVs</div>
        <div class="space-y-2">
          <button
            v-for="document in documents"
            :key="document.id"
            type="button"
            class="w-full border px-3 py-2 text-left text-[13px]"
            :class="document.id === selectedDocumentId ? 'border-ink bg-surface-warm' : 'border-grid-line hover:border-ink'"
            @click="selectedDocumentId = document.id"
          >
            <span class="block font-600 text-ink">{{ document.title }}</span>
          </button>
        </div>
        <div class="mt-3 flex gap-2">
          <select
            v-model="newCvTemplateId"
            class="min-w-0 flex-1 border border-grid-line bg-surface px-2 py-2 font-mono text-[10px] uppercase tracking-[0.1em] outline-none focus:border-ink"
          >
            <optgroup v-if="customTemplates.length" label="Your templates">
              <option v-for="template in customTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </optgroup>
            <optgroup label="Built-in (no slots)">
              <option v-for="template in builtinTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </optgroup>
          </select>
          <button class="shrink-0 border border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:bg-ink hover:text-surface" type="button" @click="createDocument">
            New CV
          </button>
        </div>

        <div class="mt-6 border-t border-grid-line pt-4">
          <div class="panel-header">Target Role</div>
          <input
            v-model="roleTagsInput"
            placeholder="e.g. Manager, Product Owner"
            class="mb-1 w-full border border-grid-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
          >
          <p class="mb-4 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
            Blocks tagged with these roles are ranked first
          </p>

          <div class="panel-header">Text Blocks</div>
          <input
            v-model="librarySearch"
            placeholder="Search blocks"
            class="mb-2 w-full border border-grid-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
          >
          <div v-if="allTags.length" class="mb-3 flex flex-wrap gap-1">
            <button
              v-for="tag in allTags"
              :key="tag"
              type="button"
              class="border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em]"
              :class="isTagFilterActive(tag) ? 'border-ink bg-ink text-surface' : 'border-grid-line text-ink-faint hover:border-ink hover:text-ink'"
              @click="toggleTagFilter(tag)"
            >
              {{ tag }}
            </button>
          </div>

          <div class="max-h-[380px] space-y-2 overflow-y-auto pr-1">
            <div
              v-for="{ block, roleMatches } in filteredBlocks"
              :key="block.id"
              class="cv-library-block border border-grid-line bg-surface p-3"
              :class="{ 'border-ink': roleMatches > 0 }"
              draggable="true"
              @dragstart="onBlockDragStart(block, $event)"
            >
              <div class="flex items-start justify-between gap-2">
                <span class="min-w-0 text-[13px] font-600 text-ink">{{ block.label }}</span>
                <span v-if="roleMatches" class="shrink-0 border border-ink px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]">
                  Match
                </span>
              </div>
              <p class="mt-1 text-[12px] leading-snug text-ink-light">{{ blockSnippet(block) }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-1">
                <span
                  v-for="tag in block.tags"
                  :key="tag"
                  class="border border-grid-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-faint"
                >
                  {{ tag }}
                </span>
                <span class="ml-auto flex gap-1">
                  <button class="cv-block-action" type="button" @click="editBlock(block)">Edit</button>
                  <button class="cv-block-action cv-block-action--danger" type="button" @click="deleteBlock(block)">Del</button>
                </span>
              </div>
            </div>
            <p v-if="!filteredBlocks.length" class="border border-grid-line px-3 py-3 text-[12px] text-ink-faint">
              No text blocks yet. Create one below — then drag it into a slot.
            </p>
          </div>
        </div>

        <div class="mt-6 border-t border-grid-line pt-4">
          <div class="flex items-center justify-between">
            <div class="panel-header">{{ editingBlockId === null ? 'New Block' : 'Edit Block' }}</div>
            <button
              v-if="editingBlockId !== null"
              class="mb-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-faint hover:text-ink"
              type="button"
              @click="startNewBlock"
            >
              + New instead
            </button>
          </div>
          <input
            v-model="blockLabel"
            placeholder="Label (e.g. Intro — AI focus)"
            class="mb-2 w-full border border-grid-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
          >
          <div class="mb-2 flex gap-2">
            <select
              v-model="blockKind"
              class="border border-grid-line bg-surface px-2 py-2 font-mono text-[10px] uppercase tracking-[0.1em] outline-none focus:border-ink"
            >
              <option value="intro">Intro</option>
              <option value="paragraph">Paragraph</option>
              <option value="bullet">Bullet</option>
              <option value="heading">Heading</option>
            </select>
            <input
              v-model="blockTagsInput"
              placeholder="Tags, comma-separated"
              class="min-w-0 flex-1 border border-grid-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
            >
          </div>
          <ClientOnly>
            <EditorContent :editor="blockEditor" />
          </ClientOnly>
          <button
            class="mt-2 w-full border border-ink px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="savingBlock"
            @click="saveBlock"
          >
            {{ savingBlock ? 'Saving' : editingBlockId === null ? 'Create Block' : 'Update Block' }}
          </button>
        </div>
      </aside>

      <!-- ── Canvas: slots ──────────────────────────────────────────── -->
      <section v-if="currentDocument" class="panel reg-marks-full h-fit min-w-0 p-4">
        <div class="mb-4 border-b border-grid-line pb-4">
          <input
            v-model="currentDocument.title"
            class="w-full border border-grid-line bg-surface px-3 py-2 font-mono text-[18px] font-700 uppercase outline-none focus:border-ink"
            @input="scheduleSave"
          >
          <label class="mt-2 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
            Template
            <select
              :value="currentDocument.templateId"
              class="min-w-0 border border-grid-line bg-surface px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink outline-none focus:border-ink"
              @change="switchTemplate(($event.target as HTMLSelectElement).value)"
            >
              <optgroup v-if="customTemplates.length" label="Your templates">
                <option v-for="template in customTemplates" :key="template.id" :value="template.id">
                  {{ template.name }}
                </option>
              </optgroup>
              <optgroup label="Built-in (no slots)">
                <option v-for="template in builtinTemplates" :key="template.id" :value="template.id">
                  {{ template.name }}
                </option>
              </optgroup>
            </select>
          </label>
        </div>

        <div v-if="!slots.length" class="border border-grid-line px-4 py-5 text-[13px] text-ink-light">
          This template has no slots yet. Open the
          <NuxtLink class="underline hover:text-ink" to="/template-editor">Template Editor</NuxtLink>
          and insert slots (+ Slot / + Bullet Slot) where text blocks should go.
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="slot in slots"
            :key="slot.name"
            class="cv-slot-zone border"
            :class="dragOverSlot === slot.name ? 'border-accent bg-accent-dim' : 'border-grid-line'"
            @dragover="onSlotDragOver(slot.name, $event)"
            @dragleave="dragOverSlot = null"
            @drop="onSlotDrop(slot.name, $event)"
          >
            <div class="flex items-center justify-between border-b border-grid-line px-3 py-2">
              <span class="font-mono text-[10px] font-600 uppercase tracking-[0.14em] text-ink">⬚ {{ slot.name }}</span>
              <span class="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
                {{ slot.kind === 'bullets' ? 'Bullet list' : 'Text' }} · {{ slotEntries(slot.name).length }} block(s)
              </span>
            </div>
            <div class="space-y-1 p-2">
              <div
                v-for="(entry, index) in slotEntries(slot.name)"
                :key="`${entry.blockId}-${index}`"
                class="flex items-center gap-2 border border-grid-line bg-surface px-2 py-1.5"
              >
                <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {{ blocksById.get(entry.blockId)?.label ?? `Block #${entry.blockId} (deleted)` }}
                </span>
                <button class="cv-block-action" type="button" :disabled="index === 0" @click="moveAssignment(slot.name, index, -1)">↑</button>
                <button class="cv-block-action" type="button" :disabled="index === slotEntries(slot.name).length - 1" @click="moveAssignment(slot.name, index, 1)">↓</button>
                <button class="cv-block-action cv-block-action--danger" type="button" @click="removeAssignment(slot.name, index)">✕</button>
              </div>
              <p v-if="!slotEntries(slot.name).length" class="px-2 py-2 text-[12px] text-ink-faint">
                Drag a text block here
              </p>
            </div>
          </div>
        </div>
      </section>

      <section v-else class="panel reg-marks-full h-fit min-w-0 p-6 text-[14px] text-ink-light">
        Create or select a CV to start composing.
      </section>

      <!-- ── Preview ────────────────────────────────────────────────── -->
      <aside class="min-w-0">
        <div class="sticky top-5">
          <div class="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>Preview</span>
            <span>A4</span>
          </div>
          <div class="cv-preview-frame">
            <div class="cv-preview bg-white text-[#1a1a2e]" :class="previewClass" :style="previewPageStyle" v-html="previewHtml" />
          </div>
          <p v-if="errorMessage" class="mt-4 border border-accent bg-accent-dim px-3 py-2 text-[13px] text-ink">
            {{ errorMessage }}
          </p>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.cv-library-block {
  cursor: grab;
}

.cv-library-block:active {
  cursor: grabbing;
}

.cv-block-action {
  border: 1px solid var(--color-grid-line);
  padding: 2px 6px;
  color: var(--color-ink-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
}

.cv-block-action:hover:not(:disabled) {
  border-color: var(--color-ink);
  color: var(--color-ink);
}

.cv-block-action:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}

.cv-block-action--danger {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.cv-block-action--danger:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-surface);
}

.cv-slot-zone {
  transition: border-color 120ms ease, background-color 120ms ease;
}

:deep(.cv-block-editor-content) {
  min-height: 90px;
  outline: none;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid var(--color-grid-line);
  font-size: 13px;
  line-height: 1.5;
}

:deep(.cv-block-editor-content p) {
  margin: 4px 0;
}

:deep(.cv-block-editor-content ul),
:deep(.cv-block-editor-content ol) {
  margin: 4px 0 4px 16px;
  padding-left: 12px;
}

:deep(.cv-block-editor-content ul) {
  list-style-type: disc;
}

:deep(.cv-block-editor-content ol) {
  list-style-type: decimal;
}

.cv-preview {
  aspect-ratio: 210 / 297;
  width: 100%;
  overflow: hidden;
  padding: 28px;
  box-shadow: 0 18px 50px rgba(26, 26, 46, 0.12);
  font-family: var(--cv-selected-font), Arial, sans-serif;
  font-size: 10px;
  line-height: 1.45;
}

.cv-preview-frame {
  position: relative;
  aspect-ratio: 210 / 297;
  width: 100%;
}

.cv-preview :deep(h1) {
  margin: 0 0 8px;
  font-size: 24px;
  line-height: 1.1;
}

.cv-preview :deep(h2) {
  margin: 18px 0 8px;
  border-bottom: 1px solid var(--color-accent);
  color: var(--color-accent);
  font-size: 13px;
  line-height: 1.2;
}

.cv-preview :deep(p),
.cv-preview :deep(ul),
.cv-preview :deep(ol) {
  margin: 6px 0;
}

.cv-preview :deep(.cv-slot-placeholder) {
  margin: 4px 0;
  border: 1px dashed var(--color-accent);
  padding: 3px 6px;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 7px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.cv-preview :deep(ul),
.cv-preview :deep(ol) {
  padding-left: 16px;
}

.cv-preview :deep(ul) {
  list-style-type: disc;
}

.cv-preview :deep(ol) {
  list-style-type: decimal;
}

.cv-preview :deep(ul ul) {
  list-style-type: circle;
}

.cv-preview :deep(ul ul ul) {
  list-style-type: square;
}

.cv-preview :deep(p),
.cv-preview :deep(li) {
  white-space: pre-wrap;
}

.cv-preview :deep(li > p) {
  margin: 2px 0;
}

.cv-preview :deep(li::marker) {
  font-size: 1.35em;
}

.cv-preview :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 6px 0;
}

.cv-preview :deep(img[data-grayscale="true"]) {
  filter: grayscale(1);
}

.cv-preview :deep(table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 6px 0 16px;
}

.cv-preview :deep(td),
.cv-preview :deep(th) {
  padding: 3px 7px 3px 0;
  vertical-align: top;
}

.cv-preview--compact-grid {
  padding: 22px 16px 22px 30px;
  color: #000;
  font-family: var(--cv-selected-font), Arial, sans-serif;
  font-size: 9.7px;
  line-height: 1.32;
  letter-spacing: 0.02em;
}

.cv-preview--compact-grid :deep(h1) {
  margin: 0 0 2px;
  text-align: center;
  font-size: 18px;
  font-weight: 400;
  letter-spacing: 0.14em;
}

.cv-preview--compact-grid :deep(h2) {
  margin: 13px 0 5px;
  border-bottom: 1px solid #000;
  color: #000;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.cv-preview--compact-grid :deep(p) {
  margin: 2px 0;
}

.cv-preview--compact-grid :deep(ul) {
  margin: 3px 0 3px 12px;
}

.cv-preview--compact-grid :deep(table:first-child td:nth-child(2)) {
  text-align: center;
}

.cv-preview--compact-grid :deep(td:nth-child(3)) {
  text-align: right;
}
</style>
