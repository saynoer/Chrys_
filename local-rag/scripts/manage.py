"""Owned, manual-only local RAG service lifecycle."""
import argparse, json, os, pathlib, socket, subprocess, sys, time, urllib.request, shutil, datetime
ROOT = pathlib.Path(__file__).resolve().parents[1]
_children = {}
def require_free(port):
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try: s.bind(('127.0.0.1', port))
        except OSError as e: raise RuntimeError(f'Port {port} occupied; refusing to adopt another service') from e
def identity(pid):
    try:
        cmd=subprocess.check_output(['ps','-p',str(pid),'-o','command='],text=True).strip()
        start=subprocess.check_output(['ps','-p',str(pid),'-o','lstart='],text=True).strip()
        return cmd, start
    except (subprocess.CalledProcessError, PermissionError): return '', ''
def owns_process(record):
    cmd, start=identity(record['pid'])
    return bool(cmd and record.get('marker') in cmd and record.get('start') == start)
def uninstall_plan(root, manifest):
    others=[c for c in manifest.get('consumers',[]) if c!='shiping']
    projects=root/'data/admin/projects'
    if projects.exists():
        others.extend('web-project:'+p.name for p in projects.iterdir() if p.is_dir() and not p.is_symlink() and (p/'project.json').is_file())
    return {'dry_run':True,'root':str(root),'other_consumers':others,'can_remove_shared':not others,'steps':['stop owned services','back up all collections and manifest','confirm deletion of owned runtime/models/data only'],'original_documents':'preserved'}
def manifest():
    p=ROOT/'manifest.json'
    return json.loads(p.read_text()) if p.exists() else {'consumers':['shiping'],'created':time.time(),'actions':[]}
def record(action, detail):
    m=manifest(); m['actions'].append({'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),'action':action,'detail':detail})
    p=ROOT/'manifest.json'; tmp=p.with_suffix('.tmp'); tmp.write_text(json.dumps(m,ensure_ascii=False,indent=2)); tmp.replace(p)
def services():
    return {'ollama':([str(ROOT/'runtime/ollama/ollama'),'serve'],11435,str(ROOT/'runtime/ollama')),
            'chroma':([str(ROOT/'runtime/chroma-env/bin/chroma'),'run','--host','127.0.0.1','--port','18000','--path',str(ROOT/'data/chroma')],18000,str(ROOT/'runtime/chroma-env')),
            'admin':([str(ROOT/'runtime/node/bin/node'),str(ROOT/'web/dist/server.cjs')],18080,str(ROOT/'web/dist/server.cjs'))}
def probe(url):
    try:
        with urllib.request.urlopen(url,timeout=2) as r: return r.status==200
    except Exception: return False
URLS={'ollama':'http://127.0.0.1:11435/api/version','chroma':'http://127.0.0.1:18000/api/v2/heartbeat','admin':'http://127.0.0.1:18080/api/health'}
def status():
    result={}
    for name, (_,port,_) in services().items():
        p=ROOT/'run'/f'{name}.json'; r=json.loads(p.read_text()) if p.exists() else None
        result[name]={'owned':bool(r and owns_process(r)),'ready':probe(URLS[name]),'port':port,'record':r}
    return result
def start(names=None):
    started=[]
    try:
        for folder in ['logs','run','data']: (ROOT/folder).mkdir(parents=True,exist_ok=True)
        for name,(args,port,marker) in services().items():
            if names is not None and name not in names: continue
            p=ROOT/'run'/f'{name}.json'
            if p.exists() and owns_process(json.loads(p.read_text())):
                if probe(URLS[name]): continue
                raise RuntimeError(f'{name} owned but not ready; stop it before restarting')
            require_free(port)
            env={**os.environ,'OLLAMA_HOST':'127.0.0.1:11435','OLLAMA_MODELS':str(ROOT/'models'),'OLLAMA_MAX_LOADED_MODELS':'1','OLLAMA_NUM_PARALLEL':'1','ANONYMIZED_TELEMETRY':'False'}
            with open(ROOT/'logs'/f'{name}.log','ab') as log:
                proc=subprocess.Popen(args,env=env,stdout=log,stderr=log,start_new_session=True)
            _children[name]=proc
            time.sleep(.15); _,stamp=identity(proc.pid)
            r={'pid':proc.pid,'start':stamp,'marker':marker}; p.write_text(json.dumps(r)); started.append(name)
            deadline=time.monotonic()+45
            while not probe(URLS[name]):
                if proc.poll() is not None or time.monotonic()>deadline: raise RuntimeError(f'{name} failed readiness; inspect logs')
                time.sleep(.25)
        record('start','owned loopback services ready')
    except Exception:
        stop(started); raise
    return status()
def stop(names=None):
    for name in names if names is not None else services():
        p=ROOT/'run'/f'{name}.json'
        if not p.exists(): continue
        r=json.loads(p.read_text())
        if owns_process(r):
            os.kill(r['pid'],15)
            for _ in range(80):
                if not owns_process(r): break
                time.sleep(.1)
            if owns_process(r): raise RuntimeError(f'{name} did not exit; leaving process record')
        child=_children.pop(name,None)
        if child is not None: child.wait(timeout=2)
        p.unlink(missing_ok=True)
    record('stop','only matching owned process identities signalled')
def backup():
    if any(x['owned'] for x in status().values()): raise RuntimeError('Stop services before consistent backup')
    dest=ROOT/'backups'/time.strftime('%Y%m%d-%H%M%S'); dest.mkdir(parents=True)
    shutil.copytree(ROOT/'data',dest/'data'); shutil.copy2(ROOT/'manifest.json',dest/'manifest.json'); record('backup',str(dest)); return str(dest)
if __name__=='__main__':
    a=argparse.ArgumentParser(); a.add_argument('action',choices=['start','status','stop','start-admin','stop-admin','backup','uninstall-plan']); args=a.parse_args()
    try:
        result={'start':start,'status':status,'stop':stop,'start-admin':lambda:start(['admin']),'stop-admin':lambda:stop(['admin']),'backup':backup,'uninstall-plan':lambda:uninstall_plan(ROOT,manifest())}[args.action]()
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except Exception as e: print(str(e),file=sys.stderr); sys.exit(1)
