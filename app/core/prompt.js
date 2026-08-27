import { getDoc, getWin } from './context'
import { collectChanges } from './changes'

/**
 * Turns a VisBug session into a prompt you can hand to a coding agent.
 *
 * The hard part isn't listing the edits, it's saying *which element* each
 * one belongs to in a way that survives the trip from a rendered page back
 * to source. No single selector does that reliably — an nth-child path is
 * unique but meaningless in a component file, a class is meaningful but may
 * repeat, a test id is ideal but often absent. So each element ships with
 * every anchor we can establish, ordered by how well it tends to map onto
 * source, and the agent picks whichever fits the codebase in front of it.
 */

const PREAMBLE = `I used a browser design tool to make visual edits to a running page, and I
need those edits applied to the source code.

Each change below names one element, several independent ways to locate it,
and the CSS properties I altered with their before and after values.

How to work through this:

1. Locate each element in the source. The anchors are ordered by how
   reliably they map back to code — an id or test attribute is usually
   decisive, the opening tag is the most greppable, and the DOM path is a
   last resort that is unique but says nothing about which component owns it.
2. Apply each change the way that codebase normally expresses styling —
   its stylesheet, CSS module, styled-component, utility classes, whatever
   is already in use. Do not paste the raw CSS below unless that genuinely
   matches the existing conventions.
3. The "before" values are the computed values at the time of the edit, so
   they tell you what the source currently produces. Use them to confirm you
   have found the right rule before you change it — if the source says
   something different, you are probably looking at the wrong declaration.
4. If an element cannot be located confidently, say so rather than guessing.

Ask me before making changes that go beyond what is listed.`

const describeMove = (moved, describe) => {
  const from = moved.from
  const to   = moved.to

  const parentName = parent => {
    if (!parent) return '(detached)'
    if (parent.id) return `#${parent.id}`

    const classes = [...parent.classList].filter(c => !c.startsWith('vb-'))
    return classes.length
      ? `${parent.tagName.toLowerCase()}.${classes.join('.')}`
      : parent.tagName.toLowerCase()
  }

  return from.parent === to.parent
    ? `Reordered inside \`${parentName(to.parent)}\`: was child ${from.index + 1}, now child ${to.index + 1}.`
    : `Moved from \`${parentName(from.parent)}\` (child ${from.index + 1}) into \`${parentName(to.parent)}\` (child ${to.index + 1}).`
}

const anchorLines = ({ id, testAttr, selector, path, within, markup, text, attributes }) => {
  const lines = []

  if (testAttr) lines.push(`- test attribute: \`${testAttr}\``)
  if (id)       lines.push(`- id: \`${id}\``)
  if (selector) lines.push(`- css selector: \`${selector}\``)

  lines.push(`- opening tag: \`${markup}\``)

  if (text) lines.push(`- text content: "${text}"`)

  const extras = Object.entries(attributes)
  if (extras.length)
    lines.push(`- attributes: ${extras.map(([k, v]) => `${k}="${v}"`).join(', ')}`)

  if (within) lines.push(`- sits inside: \`${within}\``)

  lines.push(`- dom path: \`${path}\``)

  return lines.join('\n')
}

const styleTable = styles => [
  '| property | before | after |',
  '| --- | --- | --- |',
  ...styles.map(({ prop, before, after }) => `| \`${prop}\` | \`${before}\` | \`${after}\` |`),
].join('\n')

const changeBlock = (change, index) => {
  const { describe, styles, moved, removed, created } = change

  const heading = `### ${index + 1}. \`<${describe.tag}>\`${
    describe.text ? ` — "${describe.text.slice(0, 40)}${describe.text.length > 40 ? '…' : ''}"` : ''}`

  const parts = [heading, '', '**Where:**', anchorLines(describe)]

  if (removed) {
    parts.push('', '**Change:** this element was deleted.')
    return parts.join('\n')
  }

  if (created)
    parts.push('', '**Change:** this element was newly added.')

  if (moved)
    parts.push('', `**Moved:** ${describeMove(moved, describe)}`)

  if (styles.length)
    parts.push('', '**Style changes:**', '', styleTable(styles))

  return parts.join('\n')
}

/** The raw CSS, as a fallback for anyone who wants to paste it verbatim. */
const rawCSS = changes => changes
  .filter(c => c.styles.length && !c.removed)
  .map(c => {
    const selector = c.describe.testAttr || c.describe.id || c.describe.selector || c.describe.path
    const body = c.styles.map(({ prop, after }) => `  ${prop}: ${after};`).join('\n')
    return `${selector} {\n${body}\n}`
  })
  .join('\n\n')

/**
 * @returns {{ text: string, count: number }} the prompt, and how many
 *   elements it covers (0 means nothing has been edited yet)
 */
export const buildPrompt = () => {
  const changes = collectChanges()

  if (!changes.length)
    return { text: '', count: 0 }

  const doc = getDoc()
  const url = getWin().location?.href || '(unknown page)'

  const body = changes.map(changeBlock).join('\n\n---\n\n')

  const css = rawCSS(changes)

  const text = [
    '# Design changes to apply',
    '',
    PREAMBLE,
    '',
    `**Page:** ${url}`,
    `**Title:** ${doc.title || '(untitled)'}`,
    `**Elements changed:** ${changes.length}`,
    '',
    '---',
    '',
    body,
    // only worth appending when something actually restyled
    ...(css ? [
      '',
      '---',
      '',
      '## The same changes as plain CSS',
      '',
      'Reference only — prefer expressing these the way the codebase already does.',
      '',
      '```css',
      css,
      '```',
    ] : []),
  ].join('\n')

  return { text, count: changes.length }
}

/** Build the prompt and put it on the clipboard. */
export const copyPrompt = async () => {
  const { text, count } = buildPrompt()

  if (!count) return { copied: false, count: 0 }

  await navigator.clipboard.writeText(text)
  return { copied: true, count, text }
}
