const test = require('node:test'),
  assert = require('node:assert/strict'),
  http = require('node:http'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path')
const { createAdminServer } = require('./load.cjs')('server.ts')
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-web-http-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const saved = new Map(),
    rows = new Map()
  const server = createAdminServer({
    root,
    publicDir: path.resolve(__dirname, '../public'),
    ioFactory: (_s, id) => ({
      fingerprint: async () => 'test-v2',
      embed: async (ts) => ts.map(() => [1, 0]),
      upsert: async (cs) => cs.forEach((c) => rows.set(c.id, c)),
      query: async (_v, ids) =>
        ids.filter((id) => rows.has(id)).map((id) => ({ ...rows.get(id), score: 0.8, name: '' })),
      remove: async (ids) => ids.forEach((id) => rows.delete(id)),
      save: async (v) => {
        saved.set(id, v)
      },
      load: () => saved.get(id)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => server.close(r)))
  const base = `http://127.0.0.1:${server.address().port}`,
    session = await fetch(base + '/api/session'),
    { csrf } = await session.json(),
    cookie = session.headers.get('set-cookie').split(';')[0]
  const send = (route, method = 'GET', body, headers = {}) =>
    fetch(base + route, {
      method,
      headers: {
        Cookie: cookie,
        Origin: base,
        'Content-Type': 'application/json',
        'X-Rag-CSRF': csrf,
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  return { base, send, cookie, csrf, root }
}
test('local API enforces Origin, session, CSRF and Host before any writes', async (t) => {
  const { base, send } = await setup(t)
  assert.equal(
    (
      await fetch(base + '/api/projects', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: '{"name":"forbidden"}'
      })
    ).status,
    401
  )
  assert.equal(
    (await send('/api/projects', 'POST', { name: 'forbidden' }, { Origin: 'https://evil.example' }))
      .status,
    403
  )
  assert.equal(
    (await send('/api/projects', 'POST', { name: 'forbidden' }, { 'X-Rag-CSRF': 'wrong' })).status,
    403
  )
  const foreign = await new Promise((resolve) => {
    http.get(base + '/api/projects', { headers: { Host: 'evil.example' } }, (r) => {
      r.resume()
      r.on('end', () => resolve(r.statusCode))
    })
  })
  assert.equal(foreign, 403)
  const projects = await (await send('/api/projects')).json()
  assert.equal(projects.length, 1)
})
test('HTTP source CRUD, version conflict, original download, recycle and backup append', async (t) => {
  const { send } = await setup(t)
  const p = await (await send('/api/projects', 'POST', { name: 'HTTP知识库' })).json(),
    route = `/api/projects/${p.id}`
  const created = await send(route + '/documents', 'POST', {
    name: '原始资料',
    text: '# 原文\n\n青山课程 https://example.com/one'
  })
  assert.equal(created.status, 201)
  const d = await created.json()
  const updated = await (
    await send(route + '/documents/' + d.id, 'PUT', {
      version: d.version,
      text: '# 新原文\n\n青山课程 https://example.com/two'
    })
  ).json()
  assert.equal(
    (await send(route + '/documents/' + d.id, 'PUT', { version: d.version, text: '不能覆盖' }))
      .status,
    409
  )
  const chunks = await (await send(route + '/documents/' + d.id + '/chunks')).json()
  assert.match(chunks.items[0].text, /example.com\/two/)
  const removed = await (
    await send(route + '/documents/' + d.id, 'DELETE', { version: updated.version })
  ).json()
  assert.equal((await (await send(route + '/documents')).json()).length, 0)
  assert.equal((await (await send(route + '/documents?trash=1')).json()).length, 1)
  await send(route + '/documents/' + d.id + '/restore', 'POST', { version: removed.version })
  const file = Buffer.from('# 文件原貌\r\n\r\n独特课程')
  const imported = await (
    await send(route + '/import', 'POST', { name: 'source.md', base64: file.toString('base64') })
  ).json()
  const download = await send(route + '/documents/' + imported.id + '/original')
  assert.match(download.headers.get('content-disposition'), /attachment/)
  assert.equal(await download.text(), file.toString())
  const backup = await (await send(route + '/backup')).json()
  assert.equal(backup.documents.length, 2)
  assert.equal((await send(route + '/restore', 'POST', backup)).status, 200)
  assert.equal((await (await send(route + '/documents')).json()).length, 4)
  assert.equal(
    (await send('/api/collections/00000000-0000-0000-0000-000000000000', 'DELETE', {})).status,
    404
  )
})
test('offline desktop and invalid source inputs fail clearly without creating partial data', async (t) => {
  const { send } = await setup(t)
  assert.equal((await send('/api/projects/shiping/documents')).status, 503)
  const p = await (await send('/api/projects', 'POST', { name: '输入检查' })).json(),
    route = `/api/projects/${p.id}`
  assert.equal(
    (
      await send(route + '/import', 'POST', {
        name: '../secret.txt',
        base64: Buffer.from('abc').toString('base64')
      })
    ).status,
    400
  )
  assert.equal((await send(route + '/documents', 'POST', { name: '空', text: '  ' })).status, 400)
  assert.equal((await send('/api/projects/%2e%2e%2foutside/documents')).status, 400)
  assert.equal((await (await send(route + '/documents')).json()).length, 0)
})
