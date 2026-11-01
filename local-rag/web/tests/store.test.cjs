const test = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os')
const { Store } = require('./load.cjs')('store.ts')
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-admin-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new Store(root),
    project = await store.createProject('测试知识库')
  return { store, project, root }
}
test('source CRUD survives restart and rejects a stale edit without overwriting', async (t) => {
  const { store, project, root } = await setup(t)
  const a = await store.create(project.id, { name: '项目说明', text: '# 项目\n\n旧内容' })
  const b = await store.update(project.id, a.id, { version: a.version, text: '# 项目\n\n新内容' })
  await assert.rejects(
    store.update(project.id, a.id, { version: a.version, text: '过期覆盖' }),
    (e) => e.status === 409
  )
  const restarted = new Store(root)
  assert.equal((await restarted.get(project.id, a.id)).text, '# 项目\n\n新内容')
  assert.equal((await restarted.list(project.id)).length, 1)
  assert.equal((await restarted.list(project.id))[0].text, undefined)
  assert.notEqual(a.version, b.version)
})
test('trash hides original text from active documents and restore retains it', async (t) => {
  const { store, project } = await setup(t)
  const a = await store.create(project.id, { name: '可恢复', text: '不能丢失' })
  const deleted = await store.trash(project.id, a.id, a.version)
  assert.equal((await store.list(project.id)).length, 0)
  assert.equal((await store.list(project.id, { trash: true })).length, 1)
  await assert.rejects(store.restore(project.id, a.id, a.version), (e) => e.status === 409)
  const restored = await store.restore(project.id, a.id, deleted.version)
  assert.equal(restored.text, '不能丢失')
  assert.equal((await store.list(project.id)).length, 1)
})
test('original bytes survive backup and restoring appends with different ids', async (t) => {
  const { store, project } = await setup(t)
  const a = await store.create(project.id, {
    name: '原文件',
    text: '资料内容',
    original: { name: '资料.md', data: Buffer.from('# 原文件\r\n\r\n资料内容') }
  })
  const original = await store.original(project.id, a.id)
  assert.equal(original.data.toString(), '# 原文件\r\n\r\n资料内容')
  const backup = await store.backup(project.id)
  const restored = await store.importBackup(project.id, backup)
  assert.equal(restored.added, 1)
  const docs = await store.list(project.id)
  assert.equal(docs.length, 2)
  assert.notEqual(docs[0].id, docs[1].id)
  assert.equal(
    (await store.original(project.id, docs[1].id)).data.toString(),
    original.data.toString()
  )
})
test('validates all backup documents before any source is changed', async (t) => {
  const { store, project } = await setup(t)
  await assert.rejects(
    store.importBackup(project.id, {
      format: 'local-rag-backup',
      version: 1,
      documents: [
        { name: '正常', text: '内容' },
        { name: '坏的', text: 13 }
      ]
    }),
    (e) => e.status === 400
  )
  assert.equal((await store.list(project.id)).length, 0)
})
test('does not accept path traversal, symlinked project files, empty text or unknown modes', async (t) => {
  const { store, project, root } = await setup(t)
  await assert.rejects(store.get('../outside', 'x'), (e) => e.status === 400)
  await assert.rejects(
    store.create(project.id, { name: '空', text: '  ' }),
    (e) => e.status === 400
  )
  await assert.rejects(
    store.create(project.id, { name: '错误', text: '内容', modes: ['remote'] }),
    (e) => e.status === 400
  )
  const outside = path.join(root, 'outside.json')
  await fs.writeFile(outside, JSON.stringify({ name: '秘密', documents: [] }))
  const p = path.join(root, 'projects', project.id, 'project.json')
  await fs.unlink(p)
  await fs.symlink(outside, p)
  await assert.rejects(store.list(project.id), (e) => e.status === 400)
})
test('serial changes to the same version allow exactly one writer', async (t) => {
  const { store, project } = await setup(t),
    doc = await store.create(project.id, { name: '并发', text: '初始' })
  const results = await Promise.allSettled([
    store.update(project.id, doc.id, { version: doc.version, text: '甲' }),
    store.update(project.id, doc.id, { version: doc.version, text: '乙' })
  ])
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1)
  assert.equal(results.filter((x) => x.status === 'rejected' && x.reason.status === 409).length, 1)
})
