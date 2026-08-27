import test from 'ava'

import { setupFixtureTab, teardownPptrTab, changeMode, pointIn, dragFromTo } from '../../tests/helpers'

test.beforeEach(async t => {
  await setupFixtureTab(t, 'changes.html')

  // keep the prompt out of the real clipboard so tests can read it
  await t.context.page.evaluate(() => {
    window.__copied = null
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async text => { window.__copied = text },
    })
  })
})

const clickCopy = async page => {
  await page.evaluate(() => {
    window.__copied = null
    document.querySelector('vis-bug').$shadow.querySelector('#copy-changes').click()
  })

  await page.waitForTimeout(400)

  return page.evaluate(() => ({
    text:  window.__copied,
    state: document.querySelector('vis-bug').$shadow
      .querySelector('#copy-changes').getAttribute('data-state'),
  }))
}

const nudgePadding = async (page, times = 4) => {
  await changeMode({ tool: 'padding', page })
  await (await page.$('[data-testid="hero-cta"]')).click()

  for (let i = 0; i < times; i++)
    await page.keyboard.press('ArrowUp')

  await page.waitForTimeout(600)
}

test('copies nothing when nothing has been edited', async t => {
  const { text, state } = await clickCopy(t.context.page)

  t.is(text, null)
  t.is(state, 'empty')
})

test('a style edit is reported with before and after values', async t => {
  const { page } = t.context
  await nudgePadding(page)

  const { text, state } = await clickCopy(page)

  t.is(state, 'copied')
  t.regex(text, /\*\*Elements changed:\*\* 1/)
  t.regex(text, /\| `padding-top` \| `8px` \| `12px` \|/)
})

test('an edited element carries several independent anchors', async t => {
  const { page } = t.context
  await nudgePadding(page)

  const { text } = await clickCopy(page)

  t.regex(text, /test attribute: `\[data-testid="hero-cta"\]`/)
  t.regex(text, /css selector: `button\.cta\.primary`/)
  t.regex(text, /opening tag: `<button class="cta primary" data-testid="hero-cta">`/)
  t.regex(text, /text content: "Get started"/)
  t.regex(text, /sits inside: `section#hero\.hero`/)
  t.regex(text, /dom path: `body > /)
})

test('anchors carry no editor bookkeeping', async t => {
  const { page } = t.context
  await nudgePadding(page)

  const { text } = await clickCopy(page)
  const tags = text.match(/opening tag: `[^`]+`/g) || []

  t.true(tags.length > 0)
  tags.forEach(tag => {
    t.false(/data-vb-id|data-selected|vb-[a-z0-9]{4,}/.test(tag), tag)
    t.false(/style="[^"]*(cursor|will-change)/.test(tag), tag)
    t.false(/style=""/.test(tag), tag)
  })
})

test('every reported css selector resolves to exactly one element', async t => {
  const { page } = t.context
  await nudgePadding(page)

  await changeMode({ tool: 'move', page })
  const from = await pointIn(page, '.tile', 1, 0.5, 0.5)
  const to   = await pointIn(page, '.tile', 2, 0.95, 0.5)
  await page.mouse.click(from.x, from.y)
  await dragFromTo(page, from, to)
  await page.waitForTimeout(300)

  const { text } = await clickCopy(page)

  const selectors = [...text.matchAll(/(?:css selector|test attribute|dom path): `([^`]+)`/g)]
    .map(m => m[1])

  t.true(selectors.length > 0)

  const counts = await page.evaluate(list =>
    list.map(sel => {
      try { return document.querySelectorAll(sel).length }
      catch { return -1 }
    }), selectors)

  counts.forEach((count, i) =>
    t.is(count, 1, `${selectors[i]} matched ${count} elements`))
})

test('a reorder is reported as a move', async t => {
  const { page } = t.context

  await changeMode({ tool: 'move', page })
  const from = await pointIn(page, '.tile', 1, 0.5, 0.5)
  const to   = await pointIn(page, '.tile', 2, 0.95, 0.5)
  await page.mouse.click(from.x, from.y)
  await dragFromTo(page, from, to)
  await page.waitForTimeout(300)

  const { text } = await clickCopy(page)

  t.regex(text, /\*\*Moved:\*\* Reordered inside `#grid`/)
  t.regex(text, /was child 2, now child 3/)
})

test('an undone edit drops out of the report', async t => {
  const { page } = t.context
  await nudgePadding(page)

  t.regex((await clickCopy(page)).text, /padding-top/)

  await page.evaluate(() =>
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', code: 'KeyZ', keyCode: 90, which: 90,
      metaKey: true, ctrlKey: true, bubbles: true, cancelable: true,
    })))

  await page.waitForTimeout(400)

  const { text, state } = await clickCopy(page)

  t.is(state, 'empty')
  t.is(text, null)
})

test.afterEach(teardownPptrTab)
