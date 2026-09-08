import { getDoc, getWin } from './context'
import { getAuthoredStyle } from './style-store'

/**
 * "What design system does this page already speak?"
 *
 * VisBug's nudges were pure arithmetic — padding + 1px, font-size + 1px. On a
 * page built from a token scale that's the wrong unit of thought: the designer
 * wants *the next step*, and the export should read `var(--op-space-medium)`
 * rather than a number that happens to match it today.
 *
 * So before editing we read the page's own custom properties, order the ones
 * that form a scale, and let features step through them. Nothing here is
 * Optics-specific except the probe list at the bottom — any page whose tokens
 * are named for what they are gets the same treatment.
 *
 * Discovery is best-effort by design. Same-origin stylesheets can be walked;
 * a cross-origin one (Optics served from a CDN) throws on .cssRules, so we
 * fall back to probing known names. Anything that doesn't resolve is dropped,
 * and a page with no scale falls through to the old px math untouched.
 */

const PROBE_TAG = 'visbug-token-probe'

// letter-spacing and color are *inherited*, so a var() the browser can't
// resolve leaves the sentinel showing through from the parent probe. Without
// that we couldn't tell "not a length" from "a length that happens to be 0".
//
// The length sentinel is absurd *and negative* on purpose: --op-radius-pill is
// 9999px, and a token colliding with the sentinel would read as unresolvable.
const LENGTH_SENTINEL = '-99999px'
const COLOR_SENTINEL  = 'rgb(1, 2, 3)'

// scale tokens (--op-space-medium) vs. the arithmetic they're built from
// (--op-space-scale-unit), and the raw hsl channels behind each color
const NOT_A_TOKEN = /(?:-unit|-original)$|(?:^|-)[hsl]$/

const CLASSIFIERS = [
  [/(?:^|-)(?:radius|rounded|corner)(?:-|$)/,             'radius'],
  [/(?:^|-)(?:shadow|elevation)(?:-|$)/,                  'shadow'],
  [/(?:^|-)(?:font-)?weight(?:-|$)/,                      'fontWeight'],
  [/(?:^|-)(?:line-height|leading)(?:-|$)/,               'lineHeight'],
  [/(?:^|-)(?:font-size|text-size|type-scale)(?:-|$)/,    'fontSize'],
  [/^--op-font-/,                                         'fontSize'],  // optics names its type scale --op-font-*
  [/(?:^|-)colou?r(?:-|$)/,                               'color'],
  [/(?:^|-)(?:space|spacing|gap|size)(?:-|$)/,            'space'],
]

// how a name reads on a t-shirt scale, for groups we can't sort numerically
const SCALE_WORDS = [
  '4x-small', '3x-small', '2x-small', 'x-small', 'small',
  'base', 'default', 'regular', 'medium',
  'large', 'x-large', '2x-large', '3x-large', '4x-large', '5x-large', '6x-large',
]

const LENGTH_KINDS = ['space', 'fontSize', 'radius']
const NUMBER_KINDS = ['fontWeight', 'lineHeight']

const classify = name => {
  if (NOT_A_TOKEN.test(name)) return null

  for (const [pattern, kind] of CLASSIFIERS)
    if (pattern.test(name)) return kind

  return null
}

const scaleRank = name => {
  const index = SCALE_WORDS.findIndex(word => name.endsWith(`-${word}`))
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

const clamp = (n, min, max) =>
  n < min ? min : n > max ? max : n

/** The number a scale entry sorts and steps by. */
const measure = token =>
  token.px != null ? token.px : token.number

/* ------------------------------------------------------------------ probe */

/**
 * A hidden pair of elements we can bounce var() through. The outer one holds
 * the sentinels; the inner one is where we actually evaluate. `display:none`
 * keeps this off the layout and paint path — computed styles still resolve.
 */
const withProbe = fn => {
  const doc = getDoc()
  const win = getWin()

  if (!doc || !win) return fn(null, null)

  const outer = doc.createElement(PROBE_TAG)
  const inner = doc.createElement(PROBE_TAG)

  outer.style.cssText = `display:none;letter-spacing:${LENGTH_SENTINEL};color:${COLOR_SENTINEL}`
  outer.appendChild(inner)
  ;(doc.body || doc.documentElement).appendChild(outer)

  try     { return fn(inner, win) }
  finally { outer.remove() }
}

const resolveLength = (probe, win, name) => {
  probe.style.setProperty('letter-spacing', `var(${name})`)
  const computed = win.getComputedStyle(probe).letterSpacing
  probe.style.removeProperty('letter-spacing')

  // an absolute length always serializes as px — anything else (`50%` from
  // --op-radius-circle, `normal`) isn't a step on a scale we can walk
  if (!computed || computed === LENGTH_SENTINEL || !computed.endsWith('px'))
    return null

  const px = parseFloat(computed)
  return Number.isFinite(px) ? px : null
}

const resolveColor = (probe, win, name) => {
  probe.style.setProperty('color', `var(${name})`)
  const computed = win.getComputedStyle(probe).color
  probe.style.removeProperty('color')

  return !computed || computed === COLOR_SENTINEL
    ? null
    : computed
}

/** The token's own text, after var() substitution but before any evaluation. */
const resolveRaw = (probe, win, name) =>
  win.getComputedStyle(probe).getPropertyValue(name).trim()

/** Strictly unitless — keeps `1.5rem` out of the line-height scale. */
const resolveNumber = (probe, win, name) => {
  const raw = resolveRaw(probe, win, name)
  const num = parseFloat(raw)

  return raw !== '' && Number.isFinite(num) && String(num) === raw
    ? num
    : null
}

/* -------------------------------------------------------------- discovery */

const collectFromRules = (rules, names) => {
  for (const rule of rules) {
    if (rule.style)
      for (const prop of rule.style)
        if (prop.startsWith('--')) names.add(prop)

    // @media / @supports / @layer wrap the rules we're after
    if (rule.cssRules) collectFromRules(rule.cssRules, names)
  }
}

const discoverNames = () => {
  const doc   = getDoc()
  const names = new Set()

  const sheets = [
    ...(doc.styleSheets || []),
    ...(doc.adoptedStyleSheets || []),
  ]

  for (const sheet of sheets) {
    let rules
    try   { rules = sheet.cssRules }
    catch { continue }              // cross-origin, nothing to read

    if (rules) collectFromRules(rules, names)
  }

  for (const el of [doc.documentElement, doc.body])
    if (el)
      for (const prop of el.style)
        if (prop.startsWith('--')) names.add(prop)

  return names
}

/* ------------------------------------------------------------------ build */

const buildTokens = () => withProbe((probe, win) => {
  if (!probe) return []

  const names = discoverNames()
  addOpticsNames(probe, win, names)

  const tokens = []

  for (const name of names) {
    if (NOT_A_TOKEN.test(name)) continue

    const kind  = classify(name)
    const token = { name, kind, css: `var(${name})` }

    if (kind === 'color') {
      token.value = resolveColor(probe, win, name)
      if (!token.value) continue
    }
    else if (kind === 'shadow') {
      token.value = resolveRaw(probe, win, name)
      if (!token.value) continue
      token.rank = scaleRank(name)
    }
    else if (NUMBER_KINDS.includes(kind)) {
      token.number = resolveNumber(probe, win, name)
      if (token.number == null) continue
      token.value = String(token.number)
    }
    else if (LENGTH_KINDS.includes(kind)) {
      token.px = resolveLength(probe, win, name)
      if (token.px == null) continue
      token.value = `${token.px}px`
    }
    else {
      // Unnamed for its purpose. We'll take it as a color if it resolves as
      // one — a swatch we don't recognize costs nothing. We deliberately do
      // *not* guess at lengths: an unrecognized number sneaking into the
      // spacing scale would silently change what the arrow keys do.
      token.value = resolveColor(probe, win, name)
      if (!token.value) continue
      token.kind = 'color'
    }

    tokens.push(token)
  }

  return tokens
})

const buildScale = tokens => {
  const sorted = [...tokens].sort((a, b) => measure(a) - measure(b))
  const scale  = []

  // aliases pointing at the same value would make a step feel like a no-op
  for (const token of sorted) {
    const previous = scale[scale.length - 1]

    if (previous && measure(previous) === measure(token)) {
      if (token.name.length < previous.name.length) scale[scale.length - 1] = token
      continue
    }

    scale.push(token)
  }

  return scale
}

const buildIndex = tokens => {
  const of_kind = kind => tokens.filter(token => token.kind === kind)

  const scales = {}

  for (const kind of [...LENGTH_KINDS, ...NUMBER_KINDS])
    scales[kind] = buildScale(of_kind(kind))

  scales.shadow = of_kind('shadow').sort((a, b) =>
    a.rank - b.rank || a.name.localeCompare(b.name))

  const colors = of_kind('color')

  return { tokens, scales, colors }
}

/* ------------------------------------------------------------------ cache */

const state = {
  index:  null,
  sheets: -1,
}

// cheap staleness check: a page that lazy-loads a stylesheet gets rescanned
const sheetCount = () =>
  getDoc()?.styleSheets?.length ?? 0

const index = () => {
  if (state.index && state.sheets === sheetCount())
    return state.index

  state.sheets = sheetCount()
  state.index  = buildIndex(buildTokens())

  return state.index
}

export const refreshTokens = () => {
  state.index = null
  return index()
}

/* ----------------------------------------------------------------- public */

/** Ordered scale for a kind — [] when the page doesn't have one. */
export const getScale = kind =>
  index().scales[kind] || []

/** Every color token the page defines, in discovery order. */
export const getPalette = () =>
  index().colors

export const hasScale = kind =>
  getScale(kind).length > 1

/** `var(--op-space-medium)` -> `--op-space-medium`, anything else -> null. */
export const tokenName = value => {
  const match = /^\s*var\(\s*(--[^,)\s]+)/.exec(value || '')
  return match ? match[1] : null
}

export const findToken = name =>
  index().tokens.find(token => token.name === name) || null

/**
 * The scale step's full name when `px` lands exactly on one, e.g.
 * "--op-space-medium" — null when the page has no such scale or the value
 * falls between steps. Lets a measurement read as the token it was authored
 * from instead of raw pixels.
 */
export const labelForLength = (kind, px) => {
  if (!Number.isFinite(px)) return null

  const token = getScale(kind).find(({px: step}) => Math.abs(step - px) < 0.05)
  return token ? token.name : null
}

/**
 * Where `value` lands on a scale when it isn't already a token — the index we
 * move to on the *first* press, so a nudge always travels the way you asked
 * instead of snapping backwards onto the nearest step.
 */
const snapIndex = (scale, value, delta) => {
  if (!Number.isFinite(value))
    return delta > 0 ? 0 : scale.length - 1

  if (delta > 0) {
    const next = scale.findIndex(token => measure(token) > value)
    return next === -1 ? scale.length - 1 : next
  }

  for (let i = scale.length - 1; i >= 0; i--)
    if (measure(scale[i]) < value) return i

  return 0
}

/**
 * The token one step along `kind`'s scale from what `el` currently has.
 *
 * Returns null when the page has no such scale, which is the caller's signal
 * to keep doing its old px arithmetic — token-less pages behave exactly as
 * they always have.
 */
export const stepStyleToken = ({ el, prop, kind, delta, current }) => {
  const scale = getScale(kind)
  if (scale.length < 2) return null

  const authored = tokenName(getAuthoredStyle(el, prop))
  const at       = authored ? scale.findIndex(token => token.name === authored) : -1

  return at === -1
    ? scale[snapIndex(scale, current, delta)]
    : scale[clamp(at + delta, 0, scale.length - 1)]
}

/** Step a scale that isn't attached to a numeric current value (shadows). */
export const stepScaleFrom = ({ el, prop, kind, delta }) => {
  const scale = getScale(kind)
  if (!scale.length) return null

  const authored = tokenName(getAuthoredStyle(el, prop))
  const at       = authored ? scale.findIndex(token => token.name === authored) : -1

  return at === -1
    ? scale[delta > 0 ? 0 : scale.length - 1]
    : scale[clamp(at + delta, 0, scale.length - 1)]
}

/* ----------------------------------------------------------------- optics */

// A cross-origin Optics build hides its rules from discoverNames(), so we ask
// for the names directly. Generated rather than listed — the scale words and
// color ramp are regular, and a name that doesn't resolve is dropped anyway.
const OPTICS_SENTINEL = '--op-space-medium'

const OPTICS_SIZES = [
  '3x-small', '2x-small', 'x-small', 'small', 'medium',
  'large', 'x-large', '2x-large', '3x-large', '4x-large',
  '5x-large', '6x-large',
]

const OPTICS_WEIGHTS = [
  'thin', 'extra-light', 'light', 'normal', 'medium',
  'semi-bold', 'bold', 'extra-bold', 'black',
]

const OPTICS_LINE_HEIGHTS = [
  'none', 'densest', 'denser', 'dense', 'base',
  'loose', 'looser', 'loosest',
]

const OPTICS_RADII = ['small', 'medium', 'large', 'x-large', '2x-large', 'pill']

const OPTICS_COLOR_FAMILIES = [
  'primary', 'neutral', 'border', 'background', 'black', 'white',
  'alerts-danger', 'alerts-info', 'alerts-notice', 'alerts-warning',
]

const OPTICS_COLOR_STEPS = [
  'base',
  ...['max', 'eight', 'seven', 'six', 'five', 'four', 'three', 'two', 'one']
    .flatMap(step => [`minus-${step}`, `plus-${step}`]),
]

const addOpticsNames = (probe, win, names) => {
  // one probe tells us whether any of the rest is worth asking about
  if (names.has(OPTICS_SENTINEL)) return
  if (resolveLength(probe, win, OPTICS_SENTINEL) == null) return

  const add = name => names.add(name)

  OPTICS_SIZES.forEach(size => {
    add(`--op-space-${size}`)
    add(`--op-font-${size}`)
    add(`--op-shadow-${size}`)
  })

  OPTICS_WEIGHTS.forEach(weight     => add(`--op-font-weight-${weight}`))
  OPTICS_LINE_HEIGHTS.forEach(lh    => add(`--op-line-height-${lh}`))
  OPTICS_RADII.forEach(radius       => add(`--op-radius-${radius}`))

  OPTICS_COLOR_FAMILIES.forEach(family =>
    OPTICS_COLOR_STEPS.forEach(step =>
      add(`--op-color-${family}-${step}`)))
}
