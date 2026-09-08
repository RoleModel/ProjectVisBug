import { getDoc, getWin } from './context'
import { serialize as serializeStyles, isEditorSheet, ID_ATTR } from './style-store'

/**
 * Turn the edited page into two deliverable files: one HTML document and
 * one stylesheet holding every rule the page uses.
 *
 * The page's own CSS arrives spread across <style> blocks, same-origin
 * <link>s, cross-origin <link>s (whose cssRules throw), @imports and
 * adopted stylesheets. All of it gets read, url()s rewritten to absolute so
 * images and fonts still resolve, and concatenated — with the editor's own
 * rules last so they win.
 */

const STYLESHEET_NAME = 'design.css'

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

// URL-bearing attributes worth absolutising so the saved page still resolves
const URL_ATTRS = ['src', 'href', 'poster', 'data', 'action']

/* ------------------------------------------------------------------ css --- */

const absolutiseUrls = (css, base) =>
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, quote, url) => {
    if (/^(data:|blob:|#|https?:|\/\/)/i.test(url.trim())) return whole
    try   { return `url("${new URL(url.trim(), base).href}")` }
    catch { return whole }
  })

const wrapInMedia = (css, media) =>
  media && media !== 'all' && media !== ''
    ? `@media ${media} {\n${css}\n}`
    : css

/** Read a sheet's rules, recursing into @import. Throws on cross-origin. */
const rulesToText = (sheet, base) =>
  [...sheet.cssRules].map(rule => {
    if (rule instanceof getWin().CSSImportRule && rule.styleSheet)
      return readSheet(rule.styleSheet, rule.href ? new URL(rule.href, base).href : base)

    return absolutiseUrls(rule.cssText, base)
  }).join('\n')

const readSheet = (sheet, base) => {
  try   { return rulesToText(sheet, base) }
  catch { return null }   // cross-origin — caller falls back to fetch
}

const fetchSheet = async href => {
  try {
    const res = await fetch(href, { credentials: 'omit' })
    if (!res.ok) throw new Error(res.status)
    return absolutiseUrls(await res.text(), href)
  }
  catch (e) {
    return `/* VisBug: could not read ${href} — ${e.message} */`
  }
}

/**
 * Every stylesheet affecting the page, flattened in cascade order.
 * Async because cross-origin sheets have to be fetched.
 */
export const collectCSS = async () => {
  const doc    = getDoc()
  const chunks = []

  for (const sheet of doc.styleSheets) {
    // skip the editor's own chrome and anything disabled
    if (sheet.ownerNode?.closest?.('vis-bug') || sheet.disabled) continue

    const base = sheet.href || doc.baseURI
    const text = readSheet(sheet, base) ?? (sheet.href ? await fetchSheet(sheet.href) : '')

    if (text.trim())
      chunks.push(wrapInMedia(text, sheet.media?.mediaText))
  }

  // constructed sheets — ours is skipped here and appended last so it wins
  for (const sheet of doc.adoptedStyleSheets) {
    if (isEditorSheet(sheet)) continue

    const text = readSheet(sheet, doc.baseURI)
    if (text?.trim()) chunks.push(text)
  }

  const editor = serializeStyles()

  if (editor.trim())
    chunks.push(`/* VisBug edits */\n${editor}`)

  return chunks.join('\n\n')
}

/* ----------------------------------------------------------------- html --- */

const absolutiseAttrs = root => {
  URL_ATTRS.forEach(attr =>
    root.querySelectorAll(`[${attr}]`).forEach(el => {
      const raw = el.getAttribute(attr)
      if (!raw || /^(data:|blob:|#|mailto:|tel:|javascript:)/i.test(raw)) return

      // reading the IDL property gives the browser-resolved absolute URL
      const resolved = typeof el[attr] === 'string' ? el[attr] : null
      if (resolved) el.setAttribute(attr, resolved)
    }))

  root.querySelectorAll('[srcset]').forEach(el =>
    el.setAttribute('srcset', el.getAttribute('srcset')
      .split(',')
      .map(part => {
        const [url, ...rest] = part.trim().split(/\s+/)
        if (!url || /^(data:|blob:)/i.test(url)) return part.trim()
        try   { return [new URL(url, getDoc().baseURI).href, ...rest].join(' ') }
        catch { return part.trim() }
      })
      .join(', ')))
}

const clean = root => {
  root.querySelectorAll(EDITOR_NODES).forEach(node => node.remove())

  root.querySelectorAll('[style]').forEach(el => {
    EDITOR_INLINE_PROPS.forEach(prop => el.style.removeProperty(prop))
    if (!el.style.length) el.removeAttribute('style')
  })

  EDITOR_ATTRS.forEach(attr =>
    root.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr)))

  root.querySelectorAll(`[${ID_ATTR}]`).forEach(el => {
    // the generated class stays — it's what the exported CSS targets
    if (el.getAttribute('class') === '') el.removeAttribute('class')
  })

  return root
}

/**
 * The whole page as one HTML file plus one stylesheet.
 *
 * @param {object}  opts
 * @param {boolean} opts.inline  embed the CSS in a <style> tag instead of
 *                               linking it, giving a single self-contained file
 * @returns {Promise<{ html: string, css: string, filenames: object }>}
 */
export const exportBundle = async ({ inline = false, name = 'design', scripts = false } = {}) => {
  const doc  = getDoc()
  const css  = await collectCSS()
  const root = doc.documentElement.cloneNode(true)

  clean(root)
  absolutiseAttrs(root)

  // every original stylesheet is now folded into `css`
  root.querySelectorAll('style, link[rel~="stylesheet" i]').forEach(el => el.remove())

  // An export is a snapshot of how the page looks *now*. Left in place, the
  // page's scripts re-run on open and rebuild the DOM out from under it —
  // and VisBug's own bundle would re-inject the toolbar.
  if (!scripts)
    root.querySelectorAll('script').forEach(el => el.remove())

  const head = root.querySelector('head') || root

  if (css.trim()) {
    const node = doc.createElement(inline ? 'style' : 'link')

    inline
      ? node.textContent = `\n${css}\n`
      : Object.assign(node, { rel: 'stylesheet', href: `${name}.css` })

    // charset has to stay within the first bytes of the document
    const charset = head.querySelector('meta[charset]')
    charset ? charset.after(node) : head.prepend(node)
  }

  return {
    css,
    html: `<!doctype html>\n${root.outerHTML}`,
    filenames: { html: `${name}.html`, css: `${name}.css` },
  }
}

/** Just the markup for one subtree — what "copy element" should hand over. */
export const exportElement = el => {
  const clone = clean(el.cloneNode(true))
  absolutiseAttrs(clone)
  return clone.outerHTML
}

/**
 * Hand the files to the browser. Two downloads in a row makes Chrome ask
 * once for permission to save multiple files; the small gap keeps the
 * second from being swallowed while the first is still being written.
 */
export const downloadBundle = async ({ html, css, filenames = {} }) => {
  const save = (name, text, type) => {
    const url  = URL.createObjectURL(new Blob([text], { type }))
    const link = getDoc().createElement('a')

    Object.assign(link, { href: url, download: name })
    getDoc().body.appendChild(link)
    link.click()
    link.remove()

    URL.revokeObjectURL(url)
  }

  if (html) save(filenames.html || 'design.html', html, 'text/html')

  if (css) {
    await new Promise(resolve => setTimeout(resolve, 250))
    save(filenames.css || STYLESHEET_NAME, css, 'text/css')
  }
}

export { STYLESHEET_NAME }
