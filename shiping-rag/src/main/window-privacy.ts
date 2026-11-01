import type { BrowserWindow } from 'electron'

let stealthEnabled = true
const windows = new Map<BrowserWindow, { title: string; primary: boolean }>()

/** Windows can lose capture protection after a soft-hide; reset it when restoring. */
export function applyContentProtection(window: BrowserWindow, forceReset = false): void {
  if (window.isDestroyed()) return
  if (stealthEnabled && forceReset && process.platform === 'win32') {
    window.setContentProtection(false)
  }
  window.setContentProtection(stealthEnabled)
}

function applyWindowPrivacy(window: BrowserWindow, title: string, primary: boolean): void {
  if (window.isDestroyed()) return
  applyContentProtection(window)
  // Chromium's share-window picker omits untitled windows even without content protection.
  window.setTitle(stealthEnabled ? '' : title)
  if (primary) {
    window.setSkipTaskbar(stealthEnabled)
    if (process.platform === 'darwin') window.setHiddenInMissionControl(stealthEnabled)
  }
}

/** Every app window follows the preference, including ones created after a toggle. */
export function registerStealthWindow(window: BrowserWindow, title: string, primary = false): void {
  windows.set(window, { title, primary })
  applyWindowPrivacy(window, title, primary)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(stealthEnabled ? '' : title)
  })
  window.once('closed', () => windows.delete(window))
}

export function setStealthEnabled(enabled: boolean): void {
  stealthEnabled = enabled
  for (const [window, { title, primary }] of windows) {
    applyWindowPrivacy(window, title, primary)
  }
}
