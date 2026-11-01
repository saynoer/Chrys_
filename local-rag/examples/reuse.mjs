// Reuse the same local services from any Node.js project, with a separate collection.
const collectionName = process.argv[2] || 'javascript_rag_demo_bgem3_v1'
if (['shiping_knowledge_bgem3_v1', 'shiping_knowledge_bgem3_v2'].includes(collectionName)) throw Error('Use your own project collection')
const base = 'http://127.0.0.1:18000/api/v2/tenants/default_tenant/databases/default_database/collections'
async function req(url, body) {
  const r = await fetch(url, {method: body ? 'POST':'GET', headers:{'Content-Type':'application/json'}, body:body ? JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)})
  if(!r.ok) throw Error(`HTTP ${r.status}`)
  return r.json()
}
async function embed(input) {return (await req('http://127.0.0.1:11435/api/embed',{model:'bge-m3',input,truncate:false})).embeddings}
const collection = await req(base,{name:collectionName,get_or_create:true,configuration:{hnsw:{space:'cosine'}}})
const text = '示例项目 Borealis：使用消息队列隔离耗时任务，让用户请求更快返回。'
await req(`${base}/${collection.id}/upsert`,{ids:['demo-1'],documents:[text],embeddings:await embed([text]),metadatas:[{source:'synthetic-demo',model:'bge-m3',chunkVersion:1}]})
console.log(JSON.stringify(await req(`${base}/${collection.id}/query`,{query_embeddings:await embed(['如何避免耗时任务拖慢用户请求？']),n_results:1,include:['documents','distances']}),null,2))
