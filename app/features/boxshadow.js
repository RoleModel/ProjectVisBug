import hotkeys from 'hotkeys-js'
import { metaKey, getStyle, showHideSelected } from '../utilities/'
import { editStyle, getAuthoredStyle, stepScaleFrom } from '../core'

const key_events = 'up,down,left,right'
  .split(',')
  .reduce((events, event) =>
    `${events},${event},shift+${event},alt+${event},alt+shift+${event}`
  , '')
  .substring(1)

const command_events = `${metaKey}+up,${metaKey}+shift+up,${metaKey}+down,${metaKey}+shift+down,${metaKey}+left,${metaKey}+shift+left,${metaKey}+right,${metaKey}+shift+right`

// Shadows and radii come out of a design system as whole values, not as a pile
// of offsets you dial in — so they get their own keys rather than sharing the
// arrows with the per-component editing above.
const token_events = '[,],shift+[,shift+]'

export function BoxShadow({selection}) {
  hotkeys(key_events, (e, handler) => {
    if (e.cancelBubble) return

    e.preventDefault()

    let selectedNodes = selection()
      , keys = handler.key.split('+')

    if (keys.includes('left') || keys.includes('right'))
      keys.includes('alt')
        ? changeBoxShadow(selectedNodes, keys, 'size')
        : changeBoxShadow(selectedNodes, keys, 'x')
    else
      keys.includes('alt')
        ? changeBoxShadow(selectedNodes, keys, 'blur')
        : changeBoxShadow(selectedNodes, keys, 'y')
  })

  hotkeys(command_events, (e, handler) => {
    e.preventDefault()
    let keys = handler.key.split('+')
    keys.includes('left') || keys.includes('right')
      ? changeBoxShadow(selection(), keys, 'opacity')
      : changeBoxShadow(selection(), keys, 'inset')
  })

  hotkeys(token_events, (e, handler) => {
    if (e.cancelBubble) return

    e.preventDefault()

    const keys  = handler.key.split('+')
    const delta = keys.includes(']') ? 1 : -1

    keys.includes('shift')
      ? stepToken(selection(), 'borderRadius', 'radius', delta)
      : stepToken(selection(), 'boxShadow',    'shadow', delta)
  })

  return () => {
    hotkeys.unbind(key_events)
    hotkeys.unbind(command_events)
    hotkeys.unbind(token_events)
    hotkeys.unbind('up,down,left,right')
  }
}

/**
 * Walk `prop` along a named scale the page already defines. No scale, no edit —
 * we'd rather do nothing than invent a shadow the design system never had.
 */
const stepToken = (els, prop, kind, delta) =>
  els
    .map(el => showHideSelected(el, 1500))
    .forEach(el => {
      const token = stepScaleFrom({ el, prop, kind, delta })
      if (token) editStyle(el, prop, token.css, kind)
    })

const ensureHasShadow = el => {
  const current = getAuthoredStyle(el, 'boxShadow')
  if (current == '' || current == 'none')
    editStyle(el, 'boxShadow', 'hsla(0,0%,0%,30%) 0 0 0 0', 'box shadow')
  return el
}

// todo: work around this propMap with a better split
const propMap = {
  'opacity':  3,
  'x':        4,
  'y':        5,
  'blur':     6,
  'size':     7,
  'inset':    8,
}

const parseCurrentShadow = el => getStyle(el, 'boxShadow').split(' ')

export function changeBoxShadow(els, direction, prop) {
  els
    .map(ensureHasShadow)
    .map(el => showHideSelected(el, 1500))
    .map(el => ({
      el,
      style:     'boxShadow',
      current:   parseCurrentShadow(el), // ["rgb(255,", "0,", "0)", "0px", "0px", "1px", "0px"]
      propIndex: parseCurrentShadow(el)[0].includes('rgba') ? propMap[prop] : propMap[prop] - 1
    }))
    .map(payload => {
      let updated = [...payload.current]
      let cur     = prop === 'opacity'
        ? payload.current[payload.propIndex]
        : parseInt(payload.current[payload.propIndex])

      switch(prop) {
        case 'blur': 
        case 'size':
          var amount = direction.includes('shift') ? 10 : 1
          updated[payload.propIndex] = direction.includes('down') || direction.includes('left')
            ? `${cur - amount}px`
            : `${cur + amount}px`
          break
        case 'inset':
          updated[payload.propIndex] = direction.includes('down')
            ? 'inset'
            : ''
          break
        case 'opacity':
          let cur_opacity = parseFloat(cur.slice(0, cur.indexOf(')')))
          var amount = direction.includes('shift') ? 0.10 : 0.01
          updated[payload.propIndex] = direction.includes('left')
            ? cur_opacity - amount + ')'
            : cur_opacity + amount + ')'
          break
        default:
          var amount = direction.includes('shift') ? 10 : 1
          updated[payload.propIndex] = direction.includes('left') || direction.includes('up')
            ? `${cur - amount}px`
            : `${cur + amount}px`
          break
      }

      payload.value = updated
      return payload
    })
    .forEach(({el, style, value}) =>
      editStyle(el, style, value.join(' '), 'box shadow'))
}
