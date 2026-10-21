/* Mac 本地适配器；保持规格书 Store 的七个方法签名不变。 */
(function(){
'use strict';
if(window.APP_CONFIG.storeMode!=='local')return;
const savedKey='english-workbench:local-pairing';
const pairing=new URLSearchParams(location.hash.slice(1)).get('pair');
if(pairing){try{localStorage.setItem(savedKey,pairing);history.replaceState(null,'','#today');}catch{}}
const token=pairing||localStorage.getItem(savedKey)||'';
window.addEventListener?.('hashchange',()=>{const value=new URLSearchParams(location.hash.slice(1)).get('pair');if(value){localStorage.setItem(savedKey,value);history.replaceState(null,'','#today');location.reload();}});
const error=(code,message)=>Object.assign(new Error(message),{code});
async function request(path,init={}){
 let response;try{response=await fetch(path,{...init,credentials:'same-origin',headers:{...(token?{Authorization:'Bearer '+token}:{}),...init.headers}});}catch{throw error('NETWORK','无法连接 Mac 工作台，请确认 Mac 已开机且与手机在同一网络。');}
 if(!response.ok){let body;try{body=await response.json();}catch{}throw error(body?.code||'NETWORK',body?.message||'本地服务未完成请求，请稍后重试。');}
 return response;
}
const ready=request('/api/session',{method:'POST'}).then(r=>{if(window.LocalWorkbench)window.LocalWorkbench.connected=true;return r;}).catch(e=>{window.dispatchEvent(new CustomEvent('store-warning',{detail:e.message}));throw e;});
// 避免在首个 Store 调用前产生未处理拒绝；调用方仍将收到该错误。
ready.catch(()=>{});
async function ensureReady(){try{await ready;}catch{await request('/api/session',{method:'POST'});if(window.LocalWorkbench)window.LocalWorkbench.connected=true;}}
async function json(path,init){await ensureReady();return (await request(path,init)).json();}
const record=(c,id)=>'/api/records/'+encodeURIComponent(c)+(id===undefined?'':'/'+encodeURIComponent(id));
function media(key){return '/media/'+encodeURIComponent(key);}
function resolveMedia(c,row){
 if(!row)return row;
 if(c==='inputs'){const raw=row.audio_blob_key||row.audio_full||row.audio;return {...row,audio_full:(row.audioKey||row.audio_blob_key)?media(row.audioKey||row.audio_blob_key):raw?(/^(https?:|blob:|\/)/.test(raw)?raw:media(row.id+'/'+raw)):media(row.id+'/full.mp3')};}
 if(c==='sentences'){const items=(row.items||row.sentences||[]).map(s=>({...s,audio:s.audio?.startsWith('blob:')||s.audio?.startsWith('https:')||s.audio?.startsWith('/')?s.audio:media(s.audioKey||s.audio_blob_key||(s.audio?row.id+'/'+s.audio:row.id+'/sentence-'+String(s.n).padStart(2,'0')))}));return {...row,items};}
 if(c==='dictation_tasks'){const raw=row.audio_blob_key||row.audio;return {...row,audio:row.audioKey?media(row.audioKey):raw&&!/^(https?:|blob:|\/)/.test(raw)?media(raw):raw};}
 return row;
}
window.Store={
 async list(c){return (await json(record(c))).map(row=>resolveMedia(c,row));},
 async get(c,id){return resolveMedia(c,await json(record(c,id)));},
 async save(c,id,obj){if(obj?.id!==id)throw error('INVALID','记录 id 不一致。');await json(record(c,id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});},
 async remove(c,id){await json(record(c,id),{method:'DELETE'});},
 async saveBlob(key,blob,meta){await ensureReady();const header=btoa(Array.from(new TextEncoder().encode(JSON.stringify(meta)),b=>String.fromCharCode(b)).join(''));const result=await (await request('/api/blobs/'+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':meta.mime,'X-Blob-Meta':header},body:blob})).json();window.dispatchEvent(new CustomEvent('local-blob-operation',{detail:{operation:'saveBlob',key,size:result.size,mime:result.mime}}));return result;},
 async getBlob(key){await ensureReady();try{const blob=await (await request('/api/blobs/'+encodeURIComponent(key))).blob();window.dispatchEvent(new CustomEvent('local-blob-operation',{detail:{operation:'getBlob',key,size:blob.size,mime:blob.type}}));return blob;}catch(e){if(e.code==='NOT_FOUND')return null;throw e;}},
 async listBlobs(prefix){return json('/api/blobs?prefix='+encodeURIComponent(prefix||''));}
};
window.LocalWorkbench={connected:false,request,
 async importContent(bundle){return json('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bundle)});},
 async exportBackup(){await ensureReady();const blob=await (await request('/api/export')).blob();const src=URL.createObjectURL(blob),a=document.createElement('a');a.href=src;a.download='英语学习工作台备份.zip';a.click();setTimeout(()=>URL.revokeObjectURL(src),10000);}
};
})();
