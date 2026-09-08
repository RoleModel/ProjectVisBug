import puppeteer from 'puppeteer'

export const setupPptrTab = async t => {
  t.context.browser  = await puppeteer.launch({
    // headless: false,
    args: ['--no-sandbox']
  })
  t.context.page     = await t.context.browser.newPage()

  await t.context.page.goto('http://localhost:3000')
  await t.context.page.evaluateHandle(`document.body.setAttribute('testing', true)`)
  await t.context.page.waitForSelector('vis-bug')
}

export const teardownPptrTab = async ({context:{ page, browser }}) => {
  await page.close()
}

export const changeMode = async ({page, tool}) =>
  await page.evaluateHandle(`
    var mouseUpEvent = document.createEvent("MouseEvents");
    mouseUpEvent.initEvent("mouseup", true, true);
    document.querySelector('vis-bug').$shadow.querySelector('li[data-tool=${tool}]').dispatchEvent(mouseUpEvent);
  `)

export const getActiveTool = async page =>
  await page.$eval('vis-bug', el =>
    el.activeTool)

export const pptrMetaKey = async page => {
  let isMac = await page.evaluate(_ => window.navigator.platform.includes('Mac'))
  return isMac ? "Meta" : "Control"
}
/**
 * Style edits no longer land on `el.style` — app/core/style-store.js writes
 * them into an editor-owned adopted stylesheet keyed by a generated class.
 * Tests read the authored value back through here.
 */
export const readStyle = async (page, selector, prop) =>
  await page.$eval(selector, (el, prop) => {
    const id = el.getAttribute('data-vb-id')
    if (!id) return el.style[prop] || ''

    const name = prop.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const selector_text = `.${id}`.repeat(3)

    for (const sheet of document.adoptedStyleSheets)
      for (const rule of sheet.cssRules)
        if (rule.selectorText === selector_text)
          return rule.style.getPropertyValue(name)

    return el.style[prop] || ''
  }, prop)

/** Boots a tab on the layout fixture used by the drop-resolver tests. */
export const setupFixtureTab = async (t, fixture = 'dropzones.html') => {
  t.context.browser = await puppeteer.launch({ args: ['--no-sandbox'] })
  t.context.page    = await t.context.browser.newPage()

  await t.context.page.setViewport({ width: 1200, height: 900 })
  await t.context.page.goto(`http://localhost:3000/${fixture}`)
  await t.context.page.waitForSelector('vis-bug')
}

/** Center of an element, in viewport coordinates. */
export const centerOf = async (page, selector, index = 0) =>
  await page.evaluate((selector, index) => {
    const el = document.querySelectorAll(selector)[index]
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, selector, index)

/** A point at a fraction across an element's box. */
export const pointIn = async (page, selector, index, fx, fy) =>
  await page.evaluate((selector, index, fx, fy) => {
    const el = document.querySelectorAll(selector)[index]
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width * fx), y: Math.round(r.top + r.height * fy) }
  }, selector, index, fx, fy)

/**
 * A real pointer drag. The first small move is what pushes past move.js's
 * DRAG_THRESHOLD and promotes the press into a drag.
 */
export const dragFromTo = async (page, from, to) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 6, from.y)
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

export const childText = async (page, selector) =>
  await page.$$eval(selector, els => els.map(el => el.textContent.trim()))
