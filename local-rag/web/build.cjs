const path = require('node:path'),
  fs = require('node:fs'),
  { createRequire } = require('node:module')
const source = path.resolve(__dirname, '../../shiping-rag'),
  deps = createRequire(path.join(source, 'package.json'))
const modules = path.join(__dirname, 'node_modules')
if (!fs.existsSync(modules)) fs.symlinkSync(path.join(source, 'node_modules'), modules, 'dir')
deps('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(__dirname, 'dist/server.cjs'),
  external: ['unpdf', 'mammoth']
})
console.log('本机管理后台构建完成')
