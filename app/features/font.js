import hotkeys from 'hotkeys-js'
import { metaKey, getStyle, showHideSelected } from '../utilities/'
import { editStyle, getAuthoredStyle, getScale, stepStyleToken, tokenName } from '../core'

const key_events = [
  ...'up,down,left,right'.split(',').flatMap(event => [event, `shift+${event}`]),
  // alt is the px escape hatch: on a page with a type scale the bare arrows
  // step the scale, and these keep the old ±1 / ±10 arithmetic available
  ...'up,down'.split(',').flatMap(event => [`alt+${event}`, `alt+shift+${event}`]),
].join(',')

const command_events = `${metaKey}+up,${metaKey}+down`

export function Font({selection}) {
  hotkeys(key_events, (e, handler) => {
    if (e.cancelBubble) return

    e.preventDefault()

    let selectedNodes = selection()
      , keys = handler.key.split('+')

    if (keys.includes('left') || keys.includes('right'))
      keys.includes('shift')
        ? changeKerning(selectedNodes, handler.key)
        : changeAlignment(selectedNodes, handler.key)
    else if (keys.includes('alt'))
      changeFontSize(selectedNodes, handler.key, { raw_px: true })
    else
      keys.includes('shift')
        ? changeLeading(selectedNodes, handler.key)
        : changeFontSize(selectedNodes, handler.key)
  })

  hotkeys(command_events, (e, handler) => {
    e.preventDefault()
    let keys = handler.key.split('+')
    changeFontWeight(selection(), keys.includes('up') ? 'up' : 'down')
  })

  hotkeys('cmd+b', e => {
    const bold = getScale('fontWeight').find(({number}) => number === 700)

    selection().forEach(el => {
      const authored = getAuthoredStyle(el, 'fontWeight')
      const is_bold  = authored == 'bold'
        || (bold && tokenName(authored) === bold.name)

      editStyle(el, 'fontWeight', is_bold
        ? null
        : bold ? bold.css : 'bold', 'bold')
    })
  })

  hotkeys('cmd+i', e => {
    selection().forEach(el =>
      editStyle(el, 'fontStyle',
        getAuthoredStyle(el, 'fontStyle') == 'italic'
          ? null
          : 'italic', 'italic'))
  })

  return () => {
    hotkeys.unbind(key_events)
    hotkeys.unbind(command_events)
    hotkeys.unbind('cmd+b,cmd+i')
    hotkeys.unbind('up,down,left,right')
  }
}

export function changeLeading(els, direction) {
  const negative = direction.split('+').includes('down')

  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      style:      'lineHeight',
      font_size:  parseFloat(getStyle(el, 'fontSize')),
      // the px path has always rounded; the ratio below must not, or a
      // 25.5px leading reads as 1.47 and re-snaps to the step it's already on
      exact:      parseFloat(getStyle(el, 'lineHeight')),
      current:    parseInt(getStyle(el, 'lineHeight')),
      amount:     1,
      negative,
    }))
    .map(payload =>
      Object.assign(payload, {
        current: payload.current == 'normal' || isNaN(payload.current)
          ? 1.14 * payload.font_size // document this choice
          : payload.current,
        exact: isNaN(payload.exact)
          ? 1.14 * payload.font_size
          : payload.exact,
      }))
    .map(payload =>
      Object.assign(payload, {
        // line-height scales are authored as unitless ratios, but what the
        // browser hands back is px — compare on the scale's own terms
        token: stepStyleToken({
          el:       payload.el,
          prop:     'lineHeight',
          kind:     'lineHeight',
          delta:    negative ? -1 : 1,
          current:  payload.exact / payload.font_size,
        }),
        value: payload.negative
          ? payload.current - payload.amount
          : payload.current + payload.amount
      }))
    .forEach(({el, style, token, value}) =>
      editStyle(el, style, token
        ? token.css
        : `${value}px`, 'leading'))
}

export function changeKerning(els, direction) {
  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      style:    'letterSpacing',
      current:  parseFloat(getStyle(el, 'letterSpacing')),
      amount:   .1,
      negative: direction.split('+').includes('left'),
    }))
    .map(payload =>
      Object.assign(payload, {
        current: payload.current == 'normal' || isNaN(payload.current)
          ? 0
          : payload.current
      }))
    .map(payload =>
      Object.assign(payload, {
        value: payload.negative
          ? (payload.current - payload.amount).toFixed(2)
          : (payload.current + payload.amount).toFixed(2)
      }))
    .forEach(({el, style, value}) =>
      editStyle(el, style, `${value <= -2 ? -2 : value}px`, 'kerning'))
}

export function changeFontSize(els, direction, { raw_px = false } = {}) {
  const keys      = direction.split('+')
  const negative  = keys.includes('down')

  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      style:    'fontSize',
      current:  parseInt(getStyle(el, 'fontSize')),
      amount:   keys.includes('shift') ? 10 : 1,
      negative,
    }))
    .map(payload =>
      Object.assign(payload, {
        token: raw_px ? null : stepStyleToken({
          el:       payload.el,
          prop:     'fontSize',
          kind:     'fontSize',
          delta:    negative ? -1 : 1,
          current:  payload.current,
        }),
        font_size: payload.negative
          ? payload.current - payload.amount
          : payload.current + payload.amount
      }))
    .forEach(({el, style, token, font_size}) =>
      editStyle(el, style, token
        ? token.css
        : `${font_size <= 6 ? 6 : font_size}px`, 'font size'))
}

const weightMap = {
  normal: 2,
  bold:   5,
  light:  0,
  "": 2,
  "100":0,"200":1,"300":2,"400":3,"500":4,"600":5,"700":6,"800":7,"900":8
}
const weightOptions = [100,200,300,400,500,600,700,800,900]

export function changeFontWeight(els, direction) {
  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      style:    'fontWeight',
      current:  getStyle(el, 'fontWeight'),
      direction: direction.split('+').includes('down'),
    }))
    .map(payload =>
      Object.assign(payload, {
        token: stepStyleToken({
          el:       payload.el,
          prop:     'fontWeight',
          kind:     'fontWeight',
          delta:    payload.direction ? -1 : 1,
          current:  parseInt(payload.current, 10),
        }),
        value: payload.direction
          ? weightMap[payload.current] - 1
          : weightMap[payload.current] + 1
      }))
    .forEach(({el, style, token, value}) =>
      editStyle(el, style, token
        ? token.css
        : weightOptions[value < 0 ? 0 : value >= weightOptions.length
          ? weightOptions.length
          : value
        ], 'font weight'))
}

const alignMap = {
  start: 0,
  left: 0,
  center: 1,
  right: 2,
}
const alignOptions = ['left','center','right']

export function changeAlignment(els, direction) {
  els
    .map(el => showHideSelected(el))
    .map(el => ({
      el,
      style:    'textAlign',
      current:  getStyle(el, 'textAlign'),
      direction: direction.split('+').includes('left'),
    }))
    .map(payload =>
      Object.assign(payload, {
        value: payload.direction
          ? alignMap[payload.current] - 1
          : alignMap[payload.current] + 1
      }))
    .forEach(({el, style, value}) =>
      editStyle(el, style, alignOptions[value < 0 ? 0 : value >= 2 ? 2: value], 'text align'))
}
