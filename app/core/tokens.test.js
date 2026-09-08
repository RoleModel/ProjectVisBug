import test from 'ava'

import { setupFixtureTab, teardownPptrTab, changeMode, readStyle }
from '../../tests/helpers'

const on_scale  = '#on-scale'    // padding: var(--op-space-small)  -> 12px
const off_scale = '#off-scale'   // padding: 7px, between two steps

const press = async (page, key, modifiers = []) => {
  for (const modifier of modifiers) await page.keyboard.down(modifier)
  await page.keyboard.press(key)
  for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier)
}

const select = async (page, tool, selector) => {
  await changeMode({ tool, page })
  await page.click(selector)
}

test.beforeEach(async t => {
  await setupFixtureTab(t, 'optics.html')
})

test('padding steps the spacing scale instead of counting pixels', async t => {
  const { page } = t.context

  await select(page, 'padding', on_scale)
  t.is(await readStyle(page, on_scale, 'paddingTop'), '')

  await press(page, 'ArrowUp')
  t.is(await readStyle(page, on_scale, 'paddingTop'), 'var(--op-space-medium)')

  await press(page, 'ArrowUp')
  t.is(await readStyle(page, on_scale, 'paddingTop'), 'var(--op-space-large)')

  await press(page, 'ArrowUp', ['Alt'])
  t.is(await readStyle(page, on_scale, 'paddingTop'), 'var(--op-space-medium)')
})

test('a value between two steps snaps onto the scale, moving the way you asked', async t => {
  const { page } = t.context

  await select(page, 'padding', off_scale)

  // 7px sits between --op-space-2x-small (4px) and --op-space-x-small (8px)
  await press(page, 'ArrowUp')
  t.is(await readStyle(page, off_scale, 'paddingTop'), 'var(--op-space-x-small)')
})

test('shift is the escape hatch back to raw pixels', async t => {
  const { page } = t.context

  await select(page, 'padding', on_scale)

  await press(page, 'ArrowUp', ['Shift'])
  t.is(await readStyle(page, on_scale, 'paddingTop'), '22px')
})

test('margin steps the same scale', async t => {
  const { page } = t.context

  await select(page, 'margin', on_scale)

  await press(page, 'ArrowUp')
  t.is(await readStyle(page, on_scale, 'marginTop'), 'var(--op-space-3x-small)')
})

test('font size steps the type scale, and alt keeps pixels available', async t => {
  const { page } = t.context

  await select(page, 'font', on_scale)

  // font-size: var(--op-font-small) -> 14px
  await press(page, 'ArrowUp')
  t.is(await readStyle(page, on_scale, 'fontSize'), 'var(--op-font-medium)')

  await press(page, 'ArrowUp', ['Alt'])
  t.is(await readStyle(page, on_scale, 'fontSize'), '17px')
})

test('leading steps the line height scale', async t => {
  const { page } = t.context

  await select(page, 'font', on_scale)

  await press(page, 'ArrowUp', ['Shift'])
  t.is(await readStyle(page, on_scale, 'lineHeight'), 'var(--op-line-height-loose)')
})

test('brackets walk the shadow scale', async t => {
  const { page } = t.context

  await select(page, 'boxshadow', on_scale)

  await press(page, 'BracketRight')
  t.is(await readStyle(page, on_scale, 'boxShadow'), 'var(--op-shadow-x-small)')

  await press(page, 'BracketRight')
  t.is(await readStyle(page, on_scale, 'boxShadow'), 'var(--op-shadow-small)')

  await press(page, 'BracketLeft')
  t.is(await readStyle(page, on_scale, 'boxShadow'), 'var(--op-shadow-x-small)')
})

test('shift+brackets walk the radius scale', async t => {
  const { page } = t.context

  await select(page, 'boxshadow', on_scale)

  await press(page, 'BracketRight', ['Shift'])
  t.is(await readStyle(page, on_scale, 'borderRadius'), 'var(--op-radius-small)')

  await press(page, 'BracketRight', ['Shift'])
  t.is(await readStyle(page, on_scale, 'borderRadius'), 'var(--op-radius-medium)')
})

test('the color picker offers the page palette as swatches', async t => {
  const { page } = t.context

  await select(page, 'guides', on_scale)

  const swatches = await page.$eval('vis-bug', el =>
    [...el.$shadow.querySelectorAll('#token_swatches option')]
      .map(option => option.textContent))

  t.true(swatches.includes('primary base'))
  t.true(swatches.includes('alerts danger base'))
})

test('token edits export as var(), not as resolved pixels', async t => {
  const { page } = t.context

  await select(page, 'padding', on_scale)
  await press(page, 'ArrowUp')

  const css = await page.evaluate(() =>
    [...document.adoptedStyleSheets]
      .flatMap(sheet => [...sheet.cssRules])
      .map(rule => rule.cssText)
      .join('\n'))

  t.true(css.includes('padding-top: var(--op-space-medium)'))
})

test.afterEach(teardownPptrTab)
