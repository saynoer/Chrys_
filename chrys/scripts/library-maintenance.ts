/** Run only with desktop and admin stopped. No activation occurs during read-only verification. */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { migrateLegacy, snapshotLegacy } from '../src/main/library/migrate'
import { Library } from '../src/main/library/repository'
const [action, inputRoot] = process.argv.slice(2),
  root = resolve(inputRoot || '../local-rag'),
  dir = join(root, 'data/library')
function requireStopped() {
  for (const file of [
    join(root, 'run/admin.json'),
    join(root, 'data/shiping-trial/rag/admin-bridge.json')
  ]) {
    if (!existsSync(file)) continue
    const record = JSON.parse(readFileSync(file, 'utf8'))
    if (record.pid) {
      let alive = true
      try {
        process.kill(record.pid, 0)
      } catch {
        alive = false
      }
      if (alive) throw Error('请先退出Chrys并停止管理网页，防止迁移期间写入')
    }
  }
}
async function main() {
  if (!inputRoot) throw Error('必须明确提供local-rag数据根目录')
  if (['verify', 'backup'].includes(action) && !existsSync(join(dir, 'chrys.sqlite')))
    throw Error('正式数据库不存在，禁止创建空库')
  if (action === 'backup') mkdirSync(join(root, 'backups'), { recursive: true, mode: 0o700 })
  if (action === 'activate') {
    requireStopped()
    if (existsSync(join(dir, 'active.json')) || existsSync(join(dir, 'chrys.sqlite')))
      throw Error('已有正式数据库或配置，禁止覆盖')
    const stamp = Date.now(),
      snapshot = join(root, 'backups', `before-sqlite-${stamp}`)
    snapshotLegacy(root, snapshot)
    const target = join(dir, `candidate-${stamp}.sqlite`),
      report = migrateLegacy(root, target),
      candidate = new Library(target)
    try {
      await candidate.backup(join(dir, 'chrys.sqlite'))
    } finally {
      candidate.close()
    }
    const marker = join(dir, 'active.json')
    writeFileSync(
      marker + '.tmp',
      JSON.stringify({
        version: 1,
        database: 'chrys.sqlite',
        activatedAt: new Date().toISOString(),
        legacyBackup: snapshot,
        report
      }),
      { mode: 0o600 }
    )
    renameSync(marker + '.tmp', marker)
    console.log(JSON.stringify({ activated: true, report, legacyBackup: snapshot }))
  } else if (action === 'verify') {
    const db = new Library(join(dir, 'chrys.sqlite'))
    try {
      console.log(
        JSON.stringify({
          integrity: db.integrity(),
          projects: db.projects().map((p: any) => ({
            id: p.id,
            active: db.list(p.id).length,
            trash: db.list(p.id, true).length
          }))
        })
      )
    } finally {
      db.close()
    }
  } else if (action === 'backup') {
    const db = new Library(join(dir, 'chrys.sqlite'))
    try {
      const dest = join(root, 'backups', `library-${Date.now()}.sqlite`)
      await db.backup(dest)
      console.log(JSON.stringify({ databaseBackup: dest, assetsNotIncluded: true }))
    } finally {
      db.close()
    }
  } else throw Error('Use activate|verify|backup <local-rag root>')
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
