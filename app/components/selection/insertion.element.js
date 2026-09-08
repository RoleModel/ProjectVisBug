import { InsertionStyles } from '../styles.store'

/**
 * The drop indicator for layout-aware dragging.
 *
 * Unlike the other selection overlays it isn't anchored to an element —
 * an insertion point lives *between* elements, so it takes a raw rect from
 * the resolver in app/features/dropzones.js.
 *
 *   kind 'bar'       the caret shown between siblings in flex/block flow
 *   kind 'cell'      a grid cell about to receive the element
 *   kind 'container' the container that would accept the drop
 *
 *   axis 'x'         a vertical bar (inserting along a horizontal/row axis)
 *   axis 'y'         a horizontal bar (inserting along a vertical/column axis)
 */
export class Insertion extends HTMLElement {

  constructor() {
    super()
    this.$shadow = this.attachShadow({ mode: 'closed' })
  }

  connectedCallback() {
    this.$shadow.adoptedStyleSheets = [InsertionStyles]
    this.setAttribute('popover', 'manual')
    this.showPopover && this.showPopover()
  }

  disconnectedCallback() {
    this.hidePopover && this.hidePopover()
  }

  set placement({ rect, kind = 'bar', axis = 'y', isFixed = false }) {
    this.setAttribute('kind', kind)
    this.setAttribute('axis', axis)

    this.style.setProperty('--position', isFixed ? 'fixed' : 'absolute')
    this.style.setProperty('--top',    `${rect.top + (isFixed ? 0 : window.scrollY)}px`)
    this.style.setProperty('--left',   `${rect.left + (isFixed ? 0 : window.scrollX)}px`)
    this.style.setProperty('--width',  `${rect.width}px`)
    this.style.setProperty('--height', `${rect.height}px`)

    this.$shadow.innerHTML = kind === 'bar'
      ? `<div class="indicator"></div><i class="cap start"></i><i class="cap end"></i>`
      : `<div class="indicator"></div>`
  }
}

customElements.define('visbug-insertion', Insertion)
