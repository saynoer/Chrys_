const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const load = require('./load-source.cjs')

// One fixture per file, so a preset's default can be told from another's
const prompts = Object.fromEntries(
  fs
    .readdirSync(path.join(__dirname, '../src/renderer/src/lib/store/prompts'))
    .map((name) => [`./prompts/${name}?raw`, `fixture prompt ${name}`])
)

test('an emptied preset prompt is saved as empty and survives a restart', () => {
  const saved = new Map()
  global.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key)
  }
  try {
    const { useSettingsStore: store } = load('src/renderer/src/lib/store/settings.ts', prompts)
    const generalQa = () => store.getState().scenes.find((s) => s.id === 'general-qa')
    // A new install starts each mode on its first scene
    assert.equal(store.getState().activeSceneId, 'general-qa')
    assert.equal(store.getState().customPrompt, 'fixture prompt general-qa.md')
    assert.equal(store.getState().conversationSceneId, 'tech-interview')
    assert.equal(store.getState().conversationPrompt, 'fixture prompt tech-interview.md')

    // Whitespace counts as empty: nothing is sent, but what was typed is kept
    store.getState().updateScenePrompt('general-qa', '  \n')
    assert.equal(generalQa().prompt, '  \n')
    assert.equal(store.getState().customPrompt, '')

    const { useSettingsStore: restarted } = load('src/renderer/src/lib/store/settings.ts', prompts)
    const restartedGeneralQa = restarted.getState().scenes.find((s) => s.id === 'general-qa')
    assert.equal(restartedGeneralQa.prompt, '  \n')
    assert.equal(restarted.getState().customPrompt, '')
    // The other mode's preset is untouched
    assert.equal(restarted.getState().conversationPrompt, 'fixture prompt tech-interview.md')
  } finally {
    delete global.localStorage
  }
})

test('a deleted preset comes back with its default prompt', () => {
  const saved = new Map()
  global.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key)
  }
  try {
    const { useSettingsStore: store } = load('src/renderer/src/lib/store/settings.ts', prompts)
    store.getState().updateScenePrompt('english-exam', '')
    assert.equal(store.getState().removeScene('english-exam'), true)
    store.getState().restorePresetScenes('screenshot')
    const restored = store.getState().scenes.find((s) => s.id === 'english-exam')
    assert.equal(restored.prompt, 'fixture prompt english-exam.md')
  } finally {
    delete global.localStorage
  }
})
