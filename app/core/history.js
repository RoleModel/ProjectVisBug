import { setStyle } from './style-store'

/**
 * Undo/redo journal.
 *
 * Features don't call commit() directly for style edits — they hand records
 * to record(), and rapid-fire edits (arrow-key nudges, slider drags) coalesce
 * into a single entry after a brief idle window. Structural edits that must be
 * atomic (a drag-drop, a group, a duplicate) wrap themselves in transact().
 */

const COALESCE_MS = 400

const state = {
  undos:    [],
  redos:    [],
  pending:  null,   // { label, changes[], timer }
  depth:    0,      // transact() nesting
  txn:      null,
  applying: false,
  listeners: new Set(),
}

const MAX_ENTRIES = 200

const anchor = node => node?.parentNode
  ? { parent: node.parentNode, next: node.nextSibling }
  : null

const place = (node, at) =>
  at
    ? at.parent.insertBefore(node, at.next && at.next.parentNode === at.parent ? at.next : null)
    : node.remove()

const notify = () =>
  state.listeners.forEach(fn => fn({
    canUndo: canUndo(),
    canRedo: canRedo(),
  }))

const push = entry => {
  if (!entry.changes.length) return

  state.undos.push(entry)
  if (state.undos.length > MAX_ENTRIES) state.undos.shift()
  state.redos.length = 0
  notify()
}

const flush = () => {
  if (!state.pending) return

  clearTimeout(state.pending.timer)
  const { label, changes } = state.pending
  state.pending = null
  push({ label, changes })
}

/**
 * Journal a change record. Accepts a single record, an array, or nulls
 * (setStyle returns null for no-ops) so call sites can stay terse.
 */
export const record = (changes, label = 'edit') => {
  if (state.applying) return

  const list = (Array.isArray(changes) ? changes : [changes]).filter(Boolean)
  if (!list.length) return

  if (state.txn) {
    state.txn.changes.push(...list)
    return
  }

  if (state.pending && state.pending.label === label) {
    clearTimeout(state.pending.timer)
    state.pending.changes.push(...list)
  }
  else {
    flush()
    state.pending = { label, changes: list, timer: null }
  }

  state.pending.timer = setTimeout(flush, COALESCE_MS)
}

/**
 * Bracket a continuous gesture (a drag, a slider sweep) so every edit inside
 * it becomes ONE undo entry no matter how long it runs. transact() can't do
 * this — it needs the whole operation to finish inside a single call.
 */
export const beginGesture = (label = 'gesture') => {
  flush()
  if (state.depth++ === 0)
    state.txn = { label, changes: [] }
}

export const endGesture = () => {
  if (state.depth === 0) return
  if (--state.depth === 0) {
    const txn = state.txn
    state.txn = null
    push(txn)
  }
}

/** Run fn, collecting everything it records into one undoable entry. */
export const transact = (label, fn) => {
  flush()

  if (state.depth++ === 0)
    state.txn = { label, changes: [] }

  try {
    return fn()
  }
  finally {
    if (--state.depth === 0) {
      const txn = state.txn
      state.txn = null
      push(txn)
    }
  }
}

/**
 * Move/insert/remove a node and journal it. `apply` does the DOM work.
 * Pass a node that is not yet in the tree to journal an insert.
 */
export const recordDOM = (node, apply, label = 'move') => {
  const from = anchor(node)
  apply()
  const to = anchor(node)

  if (from?.parent === to?.parent && from?.next === to?.next) return

  record({ type: 'dom', node, from, to }, label)
}

export const recordAttr = (el, name, apply, label = 'attribute') => {
  const before = el.getAttribute(name)
  apply()
  const after = el.getAttribute(name)

  if (before === after) return
  record({ type: 'attr', el, name, before, after }, label)
}

export const recordText = (el, apply, label = 'text') => {
  const before = el.innerHTML
  apply()
  const after = el.innerHTML

  if (before === after) return
  record({ type: 'text', el, before, after }, label)
}

const applyChange = (change, direction) => {
  const key = direction === 'undo' ? 'before' : 'after'

  switch (change.type) {
    case 'style':
      setStyle(change.el, change.prop, change[key])
      break

    case 'dom':
      place(change.node, direction === 'undo' ? change.from : change.to)
      break

    case 'attr':
      change[key] == null
        ? change.el.removeAttribute(change.name)
        : change.el.setAttribute(change.name, change[key])
      break

    case 'text':
      change.el.innerHTML = change[key]
      break
  }
}

export const canUndo = () => !!(state.undos.length || state.pending)
export const canRedo = () => !!state.redos.length

export const undo = () => {
  flush()

  const entry = state.undos.pop()
  if (!entry) return false

  state.applying = true
  // reverse order so nested structural changes unwind correctly
  ;[...entry.changes].reverse().forEach(c => applyChange(c, 'undo'))
  state.applying = false

  state.redos.push(entry)
  notify()
  return true
}

export const redo = () => {
  const entry = state.redos.pop()
  if (!entry) return false

  state.applying = true
  entry.changes.forEach(c => applyChange(c, 'redo'))
  state.applying = false

  state.undos.push(entry)
  notify()
  return true
}

export const onChange = fn => {
  state.listeners.add(fn)
  return () => state.listeners.delete(fn)
}

export const clear = () => {
  if (state.pending) clearTimeout(state.pending.timer)
  state.undos.length = 0
  state.redos.length = 0
  state.pending = null
  state.txn = null
  state.depth = 0
  notify()
}

/** Introspection for tests. */
export const size = () => ({
  undos: state.undos.length + (state.pending ? 1 : 0),
  redos: state.redos.length,
})
