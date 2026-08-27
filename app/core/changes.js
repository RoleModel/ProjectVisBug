import { getWin } from './context'
import { getAuthoredStyles, CLASS_PREFIX, ID_ATTR } from './style-store'

/**
 * Remembers what a thing looked like *before* VisBug touched it, so an edit
 * can be reported as "was X, now Y" rather than just "Y".
 *
 * The history journal already records before/after per step, but a step is
 * not what you want to hand a developer — nudging padding forty times is
 * forty entries and one change. This tracks the original only, and the net
 * change is worked out at report time against what's authored right now.
 * Anything undone therefore drops out on its own.
 */

const tracked = new Map()   // Element -> { styles: {prop: original}, position, created }

const entryFor = el => {
  if (!tracked.has(el))
    tracked.set(el, { styles: {}, position: undefined, created: false })

  return tracked.get(el)
}

const kebab = prop => prop
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .toLowerCase()

/** Called before the first write to a property, to capture what was there. */
export const noteStyle = (el, prop) => {
  const entry = entryFor(el)
  if (prop in entry.styles) return

  entry.styles[prop] = getWin().getComputedStyle(el).getPropertyValue(kebab(prop))
}

/**
 * Called on an element's first structural change. `from` is null when the
 * node wasn't in the tree yet, which means VisBug created it.
 */
export const notePosition = (el, from) => {
  const entry = entryFor(el)
  if (entry.position !== undefined) return

  if (!from) {
    entry.created = true
    entry.position = null
    return
  }

  entry.position = {
    parent: from.parent,
    index:  [...from.parent.children].indexOf(el),
  }
}

export const forget = () => tracked.clear()

/* ------------------------------------------------------------ describing --- */

const TEST_ATTRS = [
  'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-e2e',
]

const IDENTIFYING_ATTRS = [
  'name', 'type', 'role', 'aria-label', 'alt', 'placeholder', 'title', 'href', 'src',
]

const isGeneratedClass = name =>
  name.startsWith(CLASS_PREFIX)

const stableClasses = el =>
  [...el.classList].filter(name => !isGeneratedClass(name))

const cssEscape = value =>
  getWin().CSS?.escape ? getWin().CSS.escape(value) : value

const isUnique = (selector, doc) => {
  try   { return doc.querySelectorAll(selector).length === 1 }
  catch { return false }
}

/** tag + classes, scoped to the nearest id'd ancestor if that makes it unique */
const readableSelector = (el, doc) => {
  const tag     = el.tagName.toLowerCase()
  const classes = stableClasses(el).map(c => `.${cssEscape(c)}`).join('')
  const own     = `${tag}${classes}`

  if (isUnique(own, doc)) return own

  let scope = el.parentElement
  while (scope && scope !== doc.body) {
    if (scope.id) {
      const scoped = `#${cssEscape(scope.id)} ${own}`
      if (isUnique(scoped, doc)) return scoped

      // still ambiguous — pin the position, but keep the container visible
      const nth = [...scope.children].indexOf(el) + 1
      const pinned = `#${cssEscape(scope.id)} > ${own}:nth-child(${nth})`
      if (isUnique(pinned, doc)) return pinned
    }
    scope = scope.parentElement
  }

  const parent = el.parentElement
  if (parent && parent !== doc.body) {
    const nth = [...parent.children].indexOf(el) + 1
    const withNth = `${own}:nth-child(${nth})`
    if (isUnique(withNth, doc)) return withNth
  }

  return null
}

/** readable ancestor trail — says which component owns this element */
const ancestorTrail = el => {
  const parts = []
  let node = el.parentElement

  while (node && node.tagName !== 'BODY' && parts.length < 4) {
    const tag = node.tagName.toLowerCase()
    const id = node.id ? `#${node.id}` : ''
    const classes = stableClasses(node).slice(0, 3).map(c => `.${c}`).join('')

    parts.unshift(`${tag}${id}${classes}`)
    node = node.parentElement
  }

  return parts.join(' > ')
}

/** always-unique structural path, the fallback when nothing else identifies it */
const uniquePath = el => {
  const steps = []
  let node = el

  while (node && node.nodeType === 1 && node.tagName !== 'BODY') {
    const tag = node.tagName.toLowerCase()
    const index = [...node.parentNode.children].indexOf(node) + 1
    steps.unshift(`${tag}:nth-child(${index})`)
    node = node.parentElement
  }

  return `body > ${steps.join(' > ')}`
}

// bookkeeping the tools write onto elements, invisible in the source
const EDITOR_ATTRS = [
  ID_ATTR, 'data-selected', 'data-label-id', 'data-selected-hide',
  'data-pseudo-select', 'data-measuring', 'data-outward', 'draggable',
  'visbug-drag-src', 'visbug-drag-container', 'contenteditable', 'spellcheck',
]

// inline properties the tools set for their own feedback, not as design
const EDITOR_INLINE_PROPS = ['cursor', 'will-change', 'transition', 'opacity']

/**
 * The opening tag as the source probably writes it — usually the most
 * greppable anchor there is, so it has to be free of editor residue.
 */
const openingTag = el => {
  const clone = el.cloneNode(false)

  EDITOR_ATTRS.forEach(attr => clone.removeAttribute(attr))
  ;[...clone.classList]
    .filter(isGeneratedClass)
    .forEach(name => clone.classList.remove(name))

  if (clone.hasAttribute('style')) {
    EDITOR_INLINE_PROPS.forEach(prop => clone.style.removeProperty(prop))
    if (!clone.style.length) clone.removeAttribute('style')
  }

  if (clone.getAttribute('class') === '') clone.removeAttribute('class')

  const html = clone.outerHTML
  const end  = html.indexOf('>')

  return end === -1 ? html : html.slice(0, end + 1)
}

const textOf = el => {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

/** Several independent ways to point at one element, best first. */
export const describeElement = el => {
  const doc = el.ownerDocument

  const testAttr = TEST_ATTRS
    .map(attr => el.hasAttribute(attr) ? `[${attr}="${el.getAttribute(attr)}"]` : null)
    .find(Boolean)

  const attributes = IDENTIFYING_ATTRS
    .filter(attr => el.hasAttribute(attr))
    .reduce((o, attr) => (o[attr] = el.getAttribute(attr), o), {})

  return {
    tag:       el.tagName.toLowerCase(),
    id:        el.id ? `#${cssEscape(el.id)}` : null,
    testAttr,
    selector:  readableSelector(el, doc),
    path:      uniquePath(el),
    within:    ancestorTrail(el),
    markup:    openingTag(el),
    text:      textOf(el),
    classes:   stableClasses(el),
    attributes,
  }
}

/* ------------------------------------------------------------ collecting --- */

const positionNow = el => ({
  parent: el.parentElement,
  index:  el.parentElement ? [...el.parentElement.children].indexOf(el) : -1,
})

/**
 * The net effect of the session: one entry per element that still differs
 * from how it started.
 */
export const collectChanges = () => {
  const changes = []

  tracked.forEach((entry, el) => {
    const removed = !el.isConnected

    const styles = removed ? [] : Object.entries(getAuthoredStyles(el))
      .map(([prop, after]) => {
        // originals were captured under the name the feature used
        const before = prop in entry.styles
          ? entry.styles[prop]
          : entry.styles[Object.keys(entry.styles).find(k => kebab(k) === prop)]

        return { prop, before: before ?? '(not set)', after }
      })
      .filter(({ before, after }) => before !== after)

    let moved = null

    if (!removed && entry.position) {
      const now = positionNow(el)
      if (now.parent !== entry.position.parent || now.index !== entry.position.index)
        moved = { from: entry.position, to: now }
    }

    if (!styles.length && !moved && !removed && !entry.created) return

    changes.push({
      el,
      describe: describeElement(el),
      styles,
      moved,
      removed,
      created: entry.created,
    })
  })

  return changes
}

export const hasChanges = () => collectChanges().length > 0
