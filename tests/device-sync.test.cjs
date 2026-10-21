// 非浏览器/非真机：真实前端脚本 + fake-indexeddb + 真实隔离HTTP/SQLite服务。
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),{webcrypto}=require('node:crypto'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..');let child,folder,base,token;
before(async()=>{
 folder=await fsp.mkdtemp(path.join(os.tmpdir(),'learning-sync-test-'));
 const code=`import sys,json\nsys.path.insert(0,${JSON.stringify(path.join(root,'local'))})\nfrom server import make_server\ns=make_server(${JSON.stringify(folder)})\ns.data.import_bundle({'inputs':[{'id':'input01','audioKey':'original.mp3'}],'sentences':[{'id':'input01','items':[]}],'dictation_tasks':[{'id':'dt','audio':'dict.mp3'}]})\ns.data.save_blob('original.mp3',b'original',{'mime':'audio/mpeg'})\nprint(json.dumps({'port':s.server_port,'token':s.data.token}),flush=True)\ns.serve_forever()\n`;
 child=spawn(process.env.PYTHON||'python3',['-B','-u','-c',code],{stdio:['ignore','pipe','pipe']});
 let output='',startupError='';child.stderr.on('data',b=>startupError+=b);const info=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('测试服务启动超时：'+startupError)),5000);child.on('error',reject);child.stdout.on('data',b=>{output+=b;if(output.includes('\n')){clearTimeout(t);resolve(JSON.parse(output.split('\n')[0]));}});});base='http://127.0.0.1:'+info.port;token=info.token;
});
after(async()=>{if(child){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped;}if(folder)await fsp.rm(folder,{recursive:true,force:true});});
const api=async(url,init={})=>{const r=await fetch(base+url,{...init,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...init.headers}});assert.ok(r.ok,'HTTP '+r.status);return r.json();};
const save=(c,id,data)=>api('/api/records/'+c+'/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({id,...data})});
const pause=()=>new Promise(r=>setTimeout(r,10));
async function device(reuse,initiallyOffline=false){
 const state=reuse||{indexedDB:new IDBFactory(),storage:new Map()};const listeners={},events=[],calls=[];
 const w={APP_CONFIG:{storeMode:'local'},addEventListener:(n,f)=>(listeners[n]??=[]).push(f),dispatchEvent:e=>{events.push(e);for(const f of listeners[e.type]||[])f(e);}};
 const controls={offline:initiallyOffline,drop:null,hold:null};const localStorage={getItem:k=>state.storage.get(k)||null,setItem:(k,v)=>state.storage.set(k,v),removeItem:k=>state.storage.delete(k)};
 const context={window:w,indexedDB:state.indexedDB,localStorage,crypto:webcrypto,location:{href:base+'/',hash:'#pair='+token},history:{replaceState(){}},navigator:{onLine:true},Blob,TextEncoder,Uint8Array,atob,btoa,URLSearchParams,AbortSignal,console,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},setTimeout,setInterval:()=>0,fetch:async(url,opts)=>{calls.push({url,method:opts?.method||'GET'});if(controls.offline)throw new TypeError('simulated offline');const r=await fetch(new URL(url,base),opts);if(controls.hold)await controls.hold(url,r);if(controls.drop===url){controls.drop=null;throw new TypeError('simulated lost response');}return r;}};
 for(const file of ['local-store.js','device-sync.js','store.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 await w.Data.list('progress');await w.Data.probe();return {D:w.Data,w,state,controls,calls,events,context};
}
test('D01 两设备显式上传/下载：保存及上线均不自动上传，教材不参与',async()=>{
 const a=await device(),b=await device();await a.D.patch('progress','D01',{reading_checked:true});assert.equal(await api('/api/records/progress/D01'),null);a.w.dispatchEvent({type:'online'});await pause();assert.equal(await api('/api/records/progress/D01'),null);assert.equal(a.D.pending(),1);
 await a.D.upload();assert.equal(a.D.pending(),0);assert.equal((await b.D.list('progress')).some(r=>r.id==='D01'),false);const r=await b.D.download();assert.equal((await b.D.list('progress')).find(r=>r.id==='D01').reading_checked,true);assert.equal(r.blobs,0);assert.equal((await b.D.list('inputs'))[0].id,'input01');assert.ok(a.D.status().lastUpload>0);assert.ok(b.D.status().lastDownload>0);
});
test('D02 离线写入/重载保留记录与录音，上传失败不清待上传条数',async()=>{
 const a=await device();a.controls.offline=true;await a.D.probe();await a.D.patch('shadowing','D02.webm',{status:'submitted'});await a.D.saveBlob('D02.webm',new Blob(['offline audio'],{type:'audio/webm'}),{mime:'audio/webm'});assert.equal(a.D.pending(),2);await assert.rejects(a.D.upload());assert.equal(a.D.pending(),2);assert.equal(a.D.status().connected,false);
 const restarted=await device(a.state);assert.equal(restarted.D.pending(),2);assert.equal(await (await restarted.D.getBlob('D02.webm')).text(),'offline audio');await restarted.D.upload();assert.equal(restarted.D.pending(),0);
});
test('D03 录音跨设备上传下载保持全部字节，增量重复下载为空',async()=>{
 const a=await device(),b=await device(),raw=new Uint8Array([0x1a,0x45,0xdf,0xa3,0,255,12]);await a.D.saveBlob('D03.webm',new Blob([raw],{type:'audio/webm'}),{mime:'audio/webm',durationSec:2});await a.D.patch('shadowing','D03.webm',{durationSec:2,status:'submitted'});await a.D.upload();await b.D.download();assert.deepEqual(new Uint8Array(await (await b.D.getBlob('D03.webm')).arrayBuffer()),raw);assert.deepEqual(JSON.parse(JSON.stringify(await b.D.download())),{records:0,blobs:0});
});
test('D04 下载保留本机待上传答案，远端完成布尔值OR及教练评分同时可见',async()=>{
 const a=await device();await a.D.patch('progress','D04',{reading_checked:false,comprehension:{answers:['local'],status:'submitted',correct:0}});await save('progress','D04',{reading_checked:true,i1_final:'hit',comprehension:{answers:['server'],correct:1,total:1,status:'graded'}});await a.D.download();const p=(await a.D.list('progress')).find(r=>r.id==='D04');assert.equal(p.reading_checked,true);assert.equal(p.comprehension.answers[0],'local');assert.equal(p.comprehension.correct,1);assert.equal(p.comprehension.status,'graded');assert.equal(a.D.pending(),1);
 await a.D.upload();const r=await api('/api/records/progress/D04');assert.equal(r.reading_checked,true);assert.equal(r.i1_final,'hit');assert.equal(r.comprehension.correct,1);assert.ok((await a.D.conflicts()).some(r=>r.record_id==='D04'));
});
test('D05 服务端已应用但响应丢失：记录重试幂等，期间教练评分保留',async()=>{
 const a=await device();await a.D.patch('shadowing','D05.webm',{status:'submitted'});a.controls.drop='/api/sync/push';await assert.rejects(a.D.upload());assert.equal(a.D.pending(),1);await save('shadowing','D05.webm',{status:'graded',score:{fluency:2,pronunciation:2,completeness:3}});await a.D.upload();assert.equal(a.D.pending(),0);assert.equal((await api('/api/records/shadowing/D05.webm')).score.fluency,2);await a.D.download();assert.equal((await a.D.list('shadowing')).find(r=>r.id==='D05.webm').score.fluency,2);
});
test('D06 录音下载中断不推进游标，重试可完整取回',async()=>{
 const a=await device(),b=await device();await b.D.download();await a.D.saveBlob('D06.webm',new Blob(['resume me'],{type:'audio/webm'}),{mime:'audio/webm'});await a.D.patch('shadowing','D06.webm',{status:'submitted'});await a.D.upload();b.controls.drop='/api/blobs/D06.webm';await assert.rejects(b.D.download());assert.equal((await b.D.list('shadowing')).some(r=>r.id==='D06.webm'),false);const result=await b.D.download();assert.equal(result.blobs,1);assert.equal(await (await b.D.getBlob('D06.webm')).text(),'resume me');
});
test('D07 上传进行时的新作答不会被旧响应清除',async()=>{
 const a=await device();await a.D.patch('progress','D07',{difficulty_self:'first'});let release,entered;const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r);a.controls.hold=async url=>{if(url==='/api/sync/push'){entered();await gate;}};const upload=a.D.upload();await waiting;await pause();await a.D.patch('progress','D07',{difficulty_self:'second'});release();await upload;assert.equal(a.D.pending(),1);assert.equal((await a.D.list('progress')).find(r=>r.id==='D07').difficulty_self,'second');a.controls.hold=null;await a.D.upload();assert.equal((await api('/api/records/progress/D07')).difficulty_self,'second');assert.equal(a.D.pending(),0);
});
test('D08 旧设备常规字段不能覆盖较新服务器值，日志可查',async()=>{
 const a=await device();await a.D.patch('progress','D08',{difficulty_self:'old'});await pause();await save('progress','D08',{difficulty_self:'new'});const result=await a.D.upload();assert.ok(result.conflicts>0);assert.equal((await api('/api/records/progress/D08')).difficulty_self,'new');assert.ok((await a.D.conflicts()).some(r=>r.record_id==='D08'&&r.fields.includes('difficulty_self:server_newer')));
});
test('D09 教材不能通过设备修改，离线教材缓存可读',async()=>{
 const a=await device();await assert.rejects(a.D.patch('inputs','input01',{title:'changed'}),e=>e.code==='INVALID');await a.D.list('inputs');a.controls.offline=true;assert.equal((await a.D.list('inputs'))[0].id,'input01');assert.equal(a.D.pending(),0);
});
test('D10 录音上传响应丢失后幂等重试，不制造冲突',async()=>{
 const a=await device();await a.D.saveBlob('D10.webm',new Blob(['retry audio'],{type:'audio/webm'}),{mime:'audio/webm'});await a.D.patch('shadowing','D10.webm',{status:'submitted'});a.controls.drop='/api/sync/blobs/D10.webm';await assert.rejects(a.D.upload());assert.equal(a.D.pending(),1);const result=await a.D.upload();assert.equal(result.conflicts,0);assert.equal(a.D.pending(),0);
});

test('D11 精听自动正确率和完成状态可同步，设备不能伪造人工跟读分数',async()=>{
 const a=await device(),b=await device();await a.D.patch('dictation','D11',{user_text:'A clear idea.',word_accuracy:1,status:'graded',completed:true});await a.D.patch('shadowing','D11.webm',{score:{fluency:3,pronunciation:3,completeness:3},status:'graded'});await a.D.upload();await b.D.download();const d=(await b.D.list('dictation')).find(r=>r.id==='D11');assert.equal(d.word_accuracy,1);assert.equal(d.status,'graded');assert.equal(d.completed,true);assert.equal((await b.D.list('shadowing')).find(r=>r.id==='D11.webm').score,undefined);
});

test('D12 初次连接失败后恢复网络，无需重载即可下载教材与录音',async()=>{
 const a=await device(undefined,true);assert.equal(a.D.status().connected,false);a.controls.offline=false;await a.D.probe();assert.equal((await a.D.list('inputs'))[0].id,'input01');await a.D.download();assert.ok(await a.D.getBlob('D03.webm'));
});
test('D13 旧localStorage队列迁移保留未上传作答及录音，不自动上传',async()=>{
 const prefix='english-workbench:mac-local:v1:',storage=new Map();storage.set(prefix+'queue',JSON.stringify([{type:'patch',collection:'shadowing',id:'D13.webm',patch:{id:'D13.webm',status:'submitted'}},{type:'blob',key:'D13.webm',data:'data:audio/webm;base64,'+btoa('legacy bytes'),meta:{mime:'audio/webm'}}]));const a=await device({storage,indexedDB:new IDBFactory()});assert.equal(a.D.pending(),2);assert.equal(await (await a.D.getBlob('D13.webm')).text(),'legacy bytes');assert.equal(await api('/api/records/shadowing/D13.webm'),null);await a.D.upload();const b=await device();await b.D.download();assert.equal(await (await b.D.getBlob('D13.webm')).text(),'legacy bytes');
});

test('D14 多次离线标记/取消合并，上传后另一设备可取消最后标记',async()=>{
 const a=await device(),b=await device();await a.D.patch('progress','D14',{sentence_flags:{1:'confused'}});await a.D.patch('progress','D14',{sentence_flags:{2:'confused'}});await a.D.patch('progress','D14',{sentence_flags:{1:null}});assert.deepEqual(JSON.parse(JSON.stringify((await a.D.list('progress')).find(p=>p.id==='D14').sentence_flags)),{'2':'confused'});await a.D.upload();await b.D.download();await b.D.patch('progress','D14',{sentence_flags:{2:null}});await b.D.upload();await a.D.download();assert.deepEqual(JSON.parse(JSON.stringify((await a.D.list('progress')).find(p=>p.id==='D14').sentence_flags)),{});
});
test('D15 取消后的旧设备标记不能复活，下载仍保留待上传的局部取消',async()=>{
 const a=await device(),b=await device();await a.D.patch('progress','D15',{sentence_flags:{1:'confused',2:'confused'}});await a.D.upload();await b.D.download();await a.D.patch('progress','D15',{sentence_flags:{1:'confused'}});await pause();await b.D.patch('progress','D15',{sentence_flags:{1:null}});await b.D.upload();assert.ok((await a.D.upload()).conflicts>0);await a.D.patch('progress','D15',{sentence_flags:{2:null}});await a.D.download();assert.deepEqual(JSON.parse(JSON.stringify((await a.D.list('progress')).find(p=>p.id==='D15').sentence_flags)),{});assert.equal(a.D.pending(),1);await a.D.upload();assert.deepEqual((await api('/api/records/progress/D15')).sentence_flags,{});
});
test('D16 wordpack/cn/speaker随教材缓存，断网重载后查义不请求网络',async()=>{
 const input={id:'D16-input',body:['Bank.'],sentences:[{n:5,text:'Bank.',cn:'测试翻译',speaker:'A'}],wordpack:[{w:'bank',pos:'n.',cn:'测试语义',n:5}]};await api('/api/import',{method:'POST',body:JSON.stringify({inputs:[input]})});const a=await device();await a.D.list('inputs');const b=await device(a.state,true),pack=(await b.D.list('inputs')).find(p=>p.id==='D16-input'),R=require('../reading.js'),before=b.calls.length;assert.equal(R.segments(pack.body[0],pack.wordpack,5)[0].entry.cn,'测试语义');assert.equal(pack.sentences[0].cn,'测试翻译');assert.equal(pack.sentences[0].speaker,'A');assert.equal(b.calls.length,before);await assert.rejects(b.D.patch('inputs',input.id,{wordpack:[]}),e=>e.code==='INVALID');
});
test('D17 教练掌握状态下载后去高亮，设备不能覆盖掌握状态',async()=>{
 const a=await device(),b=await device(),R=require('../reading.js');await a.D.patch('vocab','D17-word',{word:'fixture',status:'new'});await a.D.upload();await b.D.download();assert.equal(R.segments('Fixture',[],1,await b.D.list('vocab'))[0].unknown,true);await save('vocab','D17-word',{word:'fixture',status:'mastered',correct:1,quizzes:1});await b.D.download();assert.equal(R.segments('Fixture',[],1,await b.D.list('vocab'))[0].unknown,false);await b.D.patch('vocab','D17-word',{status:'new'});await b.D.upload();assert.equal((await api('/api/records/vocab/D17-word')).status,'mastered');
});
