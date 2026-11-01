const fs = require('node:fs'),
  path = require('node:path'),
  { createRequire } = require('node:module')
const deps = createRequire(path.resolve(__dirname, '../../../chrys/package.json'))
const ts = deps('typescript')
module.exports = function load(file, mocks = {}, cache = new Map()) {
  file = path.resolve(__dirname, '..', file)
  if (cache.has(file)) return cache.get(file).exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const req = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id]
    if (id.startsWith('.'))
      return module.exports(
        path.resolve(path.dirname(file), id.endsWith('.ts') ? id : id + '.ts'),
        mocks,
        cache
      )
    return deps(id)
  }
  new Function('require', 'module', 'exports', '__dirname', code)(
    req,
    mod,
    mod.exports,
    path.dirname(file)
  )
  return mod.exports
}
