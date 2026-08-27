import { setStyle, setStyles, clearStyles } from './style-store'
import { noteStyle } from './changes'
import * as history from './history'

/**
 * Set a style *and* journal it. This is what feature modules call —
 * it's the drop-in replacement for `el.style[prop] = value`.
 *
 * `label` groups rapid edits into one undo entry, so holding an arrow key
 * to nudge padding costs one cmd+Z, not forty.
 */
export const editStyle = (el, prop, value, label = prop) => {
  // capture what the page had here before we overwrite it
  noteStyle(el, prop)

  const change = setStyle(el, prop, value)
  history.record(change, label)
  return change
}

export const editStyles = (el, styles, label = 'styles') => {
  Object.keys(styles).forEach(prop => noteStyle(el, prop))

  const changes = setStyles(el, styles)
  history.record(changes, label)
  return changes
}

export const editClearStyles = (el, label = 'clear styles') => {
  const changes = clearStyles(el)
  history.record(changes, label)
  return changes
}
