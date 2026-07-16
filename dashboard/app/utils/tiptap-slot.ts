import { Node, mergeAttributes } from '@tiptap/core'

export type CvSlotKind = 'text' | 'bullets'

export interface CvSlotDefinition {
  name: string
  kind: CvSlotKind
}

// Template slot placeholder. Templates keep these nodes in their skeleton;
// the CV editor replaces them with assigned text blocks (server-side, see
// materializeCvDocumentContent). Atom: the slot is one indivisible unit that
// can be selected, dragged, and deleted, but not edited inline.
export const TextBlockSlot = Node.create({
  name: 'textBlockSlot',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      name: {
        default: 'slot',
        parseHTML: (element) => element.getAttribute('data-cv-slot') || 'slot',
      },
      kind: {
        default: 'text',
        parseHTML: (element) => element.getAttribute('data-cv-slot-kind') === 'bullets' ? 'bullets' : 'text',
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-cv-slot]' }]
  },

  renderHTML({ node }) {
    const name = String(node.attrs.name ?? 'slot')
    const kind = node.attrs.kind === 'bullets' ? 'bullets' : 'text'
    return [
      'div',
      mergeAttributes({
        'data-cv-slot': name,
        'data-cv-slot-kind': kind,
        'class': 'cv-slot-placeholder',
      }),
      `⬚ ${name}${kind === 'bullets' ? ' · bullets' : ''}`,
    ]
  },
})

// Walk a TipTap doc (arbitrarily nested, slots can sit inside table cells)
// and list its slots in document order.
export function extractCvSlots(content: unknown): CvSlotDefinition[] {
  const slots: CvSlotDefinition[] = []
  const seen = new Set<string>()

  function visit(node: any) {
    if (!node || typeof node !== 'object') return
    if (node.type === 'textBlockSlot') {
      const name = typeof node.attrs?.name === 'string' ? node.attrs.name : 'slot'
      if (!seen.has(name)) {
        seen.add(name)
        slots.push({ name, kind: node.attrs?.kind === 'bullets' ? 'bullets' : 'text' })
      }
      return
    }
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }

  visit(content)
  return slots
}
