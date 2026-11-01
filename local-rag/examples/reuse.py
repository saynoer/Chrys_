"""A second project reuses services, without Shiping dependencies or credentials."""
import argparse, json, urllib.request
BASE='http://127.0.0.1:18000/api/v2/tenants/default_tenant/databases/default_database/collections'
def req(url,body=None):
    r=urllib.request.Request(url,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(r,timeout=60) as response: return json.load(response)
def embed(texts):
    return req('http://127.0.0.1:11435/api/embed',{'model':'bge-m3','input':texts,'truncate':False,'keep_alive':'5m'})['embeddings']
def run(name,question):
    if name in {'shiping_knowledge_bgem3_v1','shiping_knowledge_bgem3_v2'}: raise ValueError('Choose a separate example collection')
    c=req(BASE,{'name':name,'get_or_create':True,'configuration':{'hnsw':{'space':'cosine'}}})
    text='示例项目 Aurora：通过 Redis 缓存热点查询，减少数据库压力。'
    req(BASE+'/'+c['id']+'/upsert',{'ids':['demo-1'],'documents':[text],'embeddings':embed([text]),'metadatas':[{'source':'synthetic-demo','model':'bge-m3','chunkVersion':1}]})
    return req(BASE+'/'+c['id']+'/query',{'query_embeddings':embed([question]),'n_results':1,'include':['documents','distances']})
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--collection',default='reusable_rag_demo_bgem3_v1');p.add_argument('--query',default='怎么降低数据库访问压力？');a=p.parse_args();print(json.dumps(run(a.collection,a.query),ensure_ascii=False,indent=2))
