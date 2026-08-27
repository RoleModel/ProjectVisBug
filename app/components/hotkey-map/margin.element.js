import { HotkeyMap } from './base.element'
import { metaKey, altKey }   from '../../utilities/'
import { hasScale }         from '../../core'

export class MarginHotkeys extends HotkeyMap {
  constructor() {
    super()

    this._hotkey    = 'm'
    this._usedkeys  = ['shift',metaKey,altKey]

    this.tool       = 'margin'
  }

  // bare arrows walk the page's spacing scale when it has one; shift is what
  // still counts in pixels
  amountFor({hotkeys}) {
    return !hotkeys.shift && hasScale('space')
      ? 'one scale step'
      : super.amountFor({hotkeys})
  }
}

customElements.define('hotkeys-margin', MarginHotkeys)
