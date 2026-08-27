import {gimmeToggle} from "./contextmenu/launcher.js"
import {getColorMode} from "./contextmenu/colormode.js"
import {getColorScheme} from "./contextmenu/colorscheme.js"

const state = {
  loaded:   {},
  injected: {},
}

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

const toggle = async ({id:tab_id}) => {
  // toggle out: it's currently loaded and injected
  if (state.loaded[tab_id] && state.injected[tab_id]) {
    await platform.scripting.executeScript({
      target: {tabId: tab_id},
      files: ['toolbar/eject.js'],
    })
    state.injected[tab_id] = false
  }

  // toggle in: it's loaded and needs injected
  else if (state.loaded[tab_id] && !state.injected[tab_id]) {
    await platform.scripting.executeScript({
      target: {tabId: tab_id},
      files: ['toolbar/restore.js'],
    })
    state.injected[tab_id] = true
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

    state.loaded[tab_id]    = true
    state.injected[tab_id]  = true
    pushPreferences()
  }

  platform.tabs.onUpdated.addListener(function(tabId) {
    if (tabId === tab_id)
      state.loaded[tabId] = false
  })
}

const toggleIn = tab =>
  toggle(tab).catch(why => {
    // Almost always "this page is off-limits to extensions": a chrome:// or
    // Web Store tab, a PDF viewer, or a file:// URL while "Allow access to
    // file URLs" is switched off for VisBug in chrome://extensions.
    //
    // There's nothing to recover — the state flags are set after the awaits,
    // so a failed launch leaves them untouched and the next click retries.
    // Say it once rather than leaving an uncaught rejection on the worker.
    console.warn('VisBug could not launch in this tab:', why?.message ?? why)
  })

gimmeToggle(toggleIn)
