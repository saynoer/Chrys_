const test = require('node:test'),
  assert = require('node:assert/strict'),
  load = require('./load-source.cjs')
const { normalizeRagConfig } = load('src/shared/rag.ts')
test('rag config accepts only known modes and discards arbitrary remote endpoints', () => {
  assert.throws(() => normalizeRagConfig({ mode: 'remote' }))
  assert.deepEqual(normalizeRagConfig({ mode: 'local', endpoint: 'https://evil.example' }), {
    mode: 'local'
  })
})
test('old settings default to full text', () => {
  const fs = require('node:fs')
  const s = fs.readFileSync(
    require('node:path').join(__dirname, '../src/renderer/src/lib/store/settings.ts'),
    'utf8'
  )
  assert.match(s, /ragConfig:\s*\{\s*mode:\s*'full'/)
})
