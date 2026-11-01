const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path')
const load = require('./load.cjs'),
  { Store } = load('store.ts'),
  { Indexes } = load('vectors.ts')
async function settled(indexes, id) {
  for (let i = 0; i < 100; i++) {
    if ((await indexes.status(id)).state !== 'indexing') return
    await new Promise((r) => setImmediate(r))
  }
  throw Error('index did not settle')
}
test('edited or trashed sources never return stale indexed content; failed indexing can retry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-index-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new Store(root),
    p = await store.createProject('索引测试'),
    a = await store.create(p.id, {
      name: '课程',
      text: '# 课程\n\n星河老师课程网址 https://example.com/course'
    })
  const rows = new Map()
  let saved,
    fail = false
  const indexes = new Indexes(store, () => ({
    fingerprint: async () => 'fixture-structure-v2',
    embed: async (ts) => {
      if (fail) throw Error('模型不可用')
      return ts.map(() => [1, 0])
    },
    upsert: async (cs) => cs.forEach((c) => rows.set(c.id, c)),
    query: async (_v, ids) =>
      ids.filter((id) => rows.has(id)).map((id) => ({ ...rows.get(id), score: 0.8, name: '' })),
    remove: async (ids) => ids.forEach((id) => rows.delete(id)),
    save: async (s) => {
      saved = structuredClone(s)
    },
    load: () => saved
  }))
  await indexes.rebuild(p.id)
  await settled(indexes, p.id)
  assert.match((await indexes.search(p.id, '星河老师课程网址'))[0].text, /example.com\/course/)
  const b = await store.update(p.id, a.id, {
    version: a.version,
    text: '# 新课\n\n已更新 https://example.com/new'
  })
  await assert.rejects(indexes.search(p.id, '课程'), /过期|重建/)
  fail = true
  await indexes.rebuild(p.id)
  await settled(indexes, p.id)
  assert.equal((await indexes.status(p.id)).state, 'error')
  assert.match((await store.get(p.id, a.id)).text, /example.com\/new/)
  fail = false
  await indexes.rebuild(p.id)
  await settled(indexes, p.id)
  assert.match((await indexes.search(p.id, '新课'))[0].text, /example.com\/new/)
  await store.trash(p.id, a.id, b.version)
  assert.deepEqual(await indexes.search(p.id, '课程'), [])
})
