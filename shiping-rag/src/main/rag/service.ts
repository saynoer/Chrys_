import { app } from 'electron'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelMessage } from 'ai'
import type { AppMode } from '../../shared/api-profile'
import { settings } from '../settings'
import { getKnowledgePrompt, getRagDocuments, onKnowledgeChanged } from '../knowledge'
import { RagIndex } from './index'
import * as client from './client'
import { extractQuery } from './query'
import { formatContext } from './chunks'
let index: RagIndex | undefined
const statePath = () => join(app.getPath('userData'), 'rag', 'active-structure-v2.json')
export function getIndex(): RagIndex {
  if (!index)
    index = new RagIndex({
      fingerprint: client.fingerprint,
      embed: client.embed,
      upsert: client.upsert,
      query: client.searchVectors,
      remove: client.remove,
      load: () =>
        existsSync(statePath()) ? JSON.parse(readFileSync(statePath(), 'utf8')) : undefined,
      save: async (data) => {
        const p = statePath()
        await mkdir(join(p, '..'), { recursive: true })
        await writeFile(p + '.tmp', JSON.stringify(data))
        await rename(p + '.tmp', p)
      }
    })
  index.setDocuments(getRagDocuments())
  return index
}
let timer: ReturnType<typeof setTimeout> | undefined
let clearing = false
let afterClear: boolean | undefined
export function getRagStatus() {
  const status = getIndex().getStatus()
  return clearing
    ? { ...status, state: 'indexing' as const, message: '正在清除索引，后续更新已排队' }
    : status
}
export function queueReconcile(force = false): void {
  if (clearing) {
    afterClear = Boolean(afterClear || force)
    return
  }
  void getIndex()
    .reconcile(getRagDocuments(), force)
    .catch(() => {})
}
onKnowledgeChanged(() => {
  if (!index) return
  index.setDocuments(getRagDocuments())
  if (clearing && settings.ragConfig.mode === 'local') {
    afterClear = afterClear ?? false
    return
  }
  if (settings.ragConfig.mode === 'local' && !clearing) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      queueReconcile()
    }, 500)
  }
})
export async function rebuild(): Promise<void> {
  if (clearing) throw new Error('正在清除索引，请稍后重试')
  await getIndex().reconcile(getRagDocuments(), true)
}
export async function clear(): Promise<void> {
  if (clearing || getIndex().getStatus().state === 'indexing')
    throw new Error('请等待索引任务完成再清除')
  if (timer) {
    clearTimeout(timer)
    timer = undefined
  }
  clearing = true
  getIndex().invalidate()
  try {
    await client.clearProjectIndex()
    const p = statePath()
    await mkdir(join(p, '..'), { recursive: true })
    await writeFile(p + '.tmp', JSON.stringify({ fingerprint: '', revisions: {}, ids: [] }))
    await rename(p + '.tmp', p)
  } finally {
    clearing = false
    const pending = afterClear
    afterClear = undefined
    if (pending !== undefined) queueReconcile(pending)
  }
}
export async function getRagContext(
  mode: AppMode,
  messages: ModelMessage[],
  signal?: AbortSignal
): Promise<string> {
  if (settings.ragConfig.mode !== 'local') return getKnowledgePrompt(mode)
  if (clearing) throw new Error('正在清除资料索引，请稍后重试')
  const query = extractQuery(messages)
  if (!query) return '当前问题只有图片，没有可供本地文本检索的文字；本轮未附带资料库内容。'
  const idx = getIndex(),
    hits = await idx.retrieve(mode, query, signal)
  // Refresh authoritative document state after asynchronous retrieval as well.
  const live = getRagDocuments()
  return formatContext(
    hits.filter((h) =>
      live.some((d) => d.id === h.docId && d.revision === h.revision && d.modes.includes(mode))
    )
  )
}
