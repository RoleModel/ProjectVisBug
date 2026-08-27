import test from 'ava'

import {
  setupFixtureTab, teardownPptrTab, changeMode,
  centerOf, pointIn, dragFromTo, childText,
} from '../../tests/helpers'

const tool = 'move'

test.beforeEach(async t => {
  await setupFixtureTab(t)
  await changeMode({ tool, page: t.context.page })
})

test('flex row: drops past the last item append it', async t => {
  const { page } = t.context

  t.deepEqual(await childText(page, '#flex-row .box'), ['one', 'two', 'three'])

  const start = await pointIn(page, '#flex-row .box', 0, 0.5, 0.5)
  const end   = await pointIn(page, '#flex-row .box', 2, 0.95, 0.5)

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.deepEqual(await childText(page, '#flex-row .box'), ['two', 'three', 'one'])
})

test('flex row: drops before an item insert, not swap', async t => {
  const { page } = t.context

  // the old implementation swapped siblings; inserting is the difference
  const start = await pointIn(page, '#flex-row .box', 2, 0.5, 0.5)
  const end   = await pointIn(page, '#flex-row .box', 0, 0.1, 0.5)

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.deepEqual(await childText(page, '#flex-row .box'), ['three', 'one', 'two'])
})

test('flex column: resolves along the vertical axis', async t => {
  const { page } = t.context

  const start = await pointIn(page, '#flex-col .box', 0, 0.5, 0.5)
  const end   = await pointIn(page, '#flex-col .box', 2, 0.5, 0.95)

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.deepEqual(await childText(page, '#flex-col .box'), ['two', 'three', 'one'])
})

test('grid: an auto-flow grid reorders without pinning cells', async t => {
  const { page } = t.context

  const start = await pointIn(page, '#grid-auto .box', 0, 0.5, 0.5)
  const end   = await pointIn(page, '#grid-auto .box', 3, 0.5, 0.5)

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.deepEqual(await childText(page, '#grid-auto .box'), ['two', 'three', 'four', 'one'])

  // auto-placement must be preserved — no explicit grid-column/row written
  const pinned = await page.$$eval('#grid-auto .box', els =>
    els.some(el => el.style.gridColumn || el.style.gridRow))
  t.false(pinned)
})

test('empty container accepts a drop', async t => {
  const { page } = t.context

  // the old drag bailed out entirely when there were no siblings to swap with
  const start = await pointIn(page, '#flex-row .box', 0, 0.5, 0.5)
  const end   = await centerOf(page, '#empty')

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.deepEqual(await childText(page, '#empty > *'), ['one'])
})

test('a drag is one undo step', async t => {
  const { page } = t.context

  const before = await childText(page, '#flex-row .box')

  const start = await pointIn(page, '#flex-row .box', 0, 0.5, 0.5)
  const end   = await pointIn(page, '#flex-row .box', 2, 0.95, 0.5)

  await page.mouse.click(start.x, start.y)
  await dragFromTo(page, start, end)

  t.notDeepEqual(await childText(page, '#flex-row .box'), before)

  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', keyCode: 90, which: 90,
      metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
    })))

  t.deepEqual(await childText(page, '#flex-row .box'), before)
})

test('a click without travel still selects rather than dragging', async t => {
  const { page } = t.context

  const before = await childText(page, '#flex-row .box')
  const at = await pointIn(page, '#flex-row .box', 1, 0.5, 0.5)

  await page.mouse.click(at.x, at.y)

  t.deepEqual(await childText(page, '#flex-row .box'), before)
  t.true(await page.$eval('#flex-row .box:nth-child(2)', el =>
    el.hasAttribute('data-selected')))
})

test.afterEach(teardownPptrTab)
