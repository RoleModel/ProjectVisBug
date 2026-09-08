var platform = typeof browser === 'undefined'
  ? chrome
  : browser

var toggleIt

export const gimmeToggle = toggleIn => {
  toggleIt = toggleIn
  platform.action.onClicked.addListener(toggleIt)
}

// onInstalled fires once per install/update/enable — not on every service
// worker wake-up — so this runs exactly once, unlike top-level code.
platform.runtime.onInstalled.addListener(() => {
  platform.contextMenus.create({
    id:     'launcher',
    title:  'Show/Hide',
    contexts: ['all'],
  })
})

platform.contextMenus.onClicked.addListener(({menuItemId}, tab) => {
  if (menuItemId === 'launcher')
    toggleIt(tab)
})
