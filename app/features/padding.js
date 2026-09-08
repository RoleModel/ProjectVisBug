import hotkeys from 'hotkeys-js'
import { metaKey, getStyle, getSide, showHideSelected, expandBorders } from '../utilities/'
import { editStyle, stepStyleToken } from '../core'

const key_events = 'up,down,left,right'
  .split(',')
  .reduce((events, event) =>
    `${events},${event},alt+${event},shift+${event},shift+alt+${event}`
  , '')
  .substring(1)

const command_events = `${metaKey}+up,${metaKey}+shift+up,${metaKey}+down,${metaKey}+shift+down`

export function Padding(visbug) {
  hotkeys(key_events, (e, handler) => {
    if (e.cancelBubble) return

    e.preventDefault()
    padElement(visbug.selection(), handler.key)
  })

  hotkeys(command_events, (e, handler) => {
    e.preventDefault()
    padAllElementSides(visbug.selection(), handler.key)
  })

  visbug.onSelectedUpdate(paintBackgrounds)

  return () => {
    hotkeys.unbind(key_events)
    hotkeys.unbind(command_events)
    hotkeys.unbind('up,down,left,right') // bug in lib?
    visbug.removeSelectedCallback(paintBackgrounds)
    removeBackgrounds(visbug.selection())
  }
}

export function padElement(els, direction) {
  const keys      = direction.split('+')
  const negative  = keys.includes('alt')
  // shift has always meant "coarser"; on a page with a spacing scale it doubles
  // as the escape hatch back to raw px, since the scale is the coarse mode now
  const raw_px    = keys.includes('shift')
  const style     = 'padding' + getSide(direction)

  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      current:  parseInt(getStyle(el, style), 10),
      amount:   raw_px ? 10 : 1,
      negative,
    }))
    .map(payload =>
      Object.assign(payload, {
        token: raw_px ? null : stepStyleToken({
          el:       payload.el,
          prop:     style,
          kind:     'space',
          delta:    negative ? -1 : 1,
          current:  payload.current,
        })
      }))
    .map(payload =>
      Object.assign(payload, {
        padding: payload.negative
          ? payload.current - payload.amount
          : payload.current + payload.amount
      }))
    .forEach(({el, token, padding}) =>
      editStyle(el, style, token
        ? token.css
        : `${padding < 0 ? 0 : padding}px`, 'padding'))
}

export function padAllElementSides(els, keycommand) {
  const combo = keycommand.split('+')
  let spoof = ''

  if (combo.includes('shift'))  spoof = 'shift+' + spoof
  if (combo.includes('down'))   spoof = 'alt+' + spoof

  'up,down,left,right'.split(',')
    .forEach(side => padElement(els, spoof + side))
}

function paintBackgrounds(els) {
  els.forEach(el => {
    const label_id = el.getAttribute('data-label-id')

    document
      .querySelector(`visbug-handles[data-label-id="${label_id}"]`)
      .backdrop = {
        element:  createPaddingVisual(el),
        update:   createPaddingVisual,
      }
  })
}

function removeBackgrounds(els) {
  els.forEach(el => {
    const label_id = el.getAttribute('data-label-id')
    const boxmodel = document.querySelector(`visbug-handles[data-label-id="${label_id}"]`)
      .$shadow.querySelector('visbug-boxmodel')

    if (boxmodel) boxmodel.remove()
  })
}

export function createPaddingVisual(el, hover = false) {
  const bounds            = el.getBoundingClientRect()
  const calculatedStyle   = getStyle(el, 'padding')
  const calculatedBorder   = expandBorders(getStyle(el, 'border-width'))
  const boxdisplay        = document.createElement('visbug-boxmodel')

  if (calculatedStyle !== '0px') {
    const sides = {
      top:    getStyle(el, 'paddingTop'),
      right:  getStyle(el, 'paddingRight'),
      bottom: getStyle(el, 'paddingBottom'),
      left:   getStyle(el, 'paddingLeft'),
    }

    Object.entries(sides).forEach(([side, val]) => {
      if (typeof val !== 'number')
        val = parseInt(getStyle(el, 'padding'+'-'+side).slice(0, -2))

      sides[side] = Math.round(val.toFixed(1) * 100) / 100
    })

    boxdisplay.position = { 
      mode: 'padding',
      color: hover ? 'purple' : 'pink',
      bounds, 
      sides: {
        ...sides,
        borders: calculatedBorder,
      },
    }
  }

  return boxdisplay
}
