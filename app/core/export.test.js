import test from 'ava'

import { setupFixtureTab, teardownPptrTab } from '../../tests/helpers'

test.beforeEach(async t => {
  await setupFixtureTab(t, 'export.html')

  // capture what the button hands to the browser instead of saving it
  await t.context.page.evaluate(() => {
    window.__downloads = {}
    const real = URL.createObjectURL.bind(URL)
    let last = null

    URL.createObjectURL = blob => (last = blob, real(blob))
    HTMLAnchorElement.prototype.click = function () {
      window.__downloads[this.download] = last
    }
  })
})

const clickExport = async page => {
  await page.evaluate(() =>
    document.querySelector('vis-bug').$shadow.querySelector('#export').click())

  await page.waitForFunction(() => Object.keys(window.__downloads).length === 2, { timeout: 10000 })

  return page.evaluate(async () => ({
    names: Object.keys(window.__downloads),
    html:  await window.__downloads['design.html'].text(),
    css:   await window.__downloads['design.css'].text(),
  }))
}

test('the export button produces one HTML file and one CSS file', async t => {
  const { names } = await clickExport(t.context.page)
  t.deepEqual(names.sort(), ['design.css', 'design.html'])
})

test('every stylesheet on the page is folded into the one CSS file', async t => {
  const { css } = await clickExport(t.context.page)

  t.true(css.includes('padding: 32px'),    'inline <style> block')
  t.true(css.includes('.card'),            'same-origin <link>')
  t.true(css.includes('rebeccapurple'),    '@import-ed sheet')
  t.regex(css, /@media print/,             'media="print" link is wrapped')
  t.regex(css, /Inter/,                    'cross-origin sheet was fetched')
  t.false(css.includes('could not read'),  'nothing failed to load')
})

test('relative urls survive the move to a standalone file', async t => {
  const { html, css } = await clickExport(t.context.page)

  t.regex(css, /url\("https?:\/\/[^"]+\/assets\/texture\.png"\)/)
  t.regex(html, /src="https?:\/\/[^"]+\/assets\/logo\.png"/)
})

test('the exported HTML carries no editor artifacts or scripts', async t => {
  const { html } = await clickExport(t.context.page)

  t.false(/vis-bug|visbug-/.test(html), 'no toolbar or overlays')
  t.false(/data-vb-id|data-selected/.test(html), 'no bookkeeping attributes')
  t.false(/<script/i.test(html), 'scripts stripped so the snapshot stays put')
  t.true(html.indexOf('charset') < html.indexOf('design.css'), 'charset stays first')
})

test('edits are exported once, and last so they win', async t => {
  const { page } = t.context

  await page.evaluate(() => {
    const vb = document.querySelector('vis-bug')
    const ev = document.createEvent('MouseEvents')
    ev.initEvent('mouseup', true, true)
    vb.$shadow.querySelector('li[data-tool=padding]').dispatchEvent(ev)
  })

  const card = await page.$('.card')
  await card.click()

  for (let i = 0; i < 5; i++)
    await page.keyboard.press('ArrowUp')

  await page.waitForTimeout(600)

  const { css } = await clickExport(page)
  const generated = css.match(/\.vb-[a-z0-9]+/)

  t.truthy(generated, 'the edit made it into the stylesheet')

  // one rule, not one per adopted sheet — the selector repeats 3x inside it
  const copies = css.split(`${generated[0]}.${generated[0].slice(1)}.${generated[0].slice(1)} {`).length - 1
  t.is(copies, 1)

  t.true(css.indexOf('/* VisBug edits */') > css.lastIndexOf('.card { background'))
})

test('the exported pair renders identically to the live page', async t => {
  const { page } = t.context
  const { html, css } = await clickExport(page)

  const diffs = await page.evaluate(async ({ html, css }) => {
    const frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;left:-9999px;width:1200px;height:800px'
    document.body.appendChild(frame)
    frame.srcdoc = html.replace(
      '<link rel="stylesheet" href="design.css">', `<style>${css}</style>`)

    await new Promise(resolve => frame.onload = resolve)
    await new Promise(resolve => setTimeout(resolve, 300))

    const read = (doc, selector, props) => {
      const el = doc.querySelector(selector)
      const cs = doc.defaultView.getComputedStyle(el)
      return props.reduce((o, p) => (o[p] = cs[p], o), {})
    }

    const targets = [
      ['.card', ['padding', 'backgroundColor', 'color', 'borderRadius', 'backgroundImage']],
      ['.chip', ['backgroundColor', 'borderRadius', 'padding']],
      ['.row',  ['display', 'gap']],
      ['body',  ['padding', 'margin']],
    ]

    const out = targets.flatMap(([selector, props]) => {
      const live = read(document, selector, props)
      const exported = read(frame.contentDocument, selector, props)
      return props
        .filter(p => live[p] !== exported[p])
        .map(p => `${selector} ${p}: ${live[p]} vs ${exported[p]}`)
    })

    frame.remove()
    return out
  }, { html, css })

  t.deepEqual(diffs, [])
})

test.afterEach(teardownPptrTab)
