import {gimmeToggle} from "./contextmenu/launcher.js"
import {getColorMode} from "./contextmenu/colormode.js"
import {getColorScheme} from "./contextmenu/colorscheme.js"

var platform = typeof browser === 'undefined'
  ? chrome
  : browser

// The preferences ride over runtime.sendMessage, so they can only land once
// toolbar/inject.js has registered its listener. Firing them off alongside
// executeScript raced it, and the loser was silent: your colour mode and theme
// simply didn't apply on the first launch in a tab.
const pushPreferences = () => {
  getColorMode()
  getColorScheme()
}

// Whether VisBug is already loaded in this tab, and if so, currently shown.
// The background service worker gets killed and restarted by the browser
// whenever it's idle, wiping any in-memory bookkeeping, so the tab itself —
// not worker memory — has to be the source of truth. `null` means no content
// script answered at all (never loaded here, or the page navigated since).
const status = tab_id =>
  platform.tabs.sendMessage(tab_id, {action: 'PING'}).catch(() => null)

const toggle = async ({id:tab_id}) => {
  const loaded = await status(tab_id)

  // it's currently shown: hide it
  if (loaded?.injected) {
    await platform.scripting.executeScript({
      target: {tabId: tab_id},
      files: ['toolbar/eject.js'],
    })
  }

  // it's loaded but hidden: show it again
  else if (loaded) {
    await platform.scripting.executeScript({
      target: {tabId: tab_id},
      files: ['toolbar/restore.js'],
    })
    pushPreferences()
  }

  // fresh start in tab
  else {
    await platform.scripting.insertCSS({
      target: {tabId: tab_id},
      files: ['toolbar/bundle.css' ],
    })
    await platform.scripting.executeScript({
      target: {tabId: tab_id},
      files: ['toolbar/inject.js'],
    })

    pushPreferences()
  }
}

const toggleIn = tab =>
  toggle(tab).catch(why => {
    // Almost always "this page is off-limits to extensions": a chrome:// or
    // Web Store tab, a PDF viewer, or a file:// URL while "Allow access to
    // file URLs" is switched off for VisBug in chrome://extensions.
    //
    // There's nothing to recover — status() re-checks the tab fresh on the
    // next click regardless. Say it once rather than leaving an uncaught
    // rejection on the worker.
    console.warn('VisBug could not launch in this tab:', why?.message ?? why)
  })

gimmeToggle(toggleIn)
