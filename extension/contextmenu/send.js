var platform = typeof browser === 'undefined'
  ? chrome
  : browser

/**
 * Push a message at the active tab, and shrug if nobody's listening.
 *
 * The only receiver is toolbar/inject.js, which exists solely in tabs where
 * VisBug has actually been launched. Sending to any other tab rejects with
 * "Could not establish connection. Receiving end does not exist." — which is
 * the *normal* case, not a fault: every tab you haven't launched VisBug on,
 * chrome:// and Web Store pages, and file:// pages unless the extension has
 * been granted "Allow access to file URLs".
 *
 * Left unhandled it surfaces as an uncaught promise rejection against the
 * service worker, so it's swallowed here rather than at each call site.
 */
export const tellActiveTab = message =>
  platform.tabs.query({active: true, currentWindow: true}, ([tab]) => {
    if (!tab) return

    let sending

    // a tab that closed mid-query throws synchronously instead of rejecting
    try { sending = platform.tabs.sendMessage(tab.id, message) }
    catch { return }

    // chrome (no callback passed) and firefox both hand back a promise
    if (sending && typeof sending.catch === 'function')
      sending.catch(() => {})
  })
