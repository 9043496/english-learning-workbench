import {tmpdir} from 'node:os';
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {JSDOM,VirtualConsole} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {standin} from './supabase-standin.mjs';
import {users,testPack,change} from './database.mjs';
const execute=promisify(execFile),root=fileURLToPath(new URL('..',import.meta.url));
let backend,runtime,folder,site,devices=[],offline=false;
const mime=name=>name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/json';
async function dispatch(path,init={},name='a'){
 return runtime.dispatchFetch('https://workbench.test'+path,{...init,headers:{Cookie:'__Host-wb-access=verify-access-'+name,...init.headers}});
}
const fixture=()=>{
 const options=['a','b','c','d'].map(id=>({id,text:'Fixture option '+id}));
 return {id:'daily-fixture',title:'Cloud isolation fixture',title_cn:'云端工程夹具（非正式教材）',date:'2026-10-20',body:['Try a word. Keep the change.'],audioKey:'daily-fixture/full.mp3',word_count:7,wordpack:[{w:'try',pos:'v.',cn:'尝试',n:1},{w:'word',pos:'n.',cn:'单词',n:1},{w:'keep the change',pos:'phrase',cn:'不用找零',phrase:true,n:2}],reused_vocab:['try','word','keep the change'],comprehension:[{id:'daily-q',q:'Fixture reading question?',options,correct_option_id:'b',explanation_en:'Fixture explanation.'}],polysemy:[{id:'daily-p',q:'Fixture contextual meaning?',options,correct_option_id:'a',explanation_en:'Fixture explanation.'}]};
};
before(async()=>{
 backend=await standin();folder=await mkdtemp(join(tmpdir(),'wb-free-cloud-'));site=join(folder,'pages');
 await execute(process.execPath,[join(root,'tools/build.mjs'),'--output',site]);
 const pack=fixture();
 await backend.d.rpc(users.coach,'wb_import',{p_owner:users.a,p_bundle:{inputs:[pack,testPack()],sentences:[{id:pack.id,items:[{n:1,text:'Try a word.',cn:'试一个词。',audioKey:'daily-fixture/s1.mp3'},{n:2,text:'Keep the change.',cn:'不用找零。',audioKey:'daily-fixture/s2.mp3'}]}]}});
 await backend.d.rpc(users.a,'wb_push',{p_owner:users.a,p_payload:{device_id:'fixture',changes:[change('known-try',{word:'try',status:'new'},'vocab'),change('known-word',{word:'word',status:'new'},'vocab'),change('known-change',{word:'keep the change',status:'new'},'vocab')]}});
 runtime=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{
  modules:true,script:await readFile(join(site,'_worker.js'),'utf8'),compatibilityDate:'2026-10-01',
  bindings:{SUPABASE_URL:'https://verification.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_verification_public_key'},
  serviceBindings:{ASSETS:async request=>{
   const path=new URL(request.url).pathname,filename=path==='/'?'index.html':path.slice(1);
   if(filename.includes('..')||filename.includes('/'))return new Response(null,{status:404});
   try{return new Response(await readFile(join(site,filename)),{headers:{'Content-Type':mime(filename)}});}catch{return new Response(null,{status:404});}
  }},
  outboundService:request=>offline?new Response('offline fixture',{status:503}):backend.fetch(request)
 }]}));
 await runtime.ready;
});
after(async()=>{for(const d of devices)d.dom.window.close();await runtime?.dispose();await backend?.close();if(folder)await rm(folder,{recursive:true,force:true});});
async function device(name='a',storage=new IDBFactory()){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});
 const html=await (await dispatch('/',{},name)).text(),dom=new JSDOM(html,{url:'https://workbench.test/#today',runScripts:'outside-only',virtualConsole:vc}),w=dom.window,d=w.document;
 Object.defineProperty(w,'indexedDB',{value:storage});w.Blob=Blob;w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.structuredClone=structuredClone;w.AbortSignal=AbortSignal;
 w.fetch=async(input,init={})=>dispatch(String(input),init,name);
 w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
 w.URL.createObjectURL=()=> 'blob:isolated-cloud-fixture';w.URL.revokeObjectURL=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
 w.MediaRecorder=class{static isTypeSupported(t){return t==='audio/webm';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['fixture-recording-bytes'],{type:this.mimeType})});this.onstop();}};
 const rawTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>rawTimeout(fn,ms===3000?5:ms,...args);
 for(const script of d.querySelectorAll('script[src]')){
  const src=script.getAttribute('src');
  w.eval(src==='cloud-session.js'?await(await dispatch('/cloud-session.js',{},name)).text():await readFile(join(site,src),'utf8'));
 }
 const until=async fn=>{for(let i=0;i<600;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+fn+' | '+d.querySelector('#app-status')?.textContent+' | '+errors.join(','));};
 const fire=(el,type)=>el.dispatchEvent(new w.Event(type,{bubbles:true,cancelable:true}));
 const result={dom,w,d,errors,until,fire,storage,click:selector=>{const el=d.querySelector(selector);assert.ok(el,selector);el.click();}};
 devices.push(result);await until(()=>w.Data.status().connected&&d.querySelector('#workspace h1')&&d.querySelector('#app-status').textContent==='');return result;
}
let mac,phone;
test('CF01 Cloudflare workerd实际执行：健康检查、登录页、受保护首页与数据库可达检查',async()=>{
 assert.equal((await dispatch('/health')).status,200);
 const check=await dispatch('/api/cloud/check');assert.equal(check.status,200,await check.clone().text()+' '+JSON.stringify(backend.calls));assert.equal((await check.json()).database,'reachable');
 assert.equal((await dispatch('/login.html')).status,200);
 assert.equal((await runtime.dispatchFetch('https://workbench.test/',{redirect:'manual'})).status,303);
 const page=await dispatch('/');assert.match(page.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.match(await page.text(),/水平测试/);
});
test('CF02 完整前端与账号缓存接入：四导航/月测/正文词卡，两个模拟设备独立本地库',async()=>{
 mac=await device();phone=await device();
 assert.equal(mac.d.querySelectorAll('.site-nav a').length,4);assert.ok(mac.d.querySelector('[data-open-real-test]'));
 assert.equal(mac.d.querySelector('#unknown-form'),null);assert.equal(mac.d.querySelector('#difficulty-form'),null);
 assert.equal((await mac.w.Data.list('progress')).length,0);assert.equal((await phone.w.Data.list('progress')).length,0);
 mac.click('#reading-check');await mac.until(async()=> (await mac.w.Data.list('progress')).some(x=>x.id==='daily-fixture'));
 assert.equal((await phone.w.Data.list('progress')).length,0);
});
test('CF03 Mac作答→显式上传→iPhone下载→刷新保留；教练批改与冲突保护端到端',async()=>{
 await mac.w.Data.upload();await phone.w.Data.download();assert.equal((await phone.w.Data.list('progress')).find(r=>r.id==='daily-fixture').reading_checked,true);
 await phone.w.Data.patch('progress','daily-fixture',{reading_checked:false,device_note:'phone'});const outcome=await phone.w.Data.upload();assert.ok(outcome.conflicts);
 await mac.w.Data.download();assert.equal((await mac.w.Data.list('progress')).find(r=>r.id==='daily-fixture').reading_checked,true);
 const form=mac.d.querySelector('[data-question-form=comprehension]');form.querySelector('[value=b]').click();mac.fire(form,'submit');await mac.until(()=>mac.d.querySelector('.answer-feedback'));await mac.w.Data.upload();
 const score=await dispatch('/api/coach/grades',{method:'POST',headers:{'Content-Type':'application/json','X-Learner-Id':users.a},body:JSON.stringify({updates:[{collection:'progress',id:'daily-fixture',grade:{comprehension:{correct:1,total:1,note:'Isolated evidence'}}}]})},'coach');assert.equal(score.status,200);
 await phone.w.Data.download();const record=(await phone.w.Data.list('progress')).find(r=>r.id==='daily-fixture');assert.equal(record.comprehension.correct,1);
 await phone.w.Data.patch('progress','daily-fixture',{comprehension:null});assert.ok((await phone.w.Data.upload()).conflicts);await mac.w.Data.download();assert.equal((await mac.w.Data.list('progress')).find(r=>r.id==='daily-fixture').comprehension.correct,1);
 const reloaded=await device('a',phone.storage);assert.equal((await reloaded.w.Data.list('progress')).find(r=>r.id==='daily-fixture').comprehension.correct,1);
});
test('CF04 非真机麦克风：提前结束保留正文且丢弃，多遍录音通过云接口下载字节一致',async()=>{
 mac.w.location.hash='shadowing';await mac.until(()=>mac.d.querySelector('#start-record'));
 const body=mac.d.querySelector('.article-body'),reference=mac.d.querySelector('#reference-player');
 mac.click('#start-record');await mac.until(()=>!mac.d.querySelector('#stop-record').disabled);mac.click('#stop-record');await mac.until(()=>!mac.d.querySelector('#start-record').disabled);assert.equal((await mac.w.Data.list('shadowing')).length,0);assert.equal(mac.d.querySelector('.article-body'),body);
 for(let n=0;n<2;n++){mac.click('#start-record');await mac.until(()=>!mac.d.querySelector('#stop-record').disabled);reference.dispatchEvent(new mac.w.Event('ended'));mac.click('#stop-record');await mac.until(()=>mac.d.querySelectorAll('[data-record-audio]').length===n+1);}
 await mac.w.Data.upload();await phone.w.Data.download();const takes=await phone.w.Data.list('shadowing');assert.equal(takes.length,2);assert.notEqual(takes[0].blobKey,takes[1].blobKey);
 for(const take of takes){const blob=await phone.w.Data.getBlob(take.blobKey);assert.equal(blob.type,'audio/webm');assert.equal(await blob.text(),'fixture-recording-bytes');}
});
test('CF05 月测四项与三部分、词库熟识与进度入口保持；同浏览器换账号不泄漏本地作答',async()=>{
 mac.w.location.hash='today';await mac.until(()=>mac.d.querySelector('[data-open-real-test]'));mac.click('[data-open-real-test]');await mac.until(()=>mac.d.querySelector('[data-test-choice=listening]'));
 for(const kind of ['reading','speaking','writing']){mac.click('#tab-'+kind);if(kind==='speaking')assert.equal(mac.d.querySelectorAll('[data-real-part]').length,3);}
 mac.click('#close-test');await mac.until(()=>mac.d.querySelector('#level-modal').hidden);
 mac.w.location.hash='vocab';await mac.until(()=>mac.d.querySelector('[data-manual-known]'));
 mac.w.location.hash='progress';await mac.until(()=>mac.d.querySelector('.level-history'));assert.equal(mac.d.querySelectorAll('.trend-section').length,3);
 const stranger=await device('b',mac.storage);assert.equal((await stranger.w.Data.list('progress')).length,0);assert.equal((await stranger.w.Data.list('shadowing')).length,0);assert.equal((await stranger.w.Data.list('inputs')).length,0);
 assert.deepEqual(mac.errors,[]);assert.deepEqual(phone.errors,[]);
});
test('CF06 断网失败保留本机作答和录音，上线不暗自上传；重新打开同账号后可重试成功',async()=>{
 offline=true;
 await phone.w.Data.patch('progress','offline-fixture',{is_test:true,text:'offline original'});
 await phone.w.Data.saveBlob('shadowing/offline-fixture.webm',new Blob(['offline bytes'],{type:'audio/webm'}),{mime:'audio/webm'});
 await phone.w.Data.patch('shadowing','offline-take',{is_test:true,blobKey:'shadowing/offline-fixture.webm'});
 const pending=phone.w.Data.pending();assert.ok(pending>=3);await assert.rejects(phone.w.Data.upload());assert.equal(phone.w.Data.pending(),pending);assert.equal(await(await phone.w.Data.getBlob('shadowing/offline-fixture.webm')).text(),'offline bytes');
 offline=false;await phone.w.Data.probe();
 const before=await backend.d.rpc(users.a,'wb_pull',{p_owner:users.a,p_since:0});assert.equal(before.records.some(r=>r.id==='offline-fixture'),false);
 const reopened=await device('a',phone.storage);assert.equal((await reopened.w.Data.list('progress')).find(r=>r.id==='offline-fixture').text,'offline original');await reopened.w.Data.upload();await mac.w.Data.download();assert.equal((await mac.w.Data.list('progress')).find(r=>r.id==='offline-fixture').text,'offline original');
});
test('CF07 用户报告的旧占位文案/Muse链接/加载说明移除，完整题目及批改保留',async()=>{
 const populated=await device();
 assert.ok(populated.d.querySelector('[data-question-form=polysemy]'));
 assert.match(populated.d.querySelector('[data-question-form=polysemy]').textContent,/Words in context/);
 const form=populated.d.querySelector('[data-question-form=polysemy]');
 form.querySelector('[value=a]').click();populated.fire(form,'submit');
 await populated.until(()=>populated.d.querySelector('[data-question-form=polysemy] .answer-feedback'));
 assert.match(populated.d.querySelector('[data-question-form=polysemy]').textContent,/Fixture explanation/);
 // Reproduce the deployed minimal transport fixture, without adding fake questions.
 await backend.d.rpc(users.coach,'wb_import',{p_owner:users.a,p_bundle:{inputs:[{id:'missing-questions',date:'2026-10-21',title:'ENGINEERING VERIFICATION — NOT A LESSON',is_test:true,body:['This is an isolated transport test.']}]}});
 const minimal=await device();
 assert.equal(minimal.d.querySelector('.practice-form'),null);
 assert.ok(minimal.d.querySelector('.article-body'));
 assert.match(minimal.d.querySelector('.cloud-validation').textContent,/云端隔离验证版/);
 for(const page of [minimal,populated]){
  assert.equal(page.d.querySelector('a[href*="muse.ai"]'),null);
  assert.doesNotMatch(page.d.body.textContent,/尚未提供完整选择题|不会自动改造旧题|云端验证数据已读取/);
  assert.equal(page.d.querySelector('#app-status').textContent.startsWith('云端验证数据'),false);
  assert.ok(page.d.querySelector('#upload-data'));assert.ok(page.d.querySelector('#download-data'));
 }
});
test('CF08 正式账号显示云端学习空间；初次仍显式下载，不自动上传/下载历史',async()=>{
 try{
  backend.profiles.set(users.a,{app_metadata:{workbench_role:'learner',workbench_ready:true,engineering_fixture:false}});
  const formal=await device();
  assert.match(formal.d.querySelector('.cloud-validation').textContent,/云端学习空间/);
  assert.doesNotMatch(formal.d.querySelector('.cloud-validation').textContent,/工程账号|隔离验证版/);
  assert.equal((await formal.w.Data.list('progress')).length,0);
  formal.click('#download-data');await formal.until(()=>formal.d.querySelector('#app-status').textContent.includes('学习数据已下载'));
  assert.ok((await formal.w.Data.list('progress')).length>0);
  assert.equal(formal.d.querySelectorAll('.site-nav a').length,4);
 }finally{backend.profiles.delete(users.a);}
});
test('CF09 账号设置可修改密码；不匹配/错误当前密码提示、成功清空字段、关闭清除，不影响学习缓存',async()=>{
 const user=await device(),form=user.d.querySelector('#cloud-password-form'),status=user.d.querySelector('#cloud-password-status');
 await user.w.Data.patch('progress','settings-draft',{text:'Unsynced learning answer'});const before=await user.w.Data.list('progress'),pending=user.w.Data.pending();assert.ok(pending>0);user.click('#cloud-settings');assert.equal(user.d.querySelector('#cloud-account-settings').open,true);
 form.elements.current_password.value='fixture-password';form.elements.new_password.value='Changed-fixture-123';form.elements.confirm_password.value='mismatch';user.fire(form,'submit');assert.match(status.textContent,/两次输入一致/);
 form.elements.current_password.value='wrong';form.elements.confirm_password.value='Changed-fixture-123';user.fire(form,'submit');await user.until(()=>status.textContent.includes('当前密码不正确'));assert.equal(backend.passwords.size,0);
 form.elements.current_password.value='fixture-password';user.fire(form,'submit');await user.until(()=>status.textContent.includes('密码已更新'));
 for(const field of form.querySelectorAll('input'))assert.equal(field.value,'');assert.deepEqual(await user.w.Data.list('progress'),before);assert.equal(user.w.Data.pending(),pending);
 user.click('#cloud-settings-close');assert.equal(user.d.querySelector('#cloud-account-settings').open,false);assert.equal(user.d.activeElement.id,'cloud-settings');
 user.click('#cloud-settings');form.elements.new_password.value='not-persisted';user.click('#cloud-settings-close');assert.equal(form.elements.new_password.value,'');assert.equal(user.d.querySelectorAll('.site-nav a').length,4);backend.passwords.clear();
});
