import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/lib/store/settings'
import { SettingsCard } from './components'
import type { RagHit, RagStatus } from '../../../shared/rag'
export function RagSettings() {
  const mode = useSettingsStore((s) => s.ragConfig.mode),
    update = useSettingsStore((s) => s.updateSetting)
  const [status, setStatus] = useState<RagStatus>(),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<RagHit[]>([]),
    [previewMode, setPreviewMode] = useState<'conversation' | 'screenshot'>('conversation'),
    [confirmClear, setConfirmClear] = useState(false)
  const refresh = () =>
    window.api
      .ragStatus()
      .then(setStatus)
      .catch((e) => setMessage(String(e)))
  useEffect(() => {
    void refresh()
    const t = setInterval(() => {
      void refresh()
    }, 2000)
    return () => clearInterval(t)
  }, [])
  async function run(task: () => Promise<unknown>) {
    setBusy(true)
    setMessage('')
    try {
      await task()
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <SettingsCard Icon={Database} title="本地资料检索（RAG）">
      <p className="text-sm text-muted-foreground">
        全文模式会随请求发送启用资料；本地检索仅发送命中片段。向量生成留在本机，命中片段仍会交给所选
        AI 平台。
      </p>
      <div className="flex flex-wrap gap-2 my-3">
        <Button
          aria-pressed={mode === 'full'}
          variant={mode === 'full' ? 'default' : 'outline'}
          onClick={() => update('ragConfig', { mode: 'full' })}
        >
          全文模式
        </Button>
        <Button
          disabled={busy || status?.state !== 'ready'}
          aria-pressed={mode === 'local'}
          variant={mode === 'local' ? 'default' : 'outline'}
          onClick={() => update('ragConfig', { mode: 'local' })}
        >
          本地检索
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await window.api.ragCheck()
              setMessage('本地服务和 BGE-M3 可用')
            })
          }
        >
          检测服务
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => window.api.ragRebuild())}
        >
          建立 / 更新索引
        </Button>
      </div>
      <p className="text-sm">
        当前模式：{mode === 'local' ? '本地检索' : '全文'} ·{' '}
        {busy ? '处理中，请稍候。' : (status?.message ?? '读取状态中')} · {status?.documents ?? 0}{' '}
        份资料 · {status?.chunks ?? 0} 个片段
      </p>
      <p className="text-sm text-muted-foreground">
        仅监听本机：Ollama 11435 / Chroma
        18000。结构化分片优先保留章节、段落和链接。先手动启动服务，再建立索引。纯图片首轮没有文字检索输入，不附加资料；对话、转录和文字追问可检索。
      </p>
      <div className="flex gap-2 my-3">
        <select
          aria-label="检索预览模式"
          value={previewMode}
          onChange={(e) => setPreviewMode(e.target.value as typeof previewMode)}
          className="bg-background border rounded px-2"
        >
          <option value="conversation">对话资料</option>
          <option value="screenshot">截图资料</option>
        </select>
        <Input
          aria-label="检索预览问题"
          value={query}
          maxLength={3000}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入准备好的问题，查看命中依据"
        />
        <Button
          disabled={busy || !query.trim()}
          onClick={() =>
            void run(async () => setHits(await window.api.ragPreview(previewMode, query)))
          }
        >
          预览
        </Button>
      </div>
      {hits.slice(0, 6).map((h) => (
        <div key={h.id} className="border rounded p-2 my-2 text-sm">
          <strong>
            {h.name} · {h.start}–{h.end}
          </strong>
          <p className="text-muted-foreground">{h.section || '未识别到章节'}</p>
          <p className="whitespace-pre-wrap">{h.text}</p>
        </div>
      ))}
      {message && (
        <p role="status" className="text-sm whitespace-pre-wrap">
          {message}
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || status?.state === 'indexing'}
        onClick={() => setConfirmClear(!confirmClear)}
      >
        清除Chrys索引
      </Button>
      {confirmClear && (
        <div className="text-sm my-2">
          仅清除Chrys当前的v2向量集合，保留原始资料、旧版本索引和其他项目集合。
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.api.ragClear()
                setHits([])
                setConfirmClear(false)
              })
            }
          >
            确认清除
          </Button>
        </div>
      )}
    </SettingsCard>
  )
}
