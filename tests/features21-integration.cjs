/* 真实前端/HTTP/临时SQLite，麦克风和计时为替身；非真机。 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-21-test-')),results=[];
let child,dom;
(async()=>{
 const py="import sys,json,time\nsys.path.insert(0,sys.argv[1])\nfrom server import make_server\nfrom test_features21 import package\nfrom sync_engine import push\ns=make_server(sys.argv[2]);p={'id':'daily','date':'2026-10-18','title':'Daily isolated fixture','body':['Try a word. Keep the change.'],'word_count':6,'reused_vocab':['try','word','keep the change'],'wordpack':[{'w':'try','cn':'测试词义'}]}\ns.data.import_bundle({'inputs':[p,package()]+[{'id':'a'+str(i),'title':'Article '+str(i),'body':['Try a word.']} for i in range(11)]})\npush(s.data,{'device_id':'seed','changes':[{'collection':'vocab','id':'vtry','change_id':'1','updated_at':int(time.time()*1000)+10,'data':{'id':'vtry','word':'try','status':'new','review_articles':{'a'+str(i):{} for i in range(11)}}},{'collection':'vocab','id':'vword','change_id':'2','updated_at':int(time.time()*1000)+10,'data':{'id':'vword','word':'word','status':'new'}}]})\ns.data.save_blob('fixtures/listen.mp3',b'ID3isolated',{'mime':'audio/mpeg'})\nprint(json.dumps({'port':s.server_port,'token':s.data.token}),flush=True);s.serve_forever()\n";
 child=spawn(process.env.PYTHON||'python3',['-B','-c',py,path.join(root,'local'),folder],{stdio:['ignore','pipe','pipe']});
 const info=await new Promise((resolve,reject)=>{let buf='';child.stdout.on('data',chunk=>{buf+=chunk;if(buf.includes('\n'))resolve(JSON.parse(buf.split('\n')[0]));});child.on('error',reject);child.stderr.on('data',b=>{if(/Traceback/.test(String(b)))reject(Error('fixture setup failed'));});});
 const base='http://127.0.0.1:'+info.port;
 async function api(route,init={}){const r=await fetch(base+route,{...init,headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json',...init.headers}});assert.ok(r.ok,'HTTP '+r.status+': '+await(r.clone().text()));return r.json();}
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/HTMLMediaElement|navigation/.test(e.message))errors.push(e.message);});
 dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base+'/#today',runScripts:'outside-only',virtualConsole:vc});const w=dom.window,d=w.document;
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w,'crypto',{value:webcrypto});w.Blob=Blob;w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
 w.fetch=(url,init={})=>fetch(new URL(url,base),{...init,headers:{Authorization:'Bearer '+info.token,...init.headers}});
 w.URL.createObjectURL=()=> 'blob:isolated';w.URL.revokeObjectURL=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 w.MediaRecorder=class{static isTypeSupported(t){return t==='audio/webm';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['isolated audio bytes'],{type:'audio/webm'})});this.onstop();}};
 const realInterval=w.setInterval.bind(w);w.setInterval=(fn,ms)=>realInterval(fn,ms===1000?1:ms);
 for(const tag of d.querySelectorAll('script[src]'))w.eval(fs.readFileSync(path.join(root,tag.getAttribute('src')),'utf8'));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){for(let i=0;i<400;i++){if(await fn())return;await wait(10);}throw Error('Timed out: '+fn+'\n'+d.querySelector('#app-status').textContent+'\n'+d.querySelector('#test-message').textContent);}
 const click=id=>d.getElementById(id).click(),fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 async function test(name,fn){await fn();results.push({case:name,result:'PASS'});}
 await until(()=>d.querySelector('[data-open-real-test]'));
 await test('读取正式字段测试包与重逢名单，测试不混入日常教材选择',async()=>{assert.equal(d.querySelectorAll('.reencounter-chip').length,0);assert.equal(d.querySelector('#unknown-form'),null);assert.equal(d.querySelector('#difficulty-form'),null);assert.equal([...d.querySelector('#course-select').options].some(o=>o.value==='test-month'),false);});
 await test('下载词库后文章出现记1次，11→12自动熟识；重读不重复，上传后服务端同值',async()=>{
  click('download-data');await until(()=>d.querySelector('#app-status').textContent.includes('学习数据已下载'));
  assert.equal(d.querySelectorAll('.reencounter-chip').length,4);assert.ok(![...d.querySelectorAll('[data-reencounter-word]')].some(x=>x.parentElement.textContent.includes('keep the change')));
  let v=(await w.Data.list('vocab')).find(v=>v.id==='vtry');assert.equal(Object.keys(v.review_articles).length,12);
  w.location.hash='vocab';await until(()=>d.querySelector('[data-manual-known=vtry]'));assert.match(d.querySelector('[data-manual-known=vtry]').closest('.familiarity-entry').textContent,/满12篇自动/);
  w.location.hash='today';await until(()=>d.querySelector('.reencounter'));await wait(30);await w.Data.upload();v=await api('/api/records/vocab/vtry');assert.equal(v.review_count,12);
 });
 await test('手动熟识可保存和同步，不改写教练状态',async()=>{
  w.location.hash='vocab';await until(()=>d.querySelector('[data-manual-known=vword]'));d.querySelector('[data-manual-known=vword]').click();await until(()=>d.querySelector('#app-status').textContent.includes('熟识标记已存'));await w.Data.upload();
  const row=await api('/api/records/vocab/vword');assert.equal(row.manual_known,true);assert.equal(row.status,'new');
 });
 await test('重逢造句复用quiz记录链路，独立保存原英文句子',async()=>{
  w.location.hash='today';await until(()=>d.querySelector('[data-feature21=reencounter]'));for(const id of ['vtry','vword']){d.querySelector('[data-reencounter-word='+id+']').click();await until(()=>d.querySelector('[data-reencounter-answer='+id+']'));}const form=d.querySelector('[data-feature21=reencounter]');form.querySelectorAll('textarea').forEach(t=>{t.value='My own sentence.';fire(t,'input');});fire(form,'submit');
  await until(()=>d.querySelector('#app-status').textContent.includes('重逢造句已保存'));const row=(await w.Data.list('progress')).find(r=>r.id==='reencounter:daily');assert.equal(row.kind,'vocab_quiz');assert.equal(row.answers.length,2);assert.equal(row.answers[0].sentence,'My own sentence.');assert.equal(d.querySelector('[data-feature21=reencounter]'),null);
 });
 await test('测试听读选择和写作即时关闭时保存草稿，重新打开保留',async()=>{
  d.querySelector('[data-open-real-test]').click();await until(()=>d.querySelector('[data-test-choice=listening]'));
  d.querySelector('[data-test-choice=listening][value=b]').click();click('tab-reading');d.querySelector('[data-test-choice=reading][value=c]').click();click('tab-writing');
  d.querySelector('#real-test-writing').value='My written test response.';fire(d.querySelector('#real-test-writing'),'input');click('close-test');await until(()=>d.querySelector('#level-modal').hidden);
  d.querySelector('[data-open-real-test]').click();await until(()=>d.querySelector('[data-test-choice=listening]'));click('tab-writing');assert.equal(d.querySelector('#real-test-writing').value,'My written test response.');
 });
 await test('口语按Part1/2/3逐问保存真Blob，Part2准备计时后才可回答',async()=>{
  click('tab-speaking');
  assert.ok(d.querySelector('.interview-question-card [data-playback-speed]'),'口语提问内可调播放速度');
  async function answer(){click('real-start-answer');await until(()=>d.querySelector('#real-stop-answer').disabled===false);await wait(20);click('real-stop-answer');await until(()=>d.querySelector('#real-answer-status')?.textContent==='本问回答已保存');}
  await answer();click('real-next-question');assert.equal(d.querySelector('#real-start-answer').disabled,true);click('real-start-preparation');await until(()=>!d.querySelector('#real-start-answer').disabled);await answer();click('real-next-question');await answer();
  const row=(await w.Data.list('progress')).find(r=>r.kind==='level_test');assert.equal(row.answers.speaking.length,3);for(const a of row.answers.speaking)assert.equal(await(await w.Data.getBlob(a.blobKey)).text(),'isolated audio bytes');
 });
 await test('提交→上传→Muse读取/批改→下载真实接口闭环，口语不进入跟读',async()=>{
  click('real-test-submit');await until(()=>d.querySelector('#test-submitted-state').hidden===false);click('close-test');await until(()=>d.querySelector('#level-modal').hidden);await w.Data.upload();
  const row=await api('/api/records/progress/level_test%3Atest-month');assert.equal(row.status,'submitted');assert.equal(row.completed,false);assert.equal((await api('/api/records/shadowing')).length,0);
  const pending=await api('/api/coach/pending');assert.ok(pending.progress.some(r=>r.id===row.id));
  const assessment={scores:{listening:6,reading:7,speaking:5,writing:5},overall_comment:'Isolated review',level:'Isolated level',next_month_advice:'Isolated advice'};
  await api('/api/coach/grades',{method:'POST',body:JSON.stringify({updates:[{collection:'progress',id:row.id,grade:{assessment}}]})});click('download-data');await until(()=>d.querySelector('#app-status').textContent.includes('学习数据已下载'));
  w.location.hash='progress';await until(()=>d.querySelector('.level-history .assessment-scores'));assert.match(d.querySelector('.level-history').textContent,/Isolated advice/);assert.equal(d.querySelectorAll('.trend-section').length,3);
 });
 assert.deepEqual(errors,[]);
 const report={environment:{node:process.version,classification:'非真机：真实前端/临时HTTP/SQLite；模拟麦克风、媒体和准备计时；非Muse云端实测'},results};
 fs.writeFileSync(require('./test-output.cjs')('2.1扩展接入验证.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{dom?.window.close();child?.kill();fs.rmSync(folder,{recursive:true,force:true});});
