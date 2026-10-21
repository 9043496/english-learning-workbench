/* Store 契约 + 前端暂存/重试层；平台存储由 Muse 注入。 */
(function(){
'use strict';
if(window.APP_CONFIG.storeMode==='local'&&window.DeviceSyncData){window.Data=window.DeviceSyncData;return;}
const C=['inputs','sentences','vocab','progress','shadowing','dictation','dictation_tasks'];
const prefix=window.APP_CONFIG.storeMode==='local'?'english-workbench:mac-local:v1:':'english-workbench:v1:';
const err=(code,message)=>Object.assign(new Error(message),{code});
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(prefix+key))??fallback;}catch(e){throw err('INVALID','本地数据无法读取，请保留当前浏览器数据并联系维护者。');}};
const write=(key,value)=>{try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch(e){throw err('QUOTA','本地空间不足，请先同步并保留录音原文件。');}};
const check=c=>{if(!C.includes(c))throw err('INVALID','未知数据集合。');};
const blobData=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(err('INVALID','录音读取失败。'));r.readAsDataURL(blob);});
function fromDataURL(data){const [head,base]=data.split(',');const mime=head.match(/:(.*?);/)[1],bytes=Uint8Array.from(atob(base),c=>c.charCodeAt(0));return new Blob([bytes],{type:mime});}
const mock={
 async list(c){check(c);return Object.values(read('mock:'+c,{}));},
 async get(c,id){check(c);return read('mock:'+c,{})[id]??null;},
 async save(c,id,obj){check(c);if(c==='dictation_tasks'||obj?.id!==id)throw err('INVALID','记录编号不一致或集合只读。');const all=read('mock:'+c,{});all[id]=obj;write('mock:'+c,all);},
 async remove(c,id){check(c);if(c==='dictation_tasks')throw err('INVALID','集合只读。');const all=read('mock:'+c,{});if(!all[id])throw err('NOT_FOUND','记录不存在。');delete all[id];write('mock:'+c,all);},
 async saveBlob(key,blob,meta){if(!(blob instanceof Blob)||!key||!meta?.mime)throw err('INVALID','录音参数不完整。');const value={key,size:blob.size,mime:meta.mime,data:await blobData(blob)};write('mock:blob:'+key,value);return {key,size:blob.size,mime:meta.mime};},
 async getBlob(key){const v=read('mock:blob:'+key,null);return v?fromDataURL(v.data):null;},
 async listBlobs(p=''){return Object.keys(localStorage).filter(k=>k.startsWith(prefix+'mock:blob:'+p)).map(k=>{const {key,size,mime}=JSON.parse(localStorage.getItem(k));return {key,size,mime};});}
};
let store;
if(['artifact','local'].includes(window.APP_CONFIG.storeMode)){store=window.Store;if(!store||!['list','get','save','remove','saveBlob','getBlob','listBlobs'].every(k=>typeof store[k]==='function'))throw err('INVALID','Muse 数据接口尚未接入。');}else store=mock;
const uuid=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
let queue=read('queue',[]),busy=false,timer=null;
const emit=()=>window.dispatchEvent(new CustomEvent('sync-state',{detail:{pending:queue.length,manual:queue.some(o=>o.attempts>=5)}}));
const persist=()=>{write('queue',queue);emit();};
function mergePatch(current,patch){const result={...current,...patch};if(patch.sentence_flags){const flags={...(current?.sentence_flags||{})};for(const [n,v] of Object.entries(patch.sentence_flags)){if(v===null)delete flags[n];else flags[n]=v;}result.sentence_flags=flags;}return result;}
function overlay(c,records){const map=new Map(records.map(r=>[r.id,r]));for(const o of queue.filter(o=>o.type==='patch'&&o.collection===c))map.set(o.id,mergePatch(map.get(o.id)||{id:o.id},o.patch));return [...map.values()];}
async function list(c){check(c);let rows=read('cache:'+c,[]);try{rows=await store.list(c);write('cache:'+c,rows);}catch(e){if(e.code!=='NETWORK')window.dispatchEvent(new CustomEvent('store-warning',{detail:'读取失败，正在显示本地暂存。'}));}return overlay(c,rows);}
async function patch(c,id,fields){check(c);if(c==='dictation_tasks'||c==='inputs'||c==='sentences')throw err('INVALID','教材为只读。');const clientId=uuid();const op={type:'patch',collection:c,id,patch:{...fields,id,clientId},clientId,attempts:0,next:0};queue.push(op);try{persist();}catch(e){queue.pop();throw e;}await flush();return clientId;}
async function saveBlob(key,blob,meta){if(!busy&&queue.length===0){try{return await store.saveBlob(key,blob,meta);}catch(e){if(e.code==='INVALID')throw e;}}const data=await blobData(blob),clientId=uuid();const op={type:'blob',key,data,meta,clientId,attempts:0,next:0};queue.push(op);try{persist();}catch(e){queue.pop();throw e;}await flush();return {key,size:blob.size,mime:meta.mime};}
async function getBlob(key){const local=queue.find(o=>o.type==='blob'&&o.key===key);if(local)return fromDataURL(local.data);return store.getBlob(key);}
async function flush(){
 if(busy)return;busy=true;clearTimeout(timer);
 try{
  // 按提交顺序同步，避免较早快照覆盖较新作答。
  while(queue.length){const o=queue[0];if(o.attempts>=5||o.next>Date.now())break;
   try{
    if(o.type==='blob')await store.saveBlob(o.key,fromDataURL(o.data),o.meta);
    else{const current=await store.get(o.collection,o.id)||{id:o.id};const next=mergePatch(current,o.patch);await store.save(o.collection,o.id,next);let cached=read('cache:'+o.collection,[]);cached=cached.filter(r=>r.id!==o.id);cached.push(next);write('cache:'+o.collection,cached);}
    queue.shift();persist();
   }catch(e){o.attempts++;o.code=e.code||'NETWORK';o.next=Date.now()+1000*2**o.attempts;if(o.code==='INVALID')o.attempts=5;persist();break;}
  }
 }finally{busy=false;emit();const first=queue[0];if(first&&first.attempts<5)timer=setTimeout(flush,Math.max(100,first.next-Date.now()));}
}
function manual(){for(const o of queue){o.attempts=0;o.next=0;}persist();return flush();}
window.addEventListener('online',manual);
window.Data={list,patch,saveBlob,getBlob,flush,manual,uuid,pending:()=>queue.length,mode:window.APP_CONFIG.storeMode};
// 仅为本地验证提供导入；生产装配使用 Store，不调用此入口。
window.MockTools={async seed(data){if(window.APP_CONFIG.storeMode!=='mock')throw err('INVALID','仅本地验证可导入。');for(const [c,rows]of Object.entries(data)){check(c);if(!Array.isArray(rows)||rows.some(r=>!r.id))throw err('INVALID','每个集合应为带 id 的记录数组。');}for(const [c,rows]of Object.entries(data))write('mock:'+c,Object.fromEntries(rows.map(r=>[r.id,r])));}};
setTimeout(flush,0);
})();
