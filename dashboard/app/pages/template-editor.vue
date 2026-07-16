<script setup lang="ts">
import { Extension, ResizableNodeView, mergeAttributes } from '@tiptap/core'
import type { Editor as TiptapEditor } from '@tiptap/core'
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

import { TextBlockSlot, type CvSlotKind } from '~/utils/tiptap-slot'

definePageMeta({ ssr: false })

type CvPage = { size: 'A4' | 'Letter'; margin: { top: number; right: number; bottom: number; left: number } }

type CvTemplateSummary = {
  id: string
  name: string
  layout: 'one-column' | 'compact-three-column'
  source: 'builtin' | 'custom'
  theme: Record<string, any>
  page: CvPage
}

type CvTemplateFull = CvTemplateSummary & { skeleton: Record<string, any> }

const { loggedIn } = useUserSession()

const templates = ref<CvTemplateSummary[]>([])
const currentTemplate = ref<CvTemplateFull | null>(null)
const selectedTemplateId = ref<string | null>(null)
const pending = ref(true)
const saving = ref(false)
const uploading = ref(false)
const errorMessage = ref('')
const savedAt = ref<Date | null>(null)
const hasWorkspaceAccess = ref(false)
const fontOptions = ref<string[]>([])
const selectedCvFont = ref('')
const editorSelectionVersion = ref(0)
const fontSizeOptions = ['8pt', '9pt', '10pt', '10.5pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt']
const imageInput = ref<HTMLInputElement | null>(null)
const showPreviewMidline = ref(false)
const showPreviewThirds = ref(false)
type CvTextAlign = 'left' | 'center' | 'right'

const CvEditingKeys = Extension.create({
  name: 'cvEditingKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor.isActive('listItem')) return false
        return this.editor.commands.splitListItem('listItem')
      },
      Tab: () => {
        if (this.editor.isActive('listItem')) {
          return this.editor.commands.sinkListItem('listItem')
        }
        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (!this.editor.isActive('listItem')) return false
        return this.editor.commands.liftListItem('listItem')
      },
      'Mod-k': () => {
        openLinkPrompt(this.editor)
        return true
      },
    }
  },
})

const CvImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      textAlign: {
        default: null,
        parseHTML: (element) => normalizeCvTextAlign(element.getAttribute('data-align')),
      },
      grayscale: {
        default: false,
        parseHTML: (element) => isImageGrayscale(element.getAttribute('data-grayscale')) || element.style.filter.includes('grayscale'),
        renderHTML: (attributes) => isImageGrayscale(attributes.grayscale) ? { 'data-grayscale': 'true' } : {},
      },
    }
  },
  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }
    const align = normalizeCvTextAlign(attrs.textAlign)
    const grayscale = isImageGrayscale(attrs.grayscale)
    delete attrs.textAlign
    delete attrs.grayscale
    if (align) {
      attrs['data-align'] = align
    }
    if (grayscale) attrs['data-grayscale'] = 'true'
    attrs.style = [
      attrs.style,
      align ? imageAlignStyle(align) : '',
      grayscale ? 'filter: grayscale(1)' : '',
    ].filter(Boolean).join('; ')
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)]
  },
  addNodeView() {
    if (!this.options.resize || !this.options.resize.enabled || typeof document === 'undefined') return null

    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize

    return ({ node, getPos, HTMLAttributes, editor }) => {
      const el = document.createElement('img')
      el.draggable = false
      applyImageElementAttributes(el, HTMLAttributes)
      let currentNode = node
      let isResizing = false

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width, height) => {
          isResizing = true
          el.style.width = `${width}px`
          el.style.height = `${imageAspectHeight(el, width, height)}px`
        },
        onCommit: (width, height) => {
          commitImageResize(editor, getPos, this.name, el, width, height)
          isResizing = false
        },
        onUpdate: (updatedNode) => {
          if (updatedNode.type !== node.type) return false
          currentNode = updatedNode
          if (!isResizing) {
            applyImageNodeAttributes(el, updatedNode.attrs)
          }
          applyImageContainerAlignment(nodeView.dom as HTMLElement, updatedNode.attrs.textAlign)
          return true
        },
        options: {
          directions,
          min: {
            width: minWidth,
            height: minHeight,
          },
          preserveAspectRatio: alwaysPreserveAspectRatio === true,
        },
      })

      const dom = nodeView.dom as HTMLElement
      applyImageContainerAlignment(dom, node.attrs.textAlign)

      const removeButton = document.createElement('button')
      removeButton.type = 'button'
      removeButton.className = 'cv-image-remove-button'
      removeButton.setAttribute('aria-label', 'Remove image')
      removeButton.title = 'Remove image'
      removeButton.textContent = 'X'
      removeButton.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      removeButton.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = getPos()
        if (pos === undefined) return
        editor.chain().focus().deleteRange({ from: pos, to: pos + currentNode.nodeSize }).run()
      })
      dom.appendChild(removeButton)

      dom.style.visibility = 'hidden'
      dom.style.pointerEvents = 'none'
      const revealImageNode = () => {
        applyImageNodeAttributes(el, currentNode.attrs)
        dom.style.visibility = ''
        dom.style.pointerEvents = ''
      }
      el.onload = revealImageNode
      el.onerror = revealImageNode
      if (el.complete) queueMicrotask(revealImageNode)

      return nodeView
    }
  },
})

const CvTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-borderless') === 'true',
        renderHTML: (attributes) => attributes.borderless
          ? { 'data-borderless': 'true', class: 'cv-table-borderless' }
          : {},
      },
    }
  },
})

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      link: false,
    }),
    CvEditingKeys,
    TextStyle,
    FontSize,
    TextBlockSlot,
    Link.configure({
      autolink: true,
      linkOnPaste: true,
      openOnClick: false,
      enableClickSelection: true,
      defaultProtocol: 'https',
      protocols: [
        'mailto',
        {
          scheme: 'tel',
          optionalSlashes: true,
        },
      ],
      HTMLAttributes: {
        rel: 'noopener noreferrer',
        target: '_blank',
      },
      isAllowedUri: (url, context) => context.defaultValidate(url) && isAllowedCvLink(url, context.defaultProtocol),
    }),
    CvImage.configure({
      allowBase64: false,
      resize: {
        enabled: true,
        directions: ['right', 'bottom-right'],
        minWidth: 24,
        minHeight: 24,
        alwaysPreserveAspectRatio: true,
      },
    }),
    CvTable.configure({
      resizable: true,
      handleWidth: 8,
      cellMinWidth: 42,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right'],
      defaultAlignment: 'left',
    }),
  ],
  content: { type: 'doc', content: [] },
  immediatelyRender: false,
  editorProps: {
    attributes: {
      class: 'cv-editor-content',
    },
    handleDrop: (view, event) => {
      const files = imageFilesFromList(event.dataTransfer?.files)
      if (!files.length) return false
      event.preventDefault()
      const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
      void insertImageFiles(files, position)
      return true
    },
    handlePaste: (_view, event) => {
      const files = imageFilesFromList(event.clipboardData?.files)
      if (!files.length) return false
      event.preventDefault()
      void insertImageFiles(files)
      return true
    },
  },
  onUpdate: ({ editor }) => {
    if (applyingRemoteContent) return
    if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
    currentTemplate.value.skeleton = editor.getJSON()
    editorSelectionVersion.value += 1
    scheduleSave()
  },
  onSelectionUpdate: () => {
    editorSelectionVersion.value += 1
  },
})

const previewHtml = computed(() => editor.value?.getHTML() || '')
const isEditableTemplate = computed(() => currentTemplate.value?.source === 'custom')
const previewClass = computed(() => currentTemplate.value?.layout === 'compact-three-column' ? 'cv-preview--compact-grid' : '')
const activeCvFont = computed(() => selectedCvFont.value || currentTemplate.value?.theme?.fonts?.body || 'Arial')
const cvFontStyle = computed(() => ({ '--cv-selected-font': activeCvFont.value }))
const isTableActive = computed(() => {
  editorSelectionVersion.value
  return editor.value?.isActive('table') ?? false
})
const selectedTableBorderless = computed(() => {
  editorSelectionVersion.value
  const table = selectedTableNode(editor.value)
  return table?.node.attrs.borderless === true
})
const isImageActive = computed(() => {
  editorSelectionVersion.value
  return editor.value?.isActive('image') ?? false
})
const selectedImageGrayscale = computed(() => {
  editorSelectionVersion.value
  return isImageGrayscale(editor.value?.getAttributes('image')?.grayscale)
})
const selectedTextFontSize = computed(() => {
  editorSelectionVersion.value
  const fontSize = editor.value?.getAttributes('textStyle')?.fontSize
  return typeof fontSize === 'string' && fontSizeOptions.includes(fontSize) ? fontSize : ''
})
const selectedLinkHref = computed(() => {
  editorSelectionVersion.value
  const href = editor.value?.getAttributes('link')?.href
  return typeof href === 'string' ? href : ''
})
const previewPageStyle = computed(() => {
  const margin = currentTemplate.value?.page.margin
  if (!margin) return cvFontStyle.value
  const pct = (mm: number) => `${Math.max(0, mm) / 210 * 100}%`
  return {
    ...cvFontStyle.value,
    padding: `${pct(margin.top)} ${pct(margin.right)} ${pct(margin.bottom)} ${pct(margin.left)}`,
  }
})
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savePromise: Promise<void> | null = null
let applyingRemoteContent = false

onMounted(loadWorkspace)
onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  editor.value?.destroy()
})

watch(selectedTemplateId, async (id) => {
  if (id && id !== currentTemplate.value?.id) await loadTemplate(id)
  if (!id) {
    currentTemplate.value = null
    setEditorDocumentContent({ type: 'doc', content: [] })
  }
})

watch(isEditableTemplate, (editable) => {
  editor.value?.setEditable(editable)
})

async function loadWorkspace() {
  pending.value = true
  errorMessage.value = ''
  try {
    const data = await $fetch<{ templates: CvTemplateSummary[]; fontOptions: string[] }>('/api/cv/templates')
    templates.value = data.templates
    fontOptions.value = data.fontOptions
    hasWorkspaceAccess.value = true
    const firstTemplate = data.templates.find((template) => template.source === 'custom') ?? data.templates[0]
    if (firstTemplate) await loadTemplate(firstTemplate.id)
    selectedTemplateId.value = firstTemplate?.id ?? null
  } catch (error: any) {
    hasWorkspaceAccess.value = false
    errorMessage.value = error?.statusMessage || error?.message || 'Template editor is unavailable'
  } finally {
    pending.value = false
  }
}

async function loadTemplate(id: string) {
  const data = await $fetch<{ template: CvTemplateFull }>(`/api/cv/templates/${id}`)
  currentTemplate.value = data.template
  selectedCvFont.value = getSelectedFont(data.template)
  setEditorDocumentContent(data.template.skeleton)
  editor.value?.setEditable(data.template.source === 'custom')
}

async function createTemplate() {
  const cloneFromId = currentTemplate.value?.id ?? templates.value[0]?.id
  errorMessage.value = ''
  try {
    const data = await $fetch<{ template: Omit<CvTemplateFull, 'source'> }>('/api/cv/templates', {
      method: 'POST',
      body: { cloneFromId },
    })
    const template: CvTemplateFull = { ...data.template, source: 'custom' }
    templates.value.push(template)
    currentTemplate.value = template
    selectedCvFont.value = getSelectedFont(template)
    setEditorDocumentContent(template.skeleton)
    editor.value?.setEditable(true)
    selectedTemplateId.value = template.id
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Template creation failed'
  }
}

async function deleteCurrentTemplate() {
  if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
  if (!window.confirm(`Delete template "${currentTemplate.value.name}"?`)) return
  const templateId = currentTemplate.value.id
  errorMessage.value = ''
  try {
    await $fetch(`/api/cv/templates/${templateId}`, { method: 'DELETE' })
    templates.value = templates.value.filter((template) => template.id !== templateId)
    const nextTemplate = templates.value[0]
    currentTemplate.value = null
    setEditorDocumentContent({ type: 'doc', content: [] })
    selectedTemplateId.value = nextTemplate?.id ?? null
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Delete failed'
  }
}

function setEditorDocumentContent(content: Record<string, any>) {
  if (!editor.value) return
  applyingRemoteContent = true
  try {
    editor.value.commands.setContent(content, { emitUpdate: false })
    editorSelectionVersion.value += 1
  } finally {
    queueMicrotask(() => {
      applyingRemoteContent = false
    })
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveTemplate()
  }, 700)
}

async function saveTemplate() {
  if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
  if (savePromise) return savePromise
  saving.value = true
  const templateToSave = JSON.parse(JSON.stringify(currentTemplate.value)) as CvTemplateFull
  savePromise = (async () => {
    errorMessage.value = ''
    try {
      const data = await $fetch<{ template: Omit<CvTemplateFull, 'source'> }>(`/api/cv/templates/${templateToSave.id}`, {
        method: 'PATCH',
        body: {
          name: templateToSave.name,
          theme: templateToSave.theme,
          page: templateToSave.page,
          skeleton: templateToSave.skeleton,
        },
      })
      const template: CvTemplateFull = { ...data.template, source: 'custom' }
      if (currentTemplate.value?.id === template.id) currentTemplate.value = { ...template, skeleton: currentTemplate.value.skeleton }
      templates.value = templates.value.map((entry) =>
        entry.id === template.id
          ? { id: template.id, name: template.name, layout: template.layout, source: 'custom', theme: template.theme, page: template.page }
          : entry,
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

function insertSlot(kind: CvSlotKind) {
  if (!isEditableTemplate.value) return
  const suggestion = kind === 'bullets' ? 'job1-bullets' : 'intro'
  const name = window.prompt('Slot name (used by the CV editor to assign text blocks)', suggestion)
  if (!name?.trim()) return
  editor.value?.chain().focus().insertContent({
    type: 'textBlockSlot',
    attrs: { name: name.trim().slice(0, 80), kind },
  }).run()
}

async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  uploading.value = true
  errorMessage.value = ''
  const form = new FormData()
  for (const file of input.files) form.append('files', file)
  try {
    await $fetch('/api/cv/uploads', { method: 'POST', body: form })
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Upload failed'
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function uploadImageFile(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be inserted')

  const form = new FormData()
  form.append('files', file)

  const result = await $fetch<{
    files: Array<{ id: number; url: string; originalName: string; contentType: string; sizeBytes: number }>
  }>('/api/cv/uploads', {
    method: 'POST',
    body: form,
  })

  const uploaded = result.files[0]
  if (!uploaded?.url) throw new Error('Image upload failed')
  return uploaded
}

async function insertImageFiles(files: File[], position?: number) {
  if (!editor.value || !isEditableTemplate.value || !files.length) return
  uploading.value = true
  errorMessage.value = ''

  try {
    for (const file of files) {
      const uploaded = await uploadImageFile(file)
      const imageNode = {
        type: 'image',
        attrs: {
          src: uploaded.url,
          alt: uploaded.originalName,
          title: uploaded.originalName,
          width: 180,
        },
      }

      if (typeof position === 'number') {
        editor.value.chain().focus().insertContentAt(position, imageNode).run()
        position += 1
      } else {
        editor.value.chain().focus().setImage(imageNode.attrs).run()
      }
    }
  } catch (error: any) {
    errorMessage.value = error?.statusMessage || error?.message || 'Image upload failed'
  } finally {
    uploading.value = false
  }
}

function imageFilesFromList(fileList?: FileList | null) {
  return Array.from(fileList ?? []).filter((file) => file.type.startsWith('image/'))
}

function openImagePicker() {
  imageInput.value?.click()
}

async function insertPickedImages(event: Event) {
  const input = event.target as HTMLInputElement
  await insertImageFiles(imageFilesFromList(input.files))
  input.value = ''
}

function updateCvFont() {
  if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
  if (!selectedCvFont.value) return
  currentTemplate.value.theme = {
    ...currentTemplate.value.theme,
    fonts: {
      heading: selectedCvFont.value,
      body: selectedCvFont.value,
      mono: selectedCvFont.value,
    },
  }
  scheduleSave()
}

function updatePageMargin(side: 'top' | 'right' | 'bottom' | 'left', value: Event) {
  if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
  const input = value.target as HTMLInputElement
  const margin = Number(input.value)
  if (!Number.isFinite(margin)) return
  currentTemplate.value.page = {
    ...currentTemplate.value.page,
    margin: {
      ...currentTemplate.value.page.margin,
      [side]: Math.min(50, Math.max(0, margin)),
    },
  }
  scheduleSave()
}

function setPageMargins(preset: 'base' | 'moderate' | 'low') {
  if (!currentTemplate.value || currentTemplate.value.source !== 'custom') return
  const baseTemplate = templates.value.find((template) =>
    template.source === 'builtin' && template.layout === currentTemplate.value?.layout)
  const margin = preset === 'base'
    ? baseTemplate?.page.margin ?? { top: 12, right: 12, bottom: 12, left: 12 }
    : preset === 'low'
      ? { top: 3, right: 3, bottom: 3, left: 3 }
      : { top: 12, right: 12, bottom: 12, left: 12 }

  currentTemplate.value.page = {
    ...currentTemplate.value.page,
    margin: { ...margin },
  }
  scheduleSave()
}

function runEditorCommand(command: () => boolean) {
  command()
  editor.value?.commands.focus()
}

function selectedTableNode(editorInstance: NonNullable<typeof editor.value> | null | undefined) {
  if (!editorInstance) return null
  const { $from } = editorInstance.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'table') {
      return { node, pos: $from.before(depth) }
    }
  }
  return null
}

function toggleSelectedTableBorders() {
  runEditorCommand(() => {
    if (!editor.value) return false
    const table = selectedTableNode(editor.value)
    if (!table) return false
    const transaction = editor.value.state.tr.setNodeMarkup(table.pos, undefined, {
      ...table.node.attrs,
      borderless: table.node.attrs.borderless !== true,
    })
    editor.value.view.dispatch(transaction)
    return true
  })
}

function setEditorAlignment(align: CvTextAlign) {
  runEditorCommand(() => {
    if (!editor.value) return false
    if (editor.value.isActive('image')) {
      return editor.value.chain().focus().updateAttributes('image', { textAlign: align }).run()
    }
    return editor.value.chain().focus().setTextAlign(align).run()
  })
}

function toggleImageGrayscale() {
  runEditorCommand(() => {
    if (!editor.value?.isActive('image')) return false
    return editor.value
      .chain()
      .focus()
      .updateAttributes('image', { grayscale: !selectedImageGrayscale.value })
      .run()
  })
}

function setSelectionLink() {
  if (!editor.value) return
  openLinkPrompt(editor.value)
}

function unsetSelectionLink() {
  runEditorCommand(() => editor.value?.chain().focus().extendMarkRange('link').unsetLink().run() ?? false)
}

function updateSelectionFontSize(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  runEditorCommand(() => value
    ? editor.value?.chain().focus().setFontSize(value).run() ?? false
    : editor.value?.chain().focus().unsetFontSize().run() ?? false)
}

function insertTabSpacer() {
  runEditorCommand(() => editor.value?.chain().focus().insertContent('\t').run() ?? false)
}

function togglePreviewMidline() {
  showPreviewMidline.value = !showPreviewMidline.value
}

function togglePreviewThirds() {
  showPreviewThirds.value = !showPreviewThirds.value
}

function getSelectedFont(template: CvTemplateSummary) {
  const font = template.theme?.fonts?.body
  return typeof font === 'string' && fontOptions.value.includes(font) ? font : ''
}

function formatSavedAt(date: Date | null) {
  return date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not saved yet'
}

function openLinkPrompt(targetEditor: NonNullable<typeof editor.value>) {
  const currentHref = targetEditor.getAttributes('link')?.href
  const value = window.prompt('Link URL', typeof currentHref === 'string' ? currentHref : 'https://')
  if (value === null) return

  const href = normalizeLinkHref(value)
  if (!href) {
    if (!value.trim()) {
      targetEditor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    errorMessage.value = 'Link URL must start with http(s), mailto, or tel'
    return
  }

  targetEditor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

function normalizeLinkHref(value: string) {
  const href = value.trim()
  if (!href) return ''
  if (isAllowedCvLink(href, 'https')) return href
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(href)) return `https://${href}`
  return ''
}

function isAllowedCvLink(value: string, defaultProtocol = 'https') {
  try {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `${defaultProtocol}://${value}`
    const parsed = new URL(href)
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function normalizeCvTextAlign(value: unknown): CvTextAlign | null {
  return value === 'left' || value === 'center' || value === 'right' ? value : null
}

function isImageGrayscale(value: unknown) {
  return value === true || value === 'true'
}

function imageAlignStyle(align: CvTextAlign) {
  if (align === 'center') return 'margin-left: auto; margin-right: auto'
  if (align === 'right') return 'margin-left: auto; margin-right: 0'
  return 'margin-left: 0; margin-right: auto'
}

function applyImageElementAttributes(el: HTMLImageElement, attrs: Record<string, unknown>) {
  const mergedAttributes = mergeAttributes(attrs)
  Object.entries(mergedAttributes).forEach(([key, value]) => {
    if (value == null || key === 'width' || key === 'height' || key === 'textAlign' || key === 'grayscale') return
    el.setAttribute(key, String(value))
  })
  applyImageNodeAttributes(el, attrs)
}

function applyImageNodeAttributes(el: HTMLImageElement, attrs: Record<string, unknown>) {
  if (typeof attrs.src === 'string') el.src = attrs.src
  for (const key of ['alt', 'title'] as const) {
    const value = attrs[key]
    if (typeof value === 'string') el.setAttribute(key, value)
    else el.removeAttribute(key)
  }

  const align = normalizeCvTextAlign(attrs.textAlign)
  if (align) el.dataset.align = align
  else delete el.dataset.align

  if (isImageGrayscale(attrs.grayscale)) {
    el.dataset.grayscale = 'true'
    el.style.filter = 'grayscale(1)'
  } else {
    delete el.dataset.grayscale
    el.style.filter = ''
  }

  const width = Number(attrs.width)
  const height = Number(attrs.height)
  if (Number.isFinite(width) && width > 0) {
    const roundedWidth = Math.round(width)
    el.style.width = `${roundedWidth}px`
    el.style.height = `${imageAspectHeight(el, roundedWidth, height)}px`
  } else if (Number.isFinite(height) && height > 0) {
    el.style.height = `${Math.round(height)}px`
  } else {
    el.style.height = ''
  }
}

function commitImageResize(
  editorInstance: TiptapEditor,
  getPos: () => number | undefined,
  nodeName: string,
  el: HTMLImageElement,
  width: number,
  height: number,
) {
  const pos = getPos()
  if (typeof pos !== 'number') return false

  const node = editorInstance.state.doc.nodeAt(pos)
  if (!node || node.type.name !== nodeName) return false

  const nextWidth = Math.max(1, Math.round(width))
  const nextHeight = imageAspectHeight(el, nextWidth, height)
  const transaction = editorInstance.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    width: nextWidth,
    height: nextHeight,
  })

  editorInstance.view.dispatch(transaction)
  applyImageNodeAttributes(el, { ...node.attrs, width: nextWidth, height: nextHeight })
  return true
}

function imageAspectHeight(el: HTMLImageElement, width: number, fallbackHeight: unknown) {
  const roundedWidth = Math.max(1, Math.round(width))
  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
    return Math.max(1, Math.round(roundedWidth * (el.naturalHeight / el.naturalWidth)))
  }

  const height = Number(fallbackHeight)
  return Number.isFinite(height) && height > 0 ? Math.round(height) : roundedWidth
}

function applyImageContainerAlignment(container: HTMLElement, value: unknown) {
  const align = normalizeCvTextAlign(value)
  if (align) container.dataset.align = align
  else delete container.dataset.align

  container.style.justifyContent = align === 'center'
    ? 'center'
    : align === 'right'
      ? 'flex-end'
      : 'flex-start'
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
          <h1 class="mt-1 font-mono text-[22px] font-700 uppercase tracking-0 text-ink">Template Editor</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span class="border border-grid-line px-3 py-2 text-ink-faint">{{ saving ? 'Saving' : `Saved ${formatSavedAt(savedAt)}` }}</span>
          <NuxtLink class="border border-grid-line px-3 py-2 hover:border-ink" to="/cv-editor">
            CV Editor
          </NuxtLink>
          <button class="border border-ink px-3 py-2 hover:bg-ink hover:text-surface" type="button" @click="createTemplate">
            New
          </button>
          <button
            class="border border-ink px-3 py-2 hover:bg-ink hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!isEditableTemplate"
            @click="saveTemplate"
          >
            Save
          </button>
          <button
            class="border border-accent px-3 py-2 text-accent hover:bg-accent hover:text-surface disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!isEditableTemplate"
            @click="deleteCurrentTemplate"
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
        <p class="text-[15px] text-ink-light">Login is required before templates can be created or edited.</p>
        <NuxtLink class="mt-5 inline-block border border-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-ink hover:text-surface" to="/login">
          Login
        </NuxtLink>
      </div>
    </div>

    <div v-else-if="!hasWorkspaceAccess" class="w-full px-5 py-8 lg:px-8">
      <div class="panel reg-marks max-w-xl p-6">
        <div class="panel-header">Restricted</div>
        <p class="text-[15px] text-ink-light">{{ errorMessage || 'The template editor is currently restricted by the rollout switch.' }}</p>
      </div>
    </div>

    <div v-else class="grid w-full gap-5 px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)_minmax(360px,34vw)] lg:px-8">
      <aside class="panel reg-marks h-fit p-4">
        <div class="panel-header">Templates</div>
        <div class="space-y-2">
          <button
            v-for="template in templates"
            :key="template.id"
            type="button"
            class="w-full border px-3 py-3 text-left text-[13px]"
            :class="template.id === selectedTemplateId ? 'border-ink bg-surface-warm' : 'border-grid-line hover:border-ink'"
            @click="selectedTemplateId = template.id"
          >
            <span class="block font-600 text-ink">{{ template.name }}</span>
            <span class="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {{ template.source === 'builtin' ? 'Built-in · read-only' : 'Custom' }} · {{ template.layout }}
            </span>
          </button>
        </div>

        <div class="mt-6 border-t border-grid-line pt-4">
          <div class="panel-header">Font</div>
          <select
            v-model="selectedCvFont"
            class="mb-4 w-full border border-grid-line bg-surface px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] outline-none focus:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!isEditableTemplate"
            @change="updateCvFont"
          >
            <option value="">Template font</option>
            <option v-for="font in fontOptions" :key="font" :value="font">
              {{ font }}
            </option>
          </select>

          <div class="panel-header">Seitenrand</div>
          <div class="mb-4 grid grid-cols-3 gap-2">
            <button class="border border-grid-line px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] hover:border-ink disabled:cursor-not-allowed disabled:opacity-40" type="button" :disabled="!isEditableTemplate" @click="setPageMargins('base')">
              Base
            </button>
            <button class="border border-grid-line px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] hover:border-ink disabled:cursor-not-allowed disabled:opacity-40" type="button" :disabled="!isEditableTemplate" @click="setPageMargins('moderate')">
              Moderate
            </button>
            <button class="border border-grid-line px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] hover:border-ink disabled:cursor-not-allowed disabled:opacity-40" type="button" :disabled="!isEditableTemplate" @click="setPageMargins('low')">
              Low
            </button>
          </div>
          <div class="mb-4 grid grid-cols-2 gap-2">
            <label
              v-for="side in ['top', 'right', 'bottom', 'left']"
              :key="side"
              class="block border border-grid-line px-3 py-2"
            >
              <span class="mb-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{{ side }} mm</span>
              <input
                :value="currentTemplate?.page.margin[side as 'top' | 'right' | 'bottom' | 'left']"
                class="w-full bg-transparent font-mono text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-40"
                type="number"
                min="0"
                max="50"
                step="0.5"
                :disabled="!isEditableTemplate"
                @input="updatePageMargin(side as 'top' | 'right' | 'bottom' | 'left', $event)"
              >
            </label>
          </div>

          <div class="panel-header">Private Uploads</div>
          <label class="block cursor-pointer border border-ink px-3 py-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-ink hover:text-surface">
            {{ uploading ? 'Uploading' : 'Upload' }}
            <input class="hidden" type="file" multiple @change="uploadFiles">
          </label>
        </div>
      </aside>

      <section v-if="currentTemplate" class="panel reg-marks-full min-w-0 p-4" :style="cvFontStyle">
        <div class="mb-4 flex flex-col gap-3 border-b border-grid-line pb-4 lg:flex-row lg:items-center lg:justify-between">
          <input
            v-model="currentTemplate.name"
            class="w-full border border-grid-line bg-surface px-3 py-2 font-mono text-[18px] font-700 uppercase outline-none focus:border-ink disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!isEditableTemplate"
            @input="scheduleSave"
          >
          <div v-if="!isEditableTemplate" class="shrink-0 border border-grid-line px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
            Built-in template · use New to clone an editable copy
          </div>
        </div>

        <fieldset class="cv-toolbar-fieldset mb-3 flex flex-wrap gap-2 border-b border-grid-line pb-3" :disabled="!isEditableTemplate">
          <button
            class="border border-accent px-3 py-2 font-mono text-[11px] uppercase text-accent hover:bg-accent hover:text-surface"
            type="button"
            title="Insert a text slot the CV editor can fill with one or more text blocks"
            @click="insertSlot('text')"
          >
            + Slot
          </button>
          <button
            class="border border-accent px-3 py-2 font-mono text-[11px] uppercase text-accent hover:bg-accent hover:text-surface"
            type="button"
            title="Insert a bullet slot: assigned text blocks render as one bullet list"
            @click="insertSlot('bullets')"
          >
            + Bullet Slot
          </button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] font-700 hover:border-ink" type="button" @click="editor?.chain().focus().toggleBold().run()">B</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] italic hover:border-ink" type="button" @click="editor?.chain().focus().toggleItalic().run()">I</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">H2</button>
          <button
            class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink"
            type="button"
            :class="selectedLinkHref ? 'border-ink bg-surface-warm' : ''"
            @click="setSelectionLink"
          >
            Link
          </button>
          <button
            class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="!selectedLinkHref"
            @click="unsetSelectionLink"
          >
            Unlink
          </button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[13px] uppercase hover:border-ink" type="button" @click="editor?.chain().focus().toggleBulletList().run()">Bullets</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[13px] uppercase hover:border-ink" type="button" @click="editor?.chain().focus().toggleOrderedList().run()">Numbers</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="insertTabSpacer">Tab</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="setEditorAlignment('left')">Left</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="setEditorAlignment('center')">Center</button>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="setEditorAlignment('right')">Right</button>
          <select
            :value="selectedTextFontSize"
            class="border border-grid-line bg-surface px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] outline-none hover:border-ink focus:border-ink"
            @change="updateSelectionFontSize"
          >
            <option value="">Template size</option>
            <option v-for="size in fontSizeOptions" :key="size" :value="size">
              {{ size }}
            </option>
          </select>
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="openImagePicker">Image</button>
          <button
            class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :class="selectedImageGrayscale ? 'border-ink bg-surface-warm' : ''"
            :disabled="!isImageActive"
            @click="toggleImageGrayscale"
          >
            Gray
          </button>
          <input ref="imageInput" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="insertPickedImages">
          <button class="border border-grid-line px-3 py-2 font-mono text-[11px] uppercase hover:border-ink" type="button" @click="editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()">Table</button>
        </fieldset>

        <fieldset class="cv-toolbar-fieldset mb-3 flex flex-wrap items-center gap-2 border-b border-grid-line pb-3" :disabled="!isEditableTemplate">
          <span class="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Table</span>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().addColumnBefore().run() ?? false)">
            Col before
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().addColumnAfter().run() ?? false)">
            Col after
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().deleteColumn().run() ?? false)">
            Del col
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().addRowBefore().run() ?? false)">
            Row before
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().addRowAfter().run() ?? false)">
            Row after
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().deleteRow().run() ?? false)">
            Del row
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().mergeCells().run() ?? false)">
            Merge
          </button>
          <button class="table-tool-button" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().splitCell().run() ?? false)">
            Split
          </button>
          <button
            class="table-tool-button"
            type="button"
            :class="{ 'table-tool-button--active': selectedTableBorderless }"
            :disabled="!isTableActive"
            @click="toggleSelectedTableBorders"
          >
            No borders
          </button>
          <button class="table-tool-button table-tool-button--danger" type="button" :disabled="!isTableActive" @click="runEditorCommand(() => editor?.chain().focus().deleteTable().run() ?? false)">
            Del table
          </button>
        </fieldset>

        <ClientOnly>
          <div :class="currentTemplate?.layout === 'compact-three-column' ? 'cv-editor-shell--compact-grid' : ''">
            <EditorContent :editor="editor" />
          </div>
        </ClientOnly>
      </section>

      <aside class="min-w-0">
        <div class="sticky top-5">
          <div class="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            <span>Preview</span>
            <div class="flex items-center gap-2">
              <button
                class="preview-guide-button"
                :class="{ 'preview-guide-button--active': showPreviewMidline }"
                type="button"
                :aria-pressed="showPreviewMidline"
                @click="togglePreviewMidline"
              >
                Midline
              </button>
              <button
                class="preview-guide-button"
                :class="{ 'preview-guide-button--active': showPreviewThirds }"
                type="button"
                :aria-pressed="showPreviewThirds"
                @click="togglePreviewThirds"
              >
                Thirds
              </button>
              <span>A4</span>
            </div>
          </div>
          <div class="cv-preview-frame">
            <div class="cv-preview bg-white text-[#1a1a2e]" :class="previewClass" :style="previewPageStyle" v-html="previewHtml" />
            <div v-if="showPreviewMidline" class="cv-preview-guide cv-preview-guide--midline" aria-hidden="true" />
            <div v-if="showPreviewThirds" class="cv-preview-guide cv-preview-guide--thirds" aria-hidden="true" />
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
.cv-toolbar-fieldset {
  margin: 0;
  padding-inline: 0;
  border: 0;
  min-width: 0;
}

.cv-toolbar-fieldset:disabled button,
.cv-toolbar-fieldset:disabled select {
  cursor: not-allowed;
  opacity: 0.38;
}

:deep(.cv-editor-content) {
  min-height: 620px;
  outline: none;
  padding: 20px;
  background: #fff;
  border: 1px solid var(--color-grid-line);
  font-family: var(--cv-selected-font), var(--font-sans);
  font-size: 15px;
  line-height: 1.55;
}

:deep(.cv-editor-content h1),
:deep(.cv-editor-content h2),
:deep(.cv-editor-content h3) {
  font-family: var(--cv-selected-font), var(--font-sans);
  margin: 18px 0 8px;
}

:deep(.cv-editor-content p) {
  margin: 8px 0;
  white-space: pre-wrap;
}

:deep(.cv-editor-content .cv-slot-placeholder) {
  margin: 8px 0;
  border: 1.5px dashed var(--color-accent);
  background: var(--color-accent-dim, rgba(230, 57, 70, 0.06));
  padding: 8px 12px;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: grab;
}

:deep(.cv-editor-content .cv-slot-placeholder.ProseMirror-selectednode) {
  outline: 2px solid var(--color-accent);
}

:deep(.cv-editor-content ul),
:deep(.cv-editor-content ol) {
  margin: 8px 0 8px 22px;
  padding-left: 18px;
}

:deep(.cv-editor-content ul) {
  list-style-type: disc;
}

:deep(.cv-editor-content ol) {
  list-style-type: decimal;
}

:deep(.cv-editor-content ul ul) {
  list-style-type: circle;
}

:deep(.cv-editor-content ul ul ul) {
  list-style-type: square;
}

:deep(.cv-editor-content li > p) {
  margin: 3px 0;
}

:deep(.cv-editor-content li) {
  white-space: pre-wrap;
}

:deep(.cv-editor-content li::marker) {
  font-size: 1.35em;
}

:deep(.cv-editor-content img) {
  display: block;
  max-width: 100%;
  height: auto;
}

:deep(.cv-editor-content img[data-grayscale="true"]) {
  filter: grayscale(1);
}

:deep(.cv-editor-content [data-resize-container][data-node="image"]) {
  max-width: 100%;
  margin: 8px 0;
  position: relative;
}

:deep(.cv-editor-content [data-resize-container][data-node="image"][data-align="center"]) {
  justify-content: center;
}

:deep(.cv-editor-content [data-resize-container][data-node="image"][data-align="right"]) {
  justify-content: flex-end;
}

:deep(.cv-editor-content [data-resize-container][data-node="image"] [data-resize-wrapper]) {
  max-width: 100%;
  outline: 1px solid transparent;
}

:deep(.cv-editor-content [data-resize-container][data-node="image"]:hover [data-resize-wrapper]) {
  outline-color: var(--color-grid-line);
}

:deep(.cv-editor-content [data-resize-container][data-node="image"][data-resize-state="true"] [data-resize-wrapper]) {
  outline-color: var(--color-accent);
}

:deep(.cv-editor-content [data-resize-handle]) {
  z-index: 25;
  background: var(--color-accent);
  opacity: 0;
}

:deep(.cv-editor-content [data-resize-container][data-node="image"]:hover [data-resize-handle]),
:deep(.cv-editor-content [data-resize-container][data-node="image"][data-resize-state="true"] [data-resize-handle]) {
  opacity: 0.9;
}

:deep(.cv-editor-content .cv-image-remove-button) {
  position: absolute;
  top: -9px;
  right: -9px;
  z-index: 35;
  display: none;
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-accent);
  background: #fff;
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

:deep(.cv-editor-content .cv-image-remove-button:hover) {
  background: var(--color-accent);
  color: var(--color-surface);
}

:deep(.cv-editor-content [data-resize-container][data-node="image"]:hover .cv-image-remove-button),
:deep(.cv-editor-content [data-resize-container][data-node="image"].ProseMirror-selectednode .cv-image-remove-button),
:deep(.cv-editor-content [data-resize-container][data-node="image"][data-resize-state="true"] .cv-image-remove-button) {
  display: block;
}

:deep(.cv-editor-content [data-resize-handle="right"]) {
  width: 8px;
  cursor: ew-resize;
}

:deep(.cv-editor-content [data-resize-handle="bottom-right"]) {
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
}

:deep(.cv-editor-content table) {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 10px 0 18px;
  overflow: hidden;
}

:deep(.cv-editor-content .tableWrapper) {
  max-width: 100%;
  overflow-x: auto;
  padding: 2px 0;
}

:deep(.cv-editor-content td),
:deep(.cv-editor-content th) {
  min-width: 72px;
  border: 1px solid var(--color-grid-line);
  padding: 8px;
  position: relative;
  vertical-align: top;
}

:deep(.cv-editor-content table[data-borderless="true"] td),
:deep(.cv-editor-content table[data-borderless="true"] th) {
  border-color: transparent;
}

:deep(.cv-editor-content .column-resize-handle) {
  position: absolute;
  top: -1px;
  right: -4px;
  bottom: -1px;
  z-index: 20;
  width: 8px;
  background: var(--color-accent);
  opacity: 0.65;
  pointer-events: none;
}

:deep(.cv-editor-content.resize-cursor) {
  cursor: col-resize;
}

:deep(.cv-editor-content .selectedCell::after) {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: rgba(230, 57, 70, 0.13);
  box-shadow: inset 0 0 0 1px var(--color-accent);
  content: "";
  pointer-events: none;
}

.table-tool-button {
  border: 1px solid var(--color-grid-line);
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.table-tool-button:hover:not(:disabled) {
  border-color: var(--color-ink);
}

.table-tool-button--active {
  border-color: var(--color-ink);
  background: var(--color-surface-warm);
}

.table-tool-button:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.table-tool-button--danger {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.table-tool-button--danger:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-surface);
}

.cv-editor-shell--compact-grid :deep(.cv-editor-content) {
  font-family: var(--cv-selected-font), var(--font-sans);
  font-size: 14px;
  line-height: 1.35;
}

.cv-editor-shell--compact-grid :deep(.cv-editor-content h1) {
  margin: 0;
  text-align: center;
  font-family: var(--cv-selected-font), var(--font-sans);
  font-size: 24px;
  font-weight: 400;
  letter-spacing: 0.14em;
}

.cv-editor-shell--compact-grid :deep(.cv-editor-content h2) {
  margin: 13px 0 8px;
  border-bottom: 1px solid #000;
  font-family: var(--cv-selected-font), var(--font-sans);
  font-size: 15px;
  letter-spacing: 0.18em;
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

.preview-guide-button {
  border: 1px solid var(--color-grid-line);
  padding: 4px 7px;
  color: var(--color-ink-faint);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.preview-guide-button:hover,
.preview-guide-button--active {
  border-color: var(--color-ink);
  color: var(--color-ink);
}

.preview-guide-button--active {
  background: var(--color-surface-warm);
}

.cv-preview-guide {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.cv-preview-guide--midline {
  background: linear-gradient(
    to right,
    transparent calc(50% - 0.5px),
    rgba(255, 0, 0, 0.5) calc(50% - 0.5px),
    rgba(255, 0, 0, 0.5) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}

.cv-preview-guide--thirds {
  background-image:
    linear-gradient(
      to right,
      transparent calc(33.333% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(33.333% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(33.333% + 0.5px),
      transparent calc(33.333% + 0.5px),
      transparent calc(66.666% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(66.666% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(66.666% + 0.5px),
      transparent calc(66.666% + 0.5px)
    ),
    linear-gradient(
      to bottom,
      transparent calc(33.333% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(33.333% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(33.333% + 0.5px),
      transparent calc(33.333% + 0.5px),
      transparent calc(66.666% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(66.666% - 0.5px),
      rgba(255, 0, 0, 0.5) calc(66.666% + 0.5px),
      transparent calc(66.666% + 0.5px)
    );
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
