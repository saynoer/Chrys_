/** A release newer than the running app, as main found it */
export interface AvailableUpdate {
  version: string
  /** Its release page: the notes, and on macOS the download */
  url: string
  /** Windows downloads and installs it in place; macOS can only point to the page */
  installable: boolean
  phase: 'available' | 'downloading' | 'downloaded' | 'failed'
  /** 0–100 while downloading */
  percent?: number
  /** Why the last download failed */
  error?: string
}
