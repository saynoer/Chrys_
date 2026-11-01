import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let queue: Promise<unknown> = Promise.resolve()
export function extractLocalDocument(buffer: Buffer, ext: string): Promise<string> {
  // One heavy job per host process; avoid creating many simultaneous OCR workers.
  const result = queue.then(() => run(buffer, ext))
  queue = result.catch(() => {})
  return result
}
async function run(buffer: Buffer, ext: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chrys-import-'))
  try {
    const input = join(dir, 'input.' + ext)
    await writeFile(input, buffer, { mode: 0o600 })
    const worker = join(__dirname, 'document-worker.cjs')
    if (!existsSync(worker)) throw Error('文档解析组件未构建，请运行 npm run build:documents')
    const resources = (process as any).resourcesPath
    const assets =
      process.env.CHRYS_OCR_DATA ||
      ([
        resources && join(resources, 'ocr'),
        resolve(__dirname, '../../resources/ocr'),
        resolve(__dirname, '../../../chrys/resources/ocr')
      ]
        .filter(Boolean)
        .find((p) => existsSync(p as string)) as string | undefined)
    return await new Promise<string>((resolveResult, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=768', worker, input, ext], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHRYS_OCR_DATA: assets || '' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
      const output: Buffer[] = []
      let bytes = 0,
        failure = ''
      let settled = false
      const finish = (err?: Error, text?: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        err ? reject(err) : resolveResult(text!)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
      }, 180_000)
      child.stdout.on('data', (chunk) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += data.length
        output.push(data)
        if (bytes > 12 * 1024 * 1024) {
          failure = '提取正文超过上限'
          child.kill('SIGKILL')
        }
      })
      child.stderr.on('data', () => {}) // Parser errors are returned via structured stdout; avoid exposing file contents.
      child.on('error', () => finish(Error('无法启动本地文档解析进程')))
      child.on('close', (code, signal) => {
        if (signal) return finish(Error(failure || '本地解析超时或资源不足，请拆分文件后重试'))
        try {
          const value = JSON.parse(Buffer.concat(output).toString('utf8'))
          if (code !== 0 || value.error) finish(Error(value.error || '文档解析失败'))
          else if (typeof value.text !== 'string') finish(Error('文档解析结果无效'))
          else finish(undefined, value.text)
        } catch {
          finish(Error('文档解析失败，文件可能损坏或资源不足'))
        }
      })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
