import { getWin } from '../core'
import { isOffBounds } from '../utilities/'

/**
 * Resolves "where would this element land if I dropped it here?"
 *
 * The old drag simply swapped two siblings and never looked at the parent's
 * layout. This reads the drop container's computed `display` and produces a
 * real insertion point: a caret between flex items along the correct axis, a
 * cell in a grid, a line break inside wrapped/inline flow, or free XY
 * placement for absolutely positioned elements.
 *
 * Pure geometry — it never mutates the document. move.js applies the result.
 */

const BAR_THICKNESS = 3
const SNAP_PX       = 8

// elements that can't take children, so a drop near them means "next to"
const VOID_TAGS = new Set([
  'img','input','br','hr','source','track','embed','area','col','wbr',
  'video','audio','canvas','iframe','object','textarea','select','svg','picture',
])

// only the displays whose axis is genuinely fixed by spec; block/inline/etc
// get measured instead — see inferAxis()
const AXIS_BY_DISPLAY = {
  'table':              'y',
  'table-row-group':    'y',
  'table-header-group': 'y',
  'table-footer-group': 'y',
  'table-row':          'x',
}

const cs = el => getWin().getComputedStyle(el)

const contentBox = el => {
  const r = el.getBoundingClientRect()
  const s = cs(el)
  const l = parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft)
  const t = parseFloat(s.borderTopWidth)  + parseFloat(s.paddingTop)
  const r_ = parseFloat(s.borderRightWidth)  + parseFloat(s.paddingRight)
  const b = parseFloat(s.borderBottomWidth) + parseFloat(s.paddingBottom)

  return {
    left:   r.left + l,
    top:    r.top + t,
    width:  Math.max(0, r.width  - l - r_),
    height: Math.max(0, r.height - t - b),
    get right()  { return this.left + this.width },
    get bottom() { return this.top + this.height },
  }
}

const paddingBox = el => {
  const r = el.getBoundingClientRect()
  const s = cs(el)
  const l = parseFloat(s.borderLeftWidth)
  const t = parseFloat(s.borderTopWidth)
  const r_ = parseFloat(s.borderRightWidth)
  const b = parseFloat(s.borderBottomWidth)

  return {
    left:   r.left + l,
    top:    r.top + t,
    width:  Math.max(0, r.width  - l - r_),
    height: Math.max(0, r.height - t - b),
  }
}

const tracks = value =>
  !value || value === 'none'
    ? []
    : value.trim().split(/\s+/).map(parseFloat).filter(n => !Number.isNaN(n))

const isDroppableChild = (el, dragged) =>
  el.nodeType === 1
  && !isOffBounds(el)
  && el !== dragged
  && !dragged?.contains(el)
  && cs(el).display !== 'none'

const childrenOf = (container, dragged) =>
  [...container.children].filter(el => isDroppableChild(el, dragged))

const acceptsChildren = el => {
  if (!el || el.nodeType !== 1) return false
  if (VOID_TAGS.has(el.tagName.toLowerCase())) return false
  if (el.isContentEditable) return false

  // a text-only leaf (a <p> of prose) is a sibling target, not a container
  const hasElementChildren = el.children.length > 0
  const hasText = [...el.childNodes].some(n =>
    n.nodeType === 3 && n.textContent.trim().length)

  return hasElementChildren || !hasText
}

/** Deepest element under the pointer that isn't chrome or the dragged node. */
const hitTest = (x, y, dragged, doc) =>
  doc.elementsFromPoint(x, y)
    .filter(el =>
      !isOffBounds(el)
      && el !== dragged
      && !dragged?.contains(el)
      && el !== doc.documentElement)

const resolveContainer = (x, y, dragged, doc) => {
  const hits = hitTest(x, y, dragged, doc)

  for (const hit of hits) {
    if (acceptsChildren(hit)) return hit
    if (hit.parentElement && acceptsChildren(hit.parentElement))
      return hit.parentElement
  }

  return doc.body && acceptsChildren(doc.body) ? doc.body : null
}

/* ---------------------------------------------------------------- flow --- */

const start = (rect, axis) => axis === 'x' ? rect.left : rect.top
const end   = (rect, axis) => axis === 'x' ? rect.right : rect.bottom
const mid   = (rect, axis) => start(rect, axis) + (axis === 'x' ? rect.width : rect.height) / 2

/**
 * Group items into visual lines along the cross axis — what makes a
 * wrapped flex container or a run of inline elements resolve correctly.
 */
const intoLines = (items, axis) => {
  const cross = axis === 'x' ? 'y' : 'x'
  const sorted = [...items].sort((a, b) =>
    start(a.rect, cross) - start(b.rect, cross)
    || start(a.rect, axis) - start(b.rect, axis))

  const lines = []

  sorted.forEach(item => {
    const line = lines[lines.length - 1]
    const overlaps = line && line.some(other =>
      start(item.rect, cross) < end(other.rect, cross) - 1
      && end(item.rect, cross) > start(other.rect, cross) + 1)

    overlaps ? line.push(item) : lines.push([item])
  })

  return lines.map(line =>
    line.sort((a, b) => start(a.rect, axis) - start(b.rect, axis)))
}

/**
 * For anything that isn't flex or grid, `display` doesn't tell you the axis —
 * a block container full of inline-block chips lays out in a row. Read the
 * children's actual geometry instead: if adjacent items share a horizontal
 * band but don't overlap horizontally, they're a row.
 */
const inferAxis = items => {
  if (items.length < 2) return 'y'

  const sorted = [...items].sort((a, b) => a.rect.top - b.rect.top)
  let side_by_side = 0

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].rect
    const b = sorted[i].rect

    const y_overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    const x_overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left)

    if (y_overlap > 0 && x_overlap <= 0) side_by_side++
  }

  return side_by_side > (sorted.length - 1) / 2 ? 'x' : 'y'
}

const barRect = (prev, next, axis, box) => {
  const cross_start = prev && next
    ? Math.min(start(prev.rect, axis === 'x' ? 'y' : 'x'), start(next.rect, axis === 'x' ? 'y' : 'x'))
    : start((prev || next).rect, axis === 'x' ? 'y' : 'x')

  const cross_end = prev && next
    ? Math.max(end(prev.rect, axis === 'x' ? 'y' : 'x'), end(next.rect, axis === 'x' ? 'y' : 'x'))
    : end((prev || next).rect, axis === 'x' ? 'y' : 'x')

  // sit in the gap, or hug the single neighbour's edge
  const at = prev && next
    ? (end(prev.rect, axis) + start(next.rect, axis)) / 2
    : prev
      ? end(prev.rect, axis)
      : start(next.rect, axis)

  return axis === 'x'
    ? {
        left:   at - BAR_THICKNESS / 2,
        top:    cross_start,
        width:  BAR_THICKNESS,
        height: Math.max(BAR_THICKNESS, cross_end - cross_start),
      }
    : {
        left:   cross_start,
        top:    at - BAR_THICKNESS / 2,
        width:  Math.max(BAR_THICKNESS, cross_end - cross_start),
        height: BAR_THICKNESS,
      }
}

const emptyContainerDrop = container => ({
  container,
  mode:      'flow',
  reference: null,
  indicator: { rect: paddingBox(container), kind: 'container', axis: 'y' },
})

const resolveFlow = ({ container, x, y, dragged, axis, wrapped, reversed }) => {
  const items = childrenOf(container, dragged)
    .map(el => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width || rect.height)

  if (!items.length)
    return emptyContainerDrop(container)

  if (axis === 'auto') axis = inferAxis(items)

  const lines = wrapped ? intoLines(items, axis) : [
    [...items].sort((a, b) => start(a.rect, axis) - start(b.rect, axis))
  ]

  const cross = axis === 'x' ? 'y' : 'x'
  const point = { x, y }

  // pick the line the pointer is on, else the nearest one
  const line = lines.find(l =>
    point[cross] >= Math.min(...l.map(i => start(i.rect, cross)))
    && point[cross] <= Math.max(...l.map(i => end(i.rect, cross)))
  ) || lines.reduce((best, l) => {
    const d = Math.min(...l.map(i =>
      Math.abs(mid(i.rect, cross) - point[cross])))
    return !best || d < best.d ? { line: l, d } : best
  }, null).line

  // first item whose midpoint is past the pointer wins the "insert before"
  const vi = line.findIndex(item => point[axis] < mid(item.rect, axis))
  const at = vi === -1 ? line.length : vi

  const prev = line[at - 1] || null
  const next = line[at] || null

  // in a reversed track, visual order is the inverse of DOM order, so the
  // node to insertBefore is the one on the *other* side of the caret
  const reference = reversed
    ? (prev ? prev.el : null)
    : (next ? next.el : null)

  return {
    container,
    mode: 'flow',
    reference,
    indicator: { rect: barRect(prev, next, axis, contentBox(container)), kind: 'bar', axis },
  }
}

/* ---------------------------------------------------------------- grid --- */

const gridCells = container => {
  const s    = cs(container)
  const box  = contentBox(container)
  const cols = tracks(s.gridTemplateColumns)
  const rows = tracks(s.gridTemplateRows)

  if (!cols.length || !rows.length) return null

  const col_gap = parseFloat(s.columnGap) || 0
  const row_gap = parseFloat(s.rowGap) || 0

  const x_edges = []
  cols.reduce((x, w) => { x_edges.push({ start: x, size: w }); return x + w + col_gap }, box.left)

  const y_edges = []
  rows.reduce((y, h) => { y_edges.push({ start: y, size: h }); return y + h + row_gap }, box.top)

  return { x_edges, y_edges, col_gap, row_gap }
}

const nearestTrack = (edges, pos, gap) => {
  for (let i = 0; i < edges.length; i++) {
    const { start, size } = edges[i]
    if (pos < start + size + gap / 2) return i
  }
  return edges.length - 1
}

const isAutoPlaced = (el) => {
  const s = cs(el)
  return s.gridColumnStart === 'auto' && s.gridRowStart === 'auto'
}

const resolveGrid = ({ container, x, y, dragged }) => {
  const cells = gridCells(container)
  if (!cells) return resolveFlow({ container, x, y, dragged, axis: 'auto', wrapped: true, reversed: false })

  const items = childrenOf(container, dragged)
  if (!items.length) return emptyContainerDrop(container)

  const col = nearestTrack(cells.x_edges, x, cells.col_gap)
  const row = nearestTrack(cells.y_edges, y, cells.row_gap)

  const rect = {
    left:   cells.x_edges[col].start,
    top:    cells.y_edges[row].start,
    width:  cells.x_edges[col].size,
    height: cells.y_edges[row].size,
  }

  // Auto-flow grid: keep it auto-flowing — reorder in the DOM and let the
  // browser re-place. Explicitly placed grid: pin the element to the cell.
  const auto_flow = items.every(isAutoPlaced)

  if (!auto_flow)
    return {
      container,
      mode:      'grid',
      reference: null,
      styles:    { gridColumn: `${col + 1}`, gridRow: `${row + 1}` },
      indicator: { rect, kind: 'cell', axis: 'y' },
    }

  // the child currently occupying (or nearest past) this cell in flow order
  const target = items.find(el => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2 > rect.top && r.left + r.width / 2 > rect.left
  }) || items.find(el => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2 > rect.top + rect.height
  }) || null

  return {
    container,
    mode:      'grid',
    reference: target,
    indicator: { rect, kind: 'cell', axis: 'y' },
  }
}

/* ---------------------------------------------------------------- free --- */

const snapEdges = (container, dragged) => {
  const box = paddingBox(container)
  const xs  = [box.left, box.left + box.width / 2, box.left + box.width]
  const ys  = [box.top,  box.top + box.height / 2, box.top + box.height]

  childrenOf(container, dragged).forEach(el => {
    const r = el.getBoundingClientRect()
    xs.push(r.left, r.left + r.width / 2, r.right)
    ys.push(r.top,  r.top + r.height / 2, r.bottom)
  })

  return { xs, ys }
}

const snapTo = (candidates, values) => {
  let best = null

  values.forEach(value =>
    candidates.forEach(candidate => {
      const delta = candidate - value
      if (Math.abs(delta) <= SNAP_PX && (!best || Math.abs(delta) < Math.abs(best.delta)))
        best = { delta, at: candidate }
    }))

  return best
}

/**
 * Absolutely positioned elements don't participate in flow, so there's no
 * caret to draw — snap their edges and centers to siblings instead.
 */
const resolveFree = ({ container, dragged, rect }) => {
  const { xs, ys } = snapEdges(container, dragged)

  const snap_x = snapTo(xs, [rect.left, rect.left + rect.width / 2, rect.left + rect.width])
  const snap_y = snapTo(ys, [rect.top,  rect.top + rect.height / 2, rect.top + rect.height])

  return {
    container,
    mode:      'free',
    reference: null,
    snap: {
      dx: snap_x ? snap_x.delta : 0,
      dy: snap_y ? snap_y.delta : 0,
      x:  snap_x ? snap_x.at : null,
      y:  snap_y ? snap_y.at : null,
    },
    indicator: { rect: paddingBox(container), kind: 'container', axis: 'y' },
  }
}

/* ------------------------------------------------------------- resolve --- */

export const isFreeFloating = el => {
  const position = cs(el).position
  return position === 'absolute' || position === 'fixed'
}

/**
 * @returns {null | {container, mode, reference, indicator, styles?, snap?}}
 *   `reference` is the node to insertBefore — null means append.
 */
export const resolveDrop = ({ x, y, dragged, doc = dragged?.ownerDocument, rect = null }) => {
  if (!dragged || !doc) return null

  const container = resolveContainer(x, y, dragged, doc)
  if (!container || container === dragged || dragged.contains(container)) return null

  if (isFreeFloating(dragged) && cs(container).position !== 'static')
    return resolveFree({ container, dragged, rect: rect || dragged.getBoundingClientRect() })

  const display = cs(container).display

  if (display === 'grid' || display === 'inline-grid')
    return resolveGrid({ container, x, y, dragged })

  if (display === 'flex' || display === 'inline-flex') {
    const s = cs(container)
    const axis = s.flexDirection.startsWith('column') ? 'y' : 'x'

    return resolveFlow({
      container, x, y, dragged, axis,
      wrapped:  s.flexWrap !== 'nowrap',
      reversed: s.flexDirection.endsWith('reverse'),
    })
  }

  // table parts declare their own axis; everything else we measure
  return resolveFlow({
    container, x, y, dragged,
    axis:     AXIS_BY_DISPLAY[display] || 'auto',
    wrapped:  true,
    reversed: false,
  })
}

export const __test__ = {
  intoLines, nearestTrack, gridCells, acceptsChildren, contentBox, snapTo, inferAxis,
}
