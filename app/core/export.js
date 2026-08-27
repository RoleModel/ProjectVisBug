import { getDoc } from './context'
import { serialize as serializeStyles, ID_ATTR } from './style-store'

/**
 * Turn the edited document into deliverable HTML + CSS.
 *
 * This is cheap only because of the style seam: edits already live in a real
 * stylesheet keyed by generated classes, so there's no inline-style soup to
 * untangle here — just strip the editor's own bookkeeping and hand back the
 * markup alongside the rules.
 */

// attributes the tools write onto the page purely to track state
const EDITOR_ATTRS = [
  ID_ATTR,
  'data-selected',
  'data-selected-hide',
  'data-label-id',
  'data-pseudo-select',
  'data-measuring',
  'data-outward',
  'visbug-drag-src',
  'visbug-drag-container',
  'contenteditable',
  'spellcheck',
  'draggable',
]

// editor UI that lives in the page but isn't part of the design
const EDITOR_NODES = [
  'vis-bug', 'hotkey-map', 'visbug-metatip', 'visbug-ally', 'visbug-label',
  'visbug-handles', 'visbug-handle', 'visbug-corners', 'visbug-grip',
  'visbug-gridlines', 'visbug-insertion', 'visbug-hover', 'visbug-distance',
  'visbug-overlay', 'visbug-boxmodel', '.visbug-metatip',
].join(',')

// inline properties the tools set for their own feedback (grab cursors,
// paint hints) rather than as design decisions
const EDITOR_INLINE_PROPS = ['cursor', 'will-change']

const clean = root => {
  root.querySelectorAll(EDITOR_NODES).forEach(node => node.remove())

  root.querySelectorAll('[style]').forEach(el => {
    EDITOR_INLINE_PROPS.forEach(prop => el.style.removeProperty(prop))
    if (!el.style.length) el.removeAttribute('style')
  })

  root.querySelectorAll(`[${ID_ATTR}]`).forEach(el => {
    // the generated class stays — it's what the exported CSS targets
    EDITOR_ATTRS.forEach(attr => el.removeAttribute(attr))
    if (el.getAttribute('style') === '') el.removeAttribute('style')
    if (el.getAttribute('class') === '') el.removeAttribute('class')
  })

  EDITOR_ATTRS.forEach(attr =>
    root.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr)))

  return root
}

/**
 * @param {object}  opts
 * @param {boolean} opts.inline  embed the CSS in a <style> tag (single file)
 * @param {string}  opts.href    stylesheet filename when not inlining
 * @returns {{ html: string, css: string }}
 */
export const exportDocument = ({ inline = true, href = 'design.css' } = {}) => {
  const doc  = getDoc()
  const css  = serializeStyles()
  const root = clean(doc.documentElement.cloneNode(true))

  const head = root.querySelector('head') || root

  if (css) {
    const node = doc.createElement(inline ? 'style' : 'link')

    inline
      ? node.textContent = `\n${css}\n`
      : Object.assign(node, { rel: 'stylesheet', href })

    head.appendChild(node)
  }

  return {
    css,
    html: `<!doctype html>\n${root.outerHTML}`,
  }
}

/** Just the markup for one subtree — what "copy element" should hand over. */
export const exportElement = el => {
  const clone = clean(el.cloneNode(true))
  return clone.outerHTML
}

export const copyToClipboard = async (opts) => {
  const { html } = exportDocument(opts)
  await navigator.clipboard.writeText(html)
  return html
}
