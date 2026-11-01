const path = require('node:path'),
  fs = require('node:fs'),
  { createRequire } = require('node:module')
const source = path.resolve(__dirname, '../../chrys'),
  deps = createRequire(path.join(source, 'package.json'))
const modules = path.join(__dirname, 'node_modules')
if (fs.lstatSync(modules, { throwIfNoEntry: false })?.isSymbolicLink() && fs.readlinkSync(modules) !== path.join(source, 'node_modules')) fs.unlinkSync(modules)
if (!fs.existsSync(modules)) fs.symlinkSync(path.join(source, 'node_modules'), modules, 'dir')
deps('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(__dirname, 'dist/server.cjs'),
  external: ['unpdf', 'mammoth', 'tesseract.js', '@napi-rs/canvas', 'fast-xml-parser', 'yauzl']
})
console.log('本机管理后台构建完成')

deps('esbuild').buildSync({
  entryPoints: [path.join(source, 'src/main/document-worker.ts')],
  outfile: path.join(__dirname, 'dist/document-worker.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external'
})
