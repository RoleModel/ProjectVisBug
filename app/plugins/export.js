import { exportDocument, exportElement } from '../core'

export const commands = [
  'export',
  'export html',
  'export css',
  'download',
]

export const description = 'export the edited page as HTML + CSS'

const download = (filename, text, type = 'text/html') => {
  const url  = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')

  Object.assign(link, { href: url, download: filename })
  document.body.appendChild(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}

export default async function({ selected = [], query = '' } = {}) {
  // "/export css" hands back just the stylesheet
  if (query.includes('css')) {
    const { css } = exportDocument({ inline: false })

    if (!css) return console.info('VisBug: nothing edited yet, no CSS to export')

    await navigator.clipboard?.writeText(css).catch(() => {})
    download('design.css', css, 'text/css')
    return
  }

  // with a selection, export just that subtree — handy for pulling a component out
  if (selected.length) {
    const html = selected.map(exportElement).join('\n')
    await navigator.clipboard?.writeText(html).catch(() => {})
    download('component.html', html)
    return
  }

  const { html } = exportDocument({ inline: true })
  download('design.html', html)
}
