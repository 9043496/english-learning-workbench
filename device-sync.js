/* 本机学习缓存与显式同步。Store 七方法不变，录音使用 IndexedDB。 */
(function(){
'use strict';
if(window.APP_CONFIG.storeMode!=='local')return;
const remote=window.Store,learning=['progress','vocab','shadowing','dictation'];
const prefix='english-workbench:mac-local:v1:',uuid=()=>crypto.randomUUID(),fail=(code,message)=>Object.assign(new Error(message),{code});
let count=0,connected=false,busy=false,lastUpload=0,lastDownload=0,cursor=0;
const contentReads={};
const opened=new Promise((resolve,reject)=>{const r=indexedDB.open('english-workbench-device-sync-v1',1);r.onupgradeneeded=()=>{for(const name of ['records','blobs','meta'])r.result.createObjectStore(name,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(fail('QUOTA','无法打开本机学习存储，请保留浏览器数据并检查空间。'));});
async function tx(name,mode,run){const db=await opened;return new Promise((resolve,reject)=>{const t=db.transaction(name,mode),store=t.objectStore(name);let result;try{run(store,v=>result=v);}catch(e){t.abort();reject(e);return;}t.oncomplete=()=>resolve(result);t.onerror=t.onabort=()=>reject(fail('QUOTA','本机保存未完成，请保留原录音并检查存储空间。'));});}
const get=(name,key)=>tx(name,'readonly',(s,done)=>{s.get(key).onsuccess=e=>done(e.target.result);});
const all=name=>tx(name,'readonly',(s,done)=>{s.getAll().onsuccess=e=>done(e.target.result);});
const put=(name,value)=>tx(name,'readwrite',s=>s.put(value));
const change=(name,key,fn)=>tx(name,'readwrite',(s,done)=>{s.get(key).onsuccess=e=>{const value=fn(e.target.result);if(value)s.put(value);else s.delete(key);done(value);};});
const emit=()=>window.dispatchEvent(new CustomEvent('sync-state',{detail:{pending:count,explicit:true,connected,busy,lastUpload,lastDownload}}));
async function recount(){count=(await all('records')).filter(r=>r.dirty).length+(await all('blobs')).filter(b=>b.dirty).length;emit();}
function decode(data){const [head,base]=data.split(',');return new Blob([Uint8Array.from(atob(base),c=>c.charCodeAt(0))],{type:head.match(/:(.*?);/)[1]});}
const ready=(async()=>{
 let m=await get('meta','sync');if(m){({lastUpload=0,lastDownload=0,cursor=0}=m);}
 if(!await get('meta','legacy-migrated')){
  for(const c of learning){for(const data of JSON.parse(localStorage.getItem(prefix+'cache:'+c)||'[]'))if(!await get('records',c+'/'+data.id))await put('records',{key:c+'/'+data.id,collection:c,id:data.id,data,dirty:false});}
  for(const o of JSON.parse(localStorage.getItem(prefix+'queue')||'[]')){
   if(o.type==='patch'&&learning.includes(o.collection))await stage(o.collection,o.id,o.patch);
   if(o.type==='blob')await stageBlob(o.key,decode(o.data),o.meta);
  }
  await put('meta',{key:'legacy-migrated',done:true});localStorage.removeItem(prefix+'queue');
 }
 if(!await get('meta','device'))await put('meta',{key:'device',id:uuid()});
 await recount();
})().catch(e=>{window.dispatchEvent(new CustomEvent('store-warning',{detail:e.message}));throw e;});ready.catch(()=>{});
let editTime=0;const time=()=>editTime=Math.max(Date.now(),cursor+1,editTime+1);
function applyFlags(current,patch){const result={...(current||{})};for(const [n,v] of Object.entries(patch||{})){if(v===null)delete result[n];else result[n]=v;}return result;}
async function stage(c,id,fields){return change('records',c+'/'+id,old=>{const data={...(old?.data||{}),...fields,id},patch={...(old?.dirty?old.patch:{}),...fields,id};if(fields.review_articles){data.review_articles={...(old?.data?.review_articles||{}),...fields.review_articles};patch.review_articles={...(old?.dirty?old.patch?.review_articles:{}),...fields.review_articles};}if(fields.sentence_flags){data.sentence_flags=applyFlags(old?.data?.sentence_flags,fields.sentence_flags);patch.sentence_flags={...(old?.dirty?old.patch?.sentence_flags:{}),...fields.sentence_flags};}return {key:c+'/'+id,collection:c,id,data,patch,dirty:true,updated_at:time(),change_id:uuid()};});}

async function stageBlob(key,blob,meta){return put('blobs',{key,blob,meta,dirty:true,updated_at:time(),change_id:uuid()});}
const coachFields=new Set(['assessment','review_count','familiar','familiarity_source','score','fluency','pronunciation','completeness','i1_final','i1_overridden','i1_override_note','graded_at','correct','feedback','note','quiz_history','quizzes','discussion_completed','discussion_note']);
function hasGrade(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).some(([k,v])=>coachFields.has(k)||k==='status'&&v==='graded'||hasGrade(v));}
function overlay(base,patch,progress){const result={...base};for(const [k,v] of Object.entries(patch||{})){if(k==='sentence_flags'){result[k]=applyFlags(base?.[k],v);continue;}if(coachFields.has(k)||k==='status'&&['graded','mastered','reviewing'].includes(base?.[k]))continue;if(v&&typeof v==='object'&&!Array.isArray(v))result[k]=overlay(base?.[k]||{},v,progress);else if(hasGrade(base?.[k]))continue;else if(progress&&(typeof v==='boolean'||typeof base?.[k]==='boolean'))result[k]=base?.[k]===true||v===true;else result[k]=v;}return result;}
async function request(path,init={}){try{const r=await window.LocalWorkbench.request(path,init);connected=true;emit();return r;}catch(e){connected=false;emit();throw e;}}
async function json(path,init){return (await request(path,init)).json();}
async function probe(){if(navigator.onLine===false){connected=false;emit();return false;}try{await request('/health',{signal:AbortSignal.timeout(5000)});return true;}catch{return false;}}
async function exclusive(fn){await ready;if(busy)throw fail('INVALID','同步正在进行，请稍候。');busy=true;emit();try{return await fn();}finally{busy=false;await recount();}}
async function upload(){return exclusive(async()=>{
 const device=(await get('meta','device')).id;let conflicts=0;
 const rows=(await all('records')).filter(r=>r.dirty);
 for(let offset=0;offset<rows.length;offset+=100){const batch=rows.slice(offset,offset+100);const response=await json('/api/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:batch.map(r=>({collection:r.collection,id:r.id,data:r.patch,updated_at:r.updated_at,change_id:r.change_id}))})});
  for(const r of response.applied){conflicts+=r.conflicts.length;await change('records',r.collection+'/'+r.id,old=>{if(!old||old.change_id!==r.change_id)return old;return r.data?{key:old.key,collection:r.collection,id:r.id,data:r.data,dirty:false}:null;});}
 }
 for(const b of (await all('blobs')).filter(b=>b.dirty)){
  const header=btoa(Array.from(new TextEncoder().encode(JSON.stringify(b.meta)),n=>String.fromCharCode(n)).join(''));
  const result=await json('/api/sync/blobs/'+encodeURIComponent(b.key),{method:'PUT',headers:{'Content-Type':b.meta.mime,'X-Blob-Meta':header,'X-Updated-At':String(b.updated_at),'X-Device-Id':device},body:b.blob});conflicts+=result.conflicts.length;
  if(result.conflicts.length){const blob=await remote.getBlob(b.key);if(!blob)throw fail('NETWORK','服务器录音暂时无法取回，本机录音仍保留。');await change('blobs',b.key,old=>old?.change_id===b.change_id?{...old,blob,dirty:false}:old);}
  else await change('blobs',b.key,old=>old?.change_id===b.change_id?{...old,dirty:false}:old);
 }
 lastUpload=Date.now();await put('meta',{key:'sync',cursor,lastUpload,lastDownload});return {conflicts};
});}
async function download(){return exclusive(async()=>{
 const response=await json('/api/sync/pull?since='+cursor);
 // 完成全部二进制下载后才推进游标；中断重试不会漏音频。
 for(const b of response.blobs){const blob=await remote.getBlob(b.key);if(!blob||blob.size!==b.size)throw fail('NETWORK','录音下载未完成，已保留原同步位置，请重试。');await change('blobs',b.key,old=>old?.dirty?old:{key:b.key,blob,meta:b.meta,dirty:false,updated_at:b.updated_at});}
 for(const r of response.records)await change('records',r.collection+'/'+r.id,old=>old?.dirty?{...old,data:overlay(r.data,old.patch,r.collection==='progress')}:{key:r.collection+'/'+r.id,collection:r.collection,id:r.id,data:r.data,dirty:false,updated_at:r.updated_at});
 for(const r of response.deleted)await change('records',r.collection+'/'+r.id,old=>old?.dirty?old:null);
 cursor=response.cursor;lastDownload=Date.now();await put('meta',{key:'sync',cursor,lastUpload,lastDownload});return {records:response.records.length,blobs:response.blobs.length};
});}
window.DeviceSyncData={mode:'local',uuid,pending:()=>count,
 async list(c){await ready;if(![...learning,'inputs','sentences','dictation_tasks'].includes(c))throw fail('INVALID','未知数据集合。');if(!learning.includes(c)){
  let rows;
  try{rows=await remote.list(c);}
  catch(e){
   try{rows=JSON.parse(localStorage.getItem(prefix+'cache:'+c)||'[]');}
   catch{throw fail('INVALID','无法读取离线教材缓存，请保留学习数据并恢复连接后重试。');}
   contentReads[c]={source:'cache',phase:'server-read',reason:e.code||e.name||'unknown',items:rows.length};
   return rows;
  }
  // A successful server read is authoritative even when persisting the offline cache fails.
  let cacheError=null;
  try{localStorage.setItem(prefix+'cache:'+c,JSON.stringify(rows));}
  catch(e){cacheError=e.name||e.code||'unknown';window.dispatchEvent(new CustomEvent('store-warning',{detail:'教材已从Mac读取，但离线缓存未能保存；请保持连接，学习记录仍保留本机。'}));}
  contentReads[c]={source:'server',items:rows.length,cache_saved:!cacheError,...(cacheError?{cache_error:cacheError}:{})};
  return rows;
 }return (await all('records')).filter(r=>r.collection===c).map(r=>r.data);},
 async patch(c,id,fields){await ready;if(!learning.includes(c)||!id||!fields||typeof fields!=='object'||fields?.id&&fields.id!==id)throw fail('INVALID','教材只读或记录编号无效。');const r=await stage(c,id,fields);await recount();return r.change_id;},
 async saveBlob(key,blob,meta){await ready;if(!key||!(blob instanceof Blob)||!meta?.mime?.startsWith('audio/'))throw fail('INVALID','录音参数无效。');await stageBlob(key,blob,meta);await recount();return {key,size:blob.size,mime:meta.mime};},
 async getBlob(key){await ready;return (await get('blobs',key))?.blob||null;},
 upload,download,manual:upload,flush:async()=>{},probe,
 status:()=>({connected,busy,lastUpload,lastDownload,pending:count}),
 contentReads:()=>JSON.parse(JSON.stringify(contentReads)),
 async conflicts(){await ready;return json('/api/sync/log');}
};
window.addEventListener('online',probe);window.addEventListener('offline',()=>{connected=false;emit();});
ready.then(probe).catch(()=>{});setInterval(probe,15000);
})();
