/**
 * Single source of truth for "which document are we editing?"
 *
 * Today this is always the host page's document. Phase 3 (standalone shell)
 * swaps in the canvas iframe's document by calling setDoc() once — every
 * feature that goes through here follows along for free.
 */

let target_doc = typeof document !== 'undefined' ? document : null

export const getDoc = () =>
  target_doc

export const getWin = () =>
  target_doc?.defaultView ?? (typeof window !== 'undefined' ? window : null)

export const setDoc = doc => {
  target_doc = doc
  return target_doc
}
