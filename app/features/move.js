import $ from 'blingblingjs'
import hotkeys from 'hotkeys-js'
import { getNodeIndex, showEdge, isFixed } from '../utilities/'
import { editStyle, history } from '../core'
import { resolveDrop } from './dropzones'
import { toggleWatching } from './imageswap'

const key_events = 'up,down,left,right'

// pixels of travel before a mousedown becomes a drag rather than a click
const DRAG_THRESHOLD = 4

const state = {
  drag: {
    src:        null,
    active:     false,
    pointer_id: null,
    origin:     null,
    offset:     null,
    rect:       null,
    drop:       null,
    indicator:  null,
  },
}
// todo: have it work with shadowDOM
export function Moveable(visbug) {
  hotkeys(key_events, (e, {key}) => {
    if (e.cancelBubble) return

    e.preventDefault()
    e.stopPropagation()

    visbug.selection().forEach(el => {
      moveElement(el, key)
      updateFeedback(el)
    })
  })

  visbug.onSelectedUpdate(dragNDrop)
  toggleWatching({watch: false})

  return () => {
    toggleWatching({watch: true})
    visbug.removeSelectedCallback(dragNDrop)
    clearListeners()
    hotkeys.unbind(key_events)
  }
}

export function moveElement(el, direction) {
  if (!el) return

  const step = apply =>
    history.recordDOM(el, apply, 'nudge')

  switch(direction) {
    case 'left':
      if (canMoveLeft(el))
        step(() => el.parentNode.insertBefore(el, el.previousElementSibling))
      else
        showEdge(el.parentNode)
      break

    case 'right':
      if (canMoveRight(el) && el.nextElementSibling.nextSibling)
        step(() => el.parentNode.insertBefore(el, el.nextElementSibling.nextSibling))
      else if (canMoveRight(el))
        step(() => el.parentNode.appendChild(el))
      else
        showEdge(el.parentNode)
      break

    case 'up':
      if (canMoveUp(el))
        step(() => popOut({el}))
      break

    case 'down':
      if (canMoveUnder(el))
        step(() => popOut({el, under: true}))
      else if (canMoveDown(el))
        step(() => el.nextElementSibling.prepend(el))
      break
  }
}

export const canMoveLeft    = el => el.previousElementSibling
export const canMoveRight   = el => el.nextElementSibling
export const canMoveDown    = el => el.nextElementSibling && el.nextElementSibling.children.length
export const canMoveUnder   = el => !el.nextElementSibling && el.parentNode && el.parentNode.parentNode
export const canMoveUp      = el => el.parentNode && el.parentNode.parentNode

export const popOut = ({el, under = false}) =>
  el.parentNode.parentNode.insertBefore(el,
    el.parentNode.parentNode.children[
      under
        ? getNodeIndex(el) + 1
        : getNodeIndex(el)])

export function dragNDrop(selection) {
  clearListeners()

  if (selection.length !== 1) return

  const [src] = selection
  if (src instanceof SVGElement) return

  state.drag.src = src
  src.style.cursor = 'grab'
  $(src).on('pointerdown', onPointerDown)
}

const onPointerDown = e => {
  const src = state.drag.src
  if (!src || e.button !== 0) return

  // let text selection and form controls keep working
  if (e.target.isContentEditable || e.target.closest('input,textarea,select')) return

  e.preventDefault()
  e.stopPropagation()

  state.drag.pointer_id = e.pointerId
  state.drag.origin     = { x: e.clientX, y: e.clientY }
  state.drag.rect       = src.getBoundingClientRect()
  state.drag.offset     = {
    x: e.clientX - state.drag.rect.left,
    y: e.clientY - state.drag.rect.top,
  }
  state.drag.active = false

  src.setPointerCapture(e.pointerId)
  $(src).on('pointermove', onPointerMove)
  $(src).on('pointerup', onPointerUp)
  $(src).on('pointercancel', onPointerUp)
}

const beginDrag = () => {
  const src = state.drag.src

  state.drag.active = true
  src.style.cursor = 'grabbing'

  history.beginGesture('move')

  ghostNode(src)
  state.drag.indicator = createInsertionUI()
}

const onPointerMove = e => {
  const src = state.drag.src
  if (!src || e.pointerId !== state.drag.pointer_id) return

  const travelled = Math.hypot(
    e.clientX - state.drag.origin.x,
    e.clientY - state.drag.origin.y)

  if (!state.drag.active) {
    if (travelled < DRAG_THRESHOLD) return
    beginDrag()
  }

  e.preventDefault()

  const rect = {
    left:   e.clientX - state.drag.offset.x,
    top:    e.clientY - state.drag.offset.y,
    width:  state.drag.rect.width,
    height: state.drag.rect.height,
  }

  const drop = resolveDrop({
    x: e.clientX,
    y: e.clientY,
    dragged: src,
    doc: src.ownerDocument,
    rect,
  })

  state.drag.drop = drop

  if (!drop) {
    state.drag.indicator.style.display = 'none'
    return
  }

  state.drag.indicator.style.display = ''
  state.drag.indicator.placement = {
    ...drop.indicator,
    isFixed: isFixed(drop.container),
  }

  // free placement follows the cursor live; flow drops preview via the caret
  if (drop.mode === 'free')
    moveFreely(src, rect, drop)
}

const moveFreely = (src, rect, drop) => {
  const x = rect.left + (drop.snap?.dx || 0)
  const y = rect.top  + (drop.snap?.dy || 0)

  // fixed elements are already positioned against the viewport; absolute ones
  // resolve against their offset parent, so subtract that origin
  const origin = getComputedStyle(src).position === 'fixed'
    ? { left: 0, top: 0 }
    : (src.offsetParent || drop.container).getBoundingClientRect()

  editStyle(src, 'left', `${Math.round(x - origin.left)}px`, 'move')
  editStyle(src, 'top',  `${Math.round(y - origin.top)}px`, 'move')
}

const onPointerUp = e => {
  const src = state.drag.src
  if (!src) return

  $(src).off('pointermove', onPointerMove)
  $(src).off('pointerup', onPointerUp)
  $(src).off('pointercancel', onPointerUp)

  if (src.hasPointerCapture?.(state.drag.pointer_id))
    src.releasePointerCapture(state.drag.pointer_id)

  if (!state.drag.active) return

  const drop = state.drag.drop

  if (drop && drop.mode !== 'free') {
    // one insert, one undo entry, even though the pointer moved a hundred times
    if (drop.reference !== src && drop.container !== src)
      history.recordDOM(src, () =>
        drop.container.insertBefore(src, drop.reference), 'move')

    if (drop.styles)
      Object.entries(drop.styles).forEach(([prop, value]) =>
        editStyle(src, prop, value, 'move'))
  }

  history.endGesture()

  ghostBuster(src)
  src.style.cursor = 'grab'
  state.drag.active = false
  state.drag.drop = null

  clearIndicator()
}

const createInsertionUI = () => {
  const indicator = document.createElement('visbug-insertion')
  document.body.appendChild(indicator)
  return indicator
}

const clearIndicator = () => {
  state.drag.indicator?.remove()
  state.drag.indicator = null
}

export function clearListeners() {
  const src = state.drag.src

  if (src) {
    $(src).off('pointerdown', onPointerDown)
    $(src).off('pointermove', onPointerMove)
    $(src).off('pointerup', onPointerUp)
    $(src).off('pointercancel', onPointerUp)
    src.style.cursor = null
    ghostBuster(src)
  }

  if (state.drag.active) history.endGesture()

  clearIndicator()

  state.drag.src    = null
  state.drag.drop   = null
  state.drag.active = false
}

const ghostNode = ({style}) => {
  style.transition = 'opacity .15s ease-out'
  style.opacity    = 0.4
}

const ghostBuster = ({style}) => {
  style.transition = null
  style.opacity    = null
}

const updateFeedback = el => {
  let options = ''
  // get current elements offset/size
  if (canMoveLeft(el))  options += '⇠'
  if (canMoveRight(el)) options += '⇢'
  if (canMoveDown(el))  options += '⇣'
  if (canMoveUp(el))    options += '⇡'
  // create/move arrows in absolute/fixed to overlay element
  options && console.info('%c'+options, "font-size: 2rem;")
}
