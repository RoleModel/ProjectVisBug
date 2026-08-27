import { getDoc, getWin } from './context'

/**
 * The one funnel for every *document* style edit.
 *
 * Features used to write `el.style[prop] = value`, which made two things
 * impossible: recording a before/after for undo, and exporting clean CSS.
 * Now every edit lands in an editor-owned stylesheet, keyed by a generated
 * class, and hands back a change record for app/core/history.js.
 *
 * Editor chrome (overlays, guides, drag ghosts) must keep using inline
 * styles — see isEditorChrome() below.
 */

const ID_ATTR      = 'data-vb-id'
const CLASS_PREFIX = 'vb-'

// `.vb-x.vb-x.vb-x` is specificity 0,3,0 — beats nearly every author rule
// without resorting to !important, which would be unexportable noise.
const SPECIFICITY_BOOST = 3

const state = {
  sheet:  null,
  rules:  new Map(),  // vb-id -> CSSStyleRule
  seq:    0,
}

const kebab = prop => prop
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/^(webkit|moz|ms|o)-/i, '-$1-')
  .toLowerCase()

export const isEditorChrome = el =>
  !el
  || !el.tagName
  || el.tagName.toLowerCase().startsWith('visbug-')
  || el.tagName.toLowerCase() === 'vis-bug'
  || el.tagName.toLowerCase() === 'hotkey-map'
  || el.classList?.contains('visbug-metatip')

const sheet = () => {
  if (state.sheet) return state.sheet

  const doc = getDoc()
  state.sheet = new (getWin().CSSStyleSheet)()

  // adopted last so we win ties against the page's own stylesheets
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, state.sheet]

  return state.sheet
}

const idFor = el => {
  let id = el.getAttribute(ID_ATTR)
  if (id) return id

  id = `${CLASS_PREFIX}${(state.seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

  el.setAttribute(ID_ATTR, id)
  el.classList.add(id)

  return id
}

const ruleFor = el => {
  const id = idFor(el)
  if (state.rules.has(id)) return state.rules.get(id)

  const selector = `.${id}`.repeat(SPECIFICITY_BOOST)
  const sheet_   = sheet()
  const index    = sheet_.insertRule(`${selector} {}`, sheet_.cssRules.length)
  const rule     = sheet_.cssRules[index]

  state.rules.set(id, rule)
  return rule
}

/** What *we* authored for this prop — '' when we've never set it. */
export const getAuthoredStyle = (el, prop) => {
  const id = el?.getAttribute?.(ID_ATTR)
  if (!id || !state.rules.has(id)) return ''
  return state.rules.get(id).style.getPropertyValue(kebab(prop))
}

/** Authored value if we have one, else what the browser actually resolved. */
export const getEffectiveStyle = (el, prop) =>
  getAuthoredStyle(el, prop)
  || el.style?.[prop]
  || getWin().getComputedStyle(el).getPropertyValue(kebab(prop))

/**
 * Set one property. Returns a change record, or null if nothing changed.
 * A null/'' value removes the declaration.
 */
export const setStyle = (el, prop, value) => {
  if (!el || isEditorChrome(el)) {
    // chrome keeps its inline styles; nothing to journal
    if (el) el.style[prop] = value
    return null
  }

  const rule   = ruleFor(el)
  const name   = kebab(prop)
  const before = rule.style.getPropertyValue(name)
  const after  = value == null ? '' : String(value)

  if (before === after) return null

  after === ''
    ? rule.style.removeProperty(name)
    : rule.style.setProperty(name, after)

  return { type: 'style', el, prop, before, after }
}

export const setStyles = (el, styles) =>
  Object.entries(styles)
    .map(([prop, value]) => setStyle(el, prop, value))
    .filter(Boolean)

/** Drop everything we've authored for an element (alt+delete "clear styles"). */
export const clearStyles = el => {
  const id = el?.getAttribute?.(ID_ATTR)
  if (!id || !state.rules.has(id)) return []

  const rule = state.rules.get(id)

  return [...rule.style]
    .map(name => setStyle(el, name, ''))
    .filter(Boolean)
}

/** Serialize for export — skips rules we emptied out along the way. */
export const serialize = ({ pretty = true } = {}) => {
  if (!state.sheet) return ''

  return [...state.sheet.cssRules]
    .filter(rule => rule.style?.length)
    .map(rule => {
      // cssText keeps shorthands collapsed (`padding: 30px` rather than four
      // longhands), which is what a human wants to read in an export
      const declarations = rule.style.cssText
        .split(/;\s*/)
        .filter(Boolean)

      return pretty
        ? `${rule.selectorText} {\n${declarations.map(d => `  ${d};`).join('\n')}\n}`
        : rule.cssText
    })
    .join('\n\n')
}

/** Test/teardown hook. */
export const reset = () => {
  if (state.sheet) {
    const doc = getDoc()
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(s => s !== state.sheet)
  }
  state.sheet = null
  state.rules.clear()
  state.seq = 0
}

export { ID_ATTR, CLASS_PREFIX }
