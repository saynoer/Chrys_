const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http')
const { Bridge } = require('./load.cjs')('bridge.ts')
test('desktop bridge only calls loopback discovery and refreshes its token after restart', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-bridge-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'bridge.json')
  let token = 'a'.repeat(64)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.headers.authorization !== 'Bearer ' + token) {
      res.statusCode = 401
      res.end('{"error":"expired"}')
    } else res.end('{"ready":true}')
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => new Promise((r) => server.close(r)))
  const bridge = new Bridge(file),
    url = `http://127.0.0.1:${server.address().port}`
  await fs.writeFile(file, JSON.stringify({ url, token }), { mode: 0o600 })
  assert.deepEqual(await bridge.call('list'), { ready: true })
  token = 'b'.repeat(64)
  await fs.writeFile(file, JSON.stringify({ url, token }))
  assert.deepEqual(await bridge.call('list'), { ready: true })
  await fs.writeFile(file, JSON.stringify({ url: 'https://example.com', token }))
  await assert.rejects(bridge.call('list'), (e) => e.status === 503)
})
