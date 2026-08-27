import { HotkeyMap } from './base.element'
import { metaKey, altKey } from '../../utilities';
import { hasScale } from '../../core'

export class BoxshadowHotkeys extends HotkeyMap {
  constructor() {
    super()

    this._hotkey    = 'd'
    this._usedkeys  = ['shift',metaKey,altKey,'[',']']
    this.tool       = 'boxshadow'
  }

  createCommand({e:{code}, hotkeys}) {
    let amount              = hotkeys.shift ? 10 : 1
    let negative            = '[increase/decrease]'
    let negative_modifier   = 'by'
    let side                = '[arrow key]'

    // whole-value tokens: a design system hands you the shadow, not its parts
    if (code === 'BracketLeft' || code === 'BracketRight') {
      side = hotkeys.shift ? 'border radius' : 'box shadow'

      if (hasScale(hotkeys.shift ? 'radius' : 'shadow')) {
        amount    = 'one scale step'
        negative  = code === 'BracketRight' ? 'increase' : 'decrease'
      }
      else {
        negative            = 'this page defines no'
        negative_modifier   = ''
        amount              = 'scale'
      }
    }
    else if (hotkeys[metaKey] && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      side      = 'shadow opacity'
      amount    = hotkeys.shift ? '10%' : '1%'
      negative  = code === 'ArrowRight' ? 'increase' : 'decrease'
    }
    else if (hotkeys[metaKey] && (code === 'ArrowUp' || code === 'ArrowDown')) {
      side                = 'inset'
      amount              = ''
      negative_modifier   = ''
      negative            = code === 'ArrowDown' ? 'set' : 'unset'
    }
    else if (code === 'ArrowLeft' || code === 'ArrowRight') {
      side      = hotkeys.alt ? 'shadow spread' : 'shadow x offset'
      amount    = `${amount}px`
      negative  = code === 'ArrowRight' ? 'increase' : 'decrease'
    }
    else if (code === 'ArrowUp' || code === 'ArrowDown') {
      side      = hotkeys.alt ? 'shadow blur' : 'shadow y offset'
      amount    = `${amount}px`
      negative  = code === 'ArrowDown' ? 'increase' : 'decrease'
    }

    return { negative, negative_modifier, amount, side }
  }

  displayCommand({negative, negative_modifier, side, amount}) {
    if (negative === `±[${altKey}] `)
      negative = '[ ] step shadow, shift+[ ] step radius'
    if (negative_modifier === ' to ')
      negative_modifier = ''

    return `
      <span negative>${negative}</span>
      <span side tool>${side === '[arrow key]' ? '' : side}</span>
      <span light>${negative_modifier}</span>
      <span amount>${amount === 1 ? '' : amount}</span>
    `
  }
}

customElements.define('hotkeys-boxshadow', BoxshadowHotkeys)
