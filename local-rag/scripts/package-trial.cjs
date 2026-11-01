const path=require('node:path'),fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),source=path.join(root,'chrys'),asar=require(path.join(source,'node_modules/@electron/asar'))
const staging=path.join(root,'work/trial-app-source'),app=path.join(root,'outputs/Chrys.app'),plist=path.join(app,'Contents/Info.plist')
if(!fs.existsSync(app))cp.execFileSync('ditto',[path.join(root,'outputs/识屏RAG试用.app'),app])

const frameworks=path.join(app,'Contents/Frameworks')
for(const entry of fs.readdirSync(frameworks)){
 if(!entry.startsWith('识屏 Helper')||!entry.endsWith('.app'))continue
 const bundle=path.join(frameworks,entry), info=path.join(bundle,'Contents/Info.plist')
 const oldExe=cp.execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleExecutable',info],{encoding:'utf8'}).trim(),newExe=oldExe.replace('识屏','Chrys')
 fs.renameSync(path.join(bundle,'Contents/MacOS',oldExe),path.join(bundle,'Contents/MacOS',newExe))
 for(const key of ['CFBundleExecutable','CFBundleName'])cp.execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${newExe}`,info])
 fs.renameSync(bundle,path.join(frameworks,entry.replace('识屏','Chrys')))
}
const executable=path.join(app,'Contents/MacOS/识屏')
if(fs.existsSync(executable))fs.renameSync(executable,path.join(app,'Contents/MacOS/Chrys'))

cp.execFileSync('ditto',[path.join(source,'out'),path.join(staging,'out')])
const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json')));pkg.name='chrys';pkg.version='1.0.0';fs.writeFileSync(path.join(staging,'package.json'),JSON.stringify(pkg))
;(async()=>{
 const archive=path.join(app,'Contents/Resources/app.asar');await asar.createPackage(staging,archive)
 const hash=crypto.createHash('sha256').update(asar.getRawHeader(archive).headerString).digest('hex')
 for(const cmd of ['Set :CFBundleIdentifier local.shiping.rag.trial','Set :CFBundleName Chrys','Set :CFBundleExecutable Chrys','Set :CFBundleDisplayName Chrys','Set :CFBundleShortVersionString 1.0.0','Set :CFBundleVersion 1.0.0',`Set :ElectronAsarIntegrity:Resources/app.asar:hash ${hash}`])cp.execFileSync('/usr/libexec/PlistBuddy',['-c',cmd,plist])
 cp.execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});cp.execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});console.log('Trial package updated and signature verified')
})().catch(e=>{console.error(e);process.exitCode=1})
