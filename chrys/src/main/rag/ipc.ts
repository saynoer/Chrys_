import { ipcMain } from 'electron'
import { getIndex, getRagStatus, rebuild, clear } from './service'
import { checkServices } from './client'
function modeOf(mode: unknown): 'conversation' | 'screenshot' {
  if (mode !== 'conversation' && mode !== 'screenshot') throw new Error('无效模式')
  return mode
}
ipcMain.handle('rag:status', () => getRagStatus())
ipcMain.handle('rag:check', () => checkServices())
ipcMain.handle('rag:rebuild', () => rebuild())
ipcMain.handle('rag:clear', () => clear())
ipcMain.handle('rag:preview', async (_event, mode, query) => {
  if (typeof query !== 'string' || !query.trim() || query.length > 3000)
    throw new Error('请输入 1–3000 字的问题')
  return getIndex().retrieve(modeOf(mode), query)
})
