/* 非真机：jsdom+fake-indexeddb+隔离HTTP/SQLite；不触碰用户库。 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-live-test-')),results=[];
let child,dom;
(async()=>{
const py="import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom server import make_server\ns=make_server(sys.argv[2]);print(json.dumps({'port':s.server_port,'token':s.data.token}),flush=True);s.serve_forever()\n";
child=spawn(process.env.PYTHON||'python3',['-B','-c',py,path.join(root,'local'),folder],{stdio:['ignore','pipe','pipe']});
const info=await new Promise((resolve,reject)=>{let buf='';child.stdout.on('data',chunk=>{buf+=chunk;if(buf.includes('\n'))resolve(JSON.parse(buf.split('\n')[0]));});child.on('error',reject);});
const base='http://127.0.0.1:'+info.port;
async function api(route,init={}){const res=await fetch(base+route,{...init,headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json',...init.headers}});assert.ok(res.ok,'HTTP '+res.status);return res.json();}
const course={id:'test_course',date:'2026-10-17',title:'Isolated fixture',body:['A word in a sentence.'],word_count:5,audioKey:'fixture/full.mp3',wordpack:[{w:'word',pos:'n.',cn:'隔离测试词义',n:1}],comprehension:[{id:'c1',q:'Fixture question?',options:[{id:'a',text:'A'},{id:'b',text:'B'},{id:'c',text:'C'},{id:'d',text:'D'}],correct_option_id:'b',explanation_en:'Fixture explanation.'}],polysemy:[]};
await api('/api/import',{method:'POST',body:JSON.stringify({inputs:[course,{id:'input_local_01',title:'Hidden fixture',body:['Hidden.']}],sentences:[{id:course.id,items:[{n:1,text:course.body[0],cn:'隔离句译',audioKey:'fixture/s1.mp3'}]}]})});
let requestedDelays=[],mediaStarted=0,paused=0,errors=[];
const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/navigation|HTMLMediaElement/.test(e.message))errors.push(e.message);});
dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base+'/#today',runScripts:'outside-only',virtualConsole:vc});
const w=dom.window,d=w.document;
Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w,'crypto',{value:webcrypto});
w.Blob=Blob;w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
w.fetch=(url,init={})=>fetch(new URL(url,base),{...init,headers:{Authorization:'Bearer '+info.token,...init.headers}});
w.URL.createObjectURL=()=> 'blob:isolated';w.URL.revokeObjectURL=()=>{};
w.HTMLMediaElement.prototype.play=function(){mediaStarted++;return Promise.resolve();};w.HTMLMediaElement.prototype.pause=function(){paused++;};
let tracksStopped=0;
Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>tracksStopped++}]})}});
w.MediaRecorder=class{static isTypeSupported(t){return t==='audio/webm';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['fixture recording'],{type:'audio/webm'})});this.onstop();}};
const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>{if(ms===3000){requestedDelays.push(ms);return timeout(fn,20,...args);}return timeout(fn,ms,...args);};
for(const file of ['config.js','logic.js','reading.js','local-store.js','device-sync.js','store.js','playback-speed.js','word-pronunciation.js','features21.js','workbench.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await wait(10);}throw Error('Timed out: '+fn);}
const submit=f=>f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
async function test(name,fn){await fn();results.push({case:name,result:'PASS'});}
await until(()=>d.querySelector('#reading-check'));
await test('全文调速控件与句卡同步，独立句音沿用速度',async()=>{
 await until(()=>d.querySelector('#full-player + .playback-speed-control'));
 const select=d.querySelector('#full-player + .playback-speed-control select');select.value='0.75';select.dispatchEvent(new w.Event('change',{bubbles:true}));
 assert.equal(d.querySelector('#full-player').playbackRate,.75);
 const NativeAudio=w.Audio;let sentence;w.Audio=function(src){sentence=new NativeAudio(src);return sentence;};
 d.querySelector('[data-unit-button]').click();d.querySelector('#demo-play').click();await until(()=>sentence);
 assert.equal(sentence.playbackRate,.75);assert.equal(d.querySelector('.sentence-actions select').value,'0.75');d.querySelector('#close-card').click();w.Audio=NativeAudio;
});
await test('实际课程渲染、四导航、隐藏Mina入口，无状态页',async()=>{assert.match(d.querySelector('h1').textContent,/Isolated/);assert.equal(d.querySelectorAll('.site-nav a').length,4);assert.equal(d.querySelector('#course-select').options.length,1);assert.equal(d.querySelectorAll('.demo-word').length,5);});
await test('英文选择题提交后可从设备库读取原选择，不写教练correct字段',async()=>{const f=d.querySelector('[data-question-form]');f.querySelector('[value=b]').checked=true;submit(f);await until(()=>d.querySelector('.answer-feedback'));assert.match(d.querySelector('.answer-feedback').textContent,/Correct/);const row=(await w.Data.list('progress')).find(r=>r.id===course.id);assert.equal(row.comprehension.answers[0].option_id,'b');assert.equal(row.comprehension.correct,undefined);});
await test('词卡显示真实释义/句译，加词自动上报，标记可取消',async()=>{const b=[...d.querySelectorAll('.demo-word')].find(b=>b.textContent==='word');b.click();assert.match(d.querySelector('.meaning-placeholder').textContent,/隔离测试词义/);d.querySelector('#demo-translate').click();assert.equal(d.querySelector('#translation-placeholder').textContent,'隔离句译');d.querySelector('#demo-add').click();await until(()=>d.querySelector('#demo-add').textContent==='已加入并上报');assert.equal((await w.Data.list('vocab')).length,1);assert.equal((await w.Data.list('progress')).find(r=>r.id===course.id).unknown_submitted,true);d.querySelector('#demo-flag').click();await until(()=>d.querySelector('.is-confused'));d.querySelector('#demo-flag').click();await until(()=>!d.querySelector('.is-confused'));});
await test('上传真实HTTP/临时SQLite并下载，原教材不改',async()=>{await w.Data.upload();assert.equal((await api('/api/records/progress/'+course.id)).comprehension.answers[0].option_id,'b');await w.Data.download();assert.equal((await api('/api/records/inputs/'+course.id)).title,course.title);});
await test('调速后跟读仍为立即录制/3秒播放，提前结束丢弃且正文保留',async()=>{w.location.hash='shadowing';await until(()=>d.querySelector('#start-record'));const body=d.querySelector('.article-body'),player=d.querySelector('#reference-player');assert.equal(player.playbackRate,.75);d.querySelector('#start-record').click();await until(()=>!d.querySelector('#stop-record').disabled);d.querySelector('#stop-record').click();await until(()=>!d.querySelector('#start-record').disabled);assert.equal((await w.Data.list('shadowing')).length,0);assert.equal(d.querySelector('.article-body'),body);assert.equal(d.querySelector('#reference-player'),player);assert.ok(requestedDelays.includes(3000));});
await test('播完手动停录，多遍各自保存真实Blob并可上传下载',async()=>{for(let i=0;i<2;i++){d.querySelector('#start-record').click();await until(()=>!d.querySelector('#stop-record').disabled);await wait(35);d.querySelector('#reference-player').dispatchEvent(new w.Event('ended'));d.querySelector('#stop-record').click();await until(()=>d.querySelectorAll('[data-record-audio]').length===i+1);}const rows=await w.Data.list('shadowing');assert.equal(rows.length,2);assert.notEqual(rows[0].blobKey,rows[1].blobKey);assert.equal(await (await w.Data.getBlob(rows[0].blobKey)).text(),'fixture recording');await w.Data.upload();assert.equal((await api('/api/records/shadowing')).length,2);assert.ok(tracksStopped>=3);});
await test('生词造句提交与真实进度页可进入，无伪造评分',async()=>{w.location.hash='vocab';await until(()=>d.querySelector('#start-quiz'));d.querySelector('#start-quiz').click();await until(()=>d.querySelector('#vocab-quiz'));const f=d.querySelector('#vocab-quiz');f.querySelector('input').value='词';f.querySelector('textarea').value='My own word.';submit(f);await until(()=>!d.querySelector('#vocab-quiz'));assert.ok((await w.Data.list('progress')).some(r=>r.kind==='vocab_quiz'));w.location.hash='progress';await until(()=>d.querySelector('.input-history'));assert.equal(d.querySelector('.current-state'),null);assert.equal(d.querySelector('#unknown-form'),null);assert.equal(d.querySelector('#difficulty-form'),null);assert.match(d.querySelector('h1').textContent,/clearer/);assert.equal(d.querySelectorAll('.trend-section').length,3);});
assert.deepEqual(errors,[]);
const report={environment:{node:process.version,jsdom:require('jsdom/package.json').version,class:'非真机：隔离HTTP/SQLite，模拟麦克风与媒体API；未验证真实声音/Chrome/Safari'},results};
fs.writeFileSync(require('./test-output.cjs')('四板块接入验证.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{dom?.window.close();child?.kill();fs.rmSync(folder,{recursive:true,force:true});});
