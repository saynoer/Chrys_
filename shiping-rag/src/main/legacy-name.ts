import { app } from 'electron'
import { existsSync, readdirSync, renameSync, rmdirSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'

/**
 * The app was interview-coder-cn (截屏解题助手) before it became shiping (识屏),
 * and a few folders are named after the package. Imported first by index.ts:
 * nothing may open the userData folder before it is settled here.
 */
const LEGACY_NAME = 'interview-coder-cn'

/**
 * userData holds the settings (localStorage) and the 资料库. The old folder is
 * moved over on the first start under the new name. If that fails (a copy of
 * the old version still running holds a file), the old folder is used where
 * it is, and the move is tried again on the next start
 */
function adoptLegacyUserData(): void {
  const appData = app.getPath('appData')
  const userData = app.getPath('userData')
  // `--user-data-dir` (the run skill's driver) picks a folder of its own
  if (userData !== join(appData, app.name)) return
  const legacy = join(appData, LEGACY_NAME)
  if (!existsSync(legacy)) return
  // Electron creates the new folder before this runs; it is empty unless this
  // version has started before
  if (existsSync(userData) && readdirSync(userData).length > 0) return
  try {
    if (existsSync(userData)) rmdirSync(userData)
    renameSync(legacy, userData)
  } catch (err) {
    console.error('Failed to move the old user data folder, using it in place:', err)
    app.setPath('userData', legacy)
  }
}

/** electron-updater's download cache on Windows, which keeps the last installer */
function removeLegacyUpdaterCache(): void {
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !localAppData) return
  rm(join(localAppData, `${LEGACY_NAME}-updater`), { recursive: true, force: true }).catch((err) =>
    console.error('Failed to remove the old updater cache:', err)
  )
}

// This fork always isolates trial data; never migrate the official application's data.
app.setPath(
  'userData',
  process.env.SHIPING_RAG_USER_DATA ||
    join(app.getPath('documents'), 'ChatGPT', '识屏识饮', 'local-rag', 'data', 'shiping-trial')
)
// Kept for reference when upstream updates are incorporated.
void adoptLegacyUserData
void removeLegacyUpdaterCache
