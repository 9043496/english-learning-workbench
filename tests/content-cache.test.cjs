// 非真机：模拟缓存配额失败，证明教材读取不得被本机缓存写入失败回退。
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),{webcrypto}=require('node:crypto'),{IDBFactory}=require('fake-indexeddb');
const prefix='english-workbench:mac-local:v1:',current={id:'fixture',wordpack:[{w:'fixture',pos:'n.',cn:'仅测试词义'}]};
function device({quota=false,offline=false,corrupt=false}={}){
 const cache=new Map([[prefix+'cache:inputs',corrupt?'broken json':JSON.stringify([{id:'fixture',title:'old-cache'}])]]),events=[];
 const w={APP_CONFIG:{storeMode:'local'},Store:{list:async()=>{if(offline)throw Object.assign(new Error('offline'),{code:'NETWORK'});return [current];}},LocalWorkbench:{request:async()=>({})},addEventListener(){},dispatchEvent(e){events.push(e);}};
 const localStorage={getItem:k=>cache.get(k)||null,setItem(k,v){if(quota&&k===prefix+'cache:inputs')throw Object.assign(new Error('quota'),{name:'QuotaExceededError'});cache.set(k,v);},removeItem:k=>cache.delete(k)};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../device-sync.js'),'utf8'),{window:w,indexedDB:new IDBFactory(),localStorage,crypto:webcrypto,Blob,TextEncoder,Uint8Array,atob,btoa,AbortSignal,navigator:{onLine:true},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},setInterval:()=>0,console});
 return {D:w.DeviceSyncData,cache,events};
}
test('C01 服务器新词包读取成功，即使离线缓存写满也返回新词包',async()=>{
 const {D,cache}=device({quota:true}),rows=await D.list('inputs');
 assert.equal(rows[0].wordpack?.length,1);
 assert.equal(D.contentReads().inputs.source,'server');
 assert.equal(D.contentReads().inputs.cache_saved,false);
 assert.equal(JSON.parse(cache.get(prefix+'cache:inputs'))[0].title,'old-cache');
});
test('C02 服务器不可达才回退已有只读教材缓存',async()=>{
 const {D}=device({offline:true}),rows=await D.list('inputs');
 assert.equal(rows[0].title,'old-cache');assert.equal(D.contentReads().inputs.source,'cache');
});
test('C03 旧缓存损坏不阻止返回服务器有效词包',async()=>{
 const {D}=device({quota:true,corrupt:true}),rows=await D.list('inputs');
 assert.equal(rows[0].wordpack.length,1);
});
