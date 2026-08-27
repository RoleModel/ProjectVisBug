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

