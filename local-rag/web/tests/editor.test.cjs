const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm')
function setup() {
  const script = fs.readFileSync(
      process.env.RAG_EDITOR_SOURCE || path.join(__dirname, '../public/app.js'),
      'utf8'
    ),
    start = script.indexOf('async function saveEditor()'),
    end = script.indexOf('\nfunction chooseFile(', start)
  let resolve
  const response = new Promise((r) => {
    resolve = r
  })
  const editor = {
    project: 'p',
    doc: { id: 'a', version: 'old' },
    generation: 0,
    name: { value: 'name' },
    text: { value: 'saved request' },
    tags: { value: '' },
    conv: { checked: true },
    screen: { checked: true },
    save: { disabled: false },
    saved: { textContent: '' }
  }
  const state = { project: 'p', editor, dirty: true }
  const scope = {
    state,
    api: () => response,
    base: () => '/api/projects/p',
    time: () => '',
    afterChange: async () => {},
    $: () => ({ replaceChildren() {} }),
    el: () => ({ append() {} }),
    button: () => null,
    openEditor: () => {}
  }
  vm.createContext(scope)
  vm.runInContext(script.slice(start, end) + '\nthis.save=saveEditor', scope)
  return { state, editor, save: scope.save, resolve }
}
test('web save preserves changes typed while response is pending and advances the saved version', async () => {
  const { state, editor, save, resolve } = setup(),
    job = save()
  editor.text.value = 'typed while saving - must survive'
  editor.generation++
  resolve({ id: 'a', version: 'new', name: 'name', text: 'saved request', updatedAt: 1 })
  await job
  assert.equal(editor.text.value, 'typed while saving - must survive')
  assert.equal(state.dirty, true)
  assert.equal(editor.doc.version, 'new')
})
test('an old response cannot clear another editor dirty state', async () => {
  const { state, editor, save, resolve } = setup(),
    job = save()
  state.editor = { ...editor, text: { value: 'different draft' } }
  state.dirty = true
  resolve({ id: 'a', version: 'new', name: 'name', text: 'saved request', updatedAt: 1 })
  await job
  assert.equal(state.editor.text.value, 'different draft')
  assert.equal(state.dirty, true)
})

test('desktop reconnect updates the sidebar instead of keeping an obsolete offline badge', async () => {
  const script = fs.readFileSync(
      process.env.RAG_EDITOR_SOURCE || path.join(__dirname, '../public/app.js'),
      'utf8'
    ),
    start = script.indexOf('async function loadStatus()'),
    end = script.indexOf('\nasync function rebuild()', start)
  const p = { id: 'shiping', kind: 'shiping', connected: false },
    state = { project: 'shiping', view: 'search' }
  const scope = {
    state,
    base: () => '/api/projects/shiping',
    project: () => p,
    api: async () => ({ state: 'ready', documents: 1, chunks: 396 }),
    $: () => null,
    updateStats() {},
    drawTask() {},
    renderSidebar() {}
  }
  vm.createContext(scope)
  vm.runInContext(script.slice(start, end) + '\nthis.load=loadStatus', scope)
  await scope.load()
  assert.equal(p.connected, true)
})
