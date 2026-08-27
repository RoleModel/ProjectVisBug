import { exportBundle, exportElement, downloadBundle } from '../core'

export const commands = [
  'export',
  'export html',
  'export css',
  'export single',
  'download',
]

export const description = 'download the page as one HTML file and one CSS file'

export default async function({ selected = [], query = '' } = {}) {
  // with a selection, hand back just that subtree — pulling a component out
  if (selected.length) {
    const html = selected.map(exportElement).join('\n')
    await navigator.clipboard?.writeText(html).catch(() => {})
    return downloadBundle({ html, filenames: { html: 'component.html' } })
  }

  if (query.includes('css')) {
    const { css, filenames } = await exportBundle()
    return downloadBundle({ css, filenames })
  }

  // "single" folds the CSS into a <style> tag for one self-contained file
  const bundle = await exportBundle({ inline: query.includes('single') })
  return downloadBundle(bundle)
}
