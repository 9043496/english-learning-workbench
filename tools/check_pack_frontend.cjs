/* 真前端+临时HTTP/SQLite+真实新教材；模拟DOM/媒体，不是真机。 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{webcrypto}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const root=path.resolve(__dirname,'..'),archive=path.resolve(process.argv[2]),reportPath=path.resolve(process.argv[3]);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'learning-content-qa-'));let child,dom;const results=[];
(async()=>{
 const py="import sys,json\nsys.path.insert(0,sys.argv[1])\nfrom server import make_server\nfrom import_muse import import_zip\ns=make_server(sys.argv[2]);result=import_zip(s.data,sys.argv[3]);print(json.dumps({'port':s.server_port,'token':s.data.token,'import':result}),flush=True);s.serve_forever()\n";
 child=spawn(process.env.PYTHON||'python3',['-B','-c',py,path.join(root,'local'),folder,archive],{stdio:['ignore','pipe','pipe']});
 const info=await new Promise((resolve,reject)=>{let b='';const timer=setTimeout(()=>reject(Error('隔离服务启动超时')),15000);child.stdout.on('data',v=>{b+=v;if(b.includes('\n')){clearTimeout(timer);resolve(JSON.parse(b.split('\n')[0]));}});child.stderr.on('data',()=>{});child.on('exit',code=>{if(code)reject(Error('隔离导入服务失败'));});});
 const base='http://127.0.0.1:'+info.port;
 async function api(route,init={}){const r=await fetch(base+route,{...init,headers:{Authorization:'Bearer '+info.token,'Content-Type':'application/json',...init.headers}});assert.ok(r.ok,'HTTP '+r.status);return r.json();}
 const packs=await api('/api/records/inputs'),p=packs[0],sentences=(await api('/api/records/sentences'))[0].items,errors=[];
 const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/HTMLMediaElement|navigation/.test(e.message))errors.push(e.message);});
 dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base+'/?diagnostics=1#today',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document;Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});Object.defineProperty(w,'crypto',{value:webcrypto});w.Blob=Blob;w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;
 w.fetch=(url,init={})=>fetch(new URL(url,base),{...init,headers:{Authorization:'Bearer '+info.token,...init.headers}});
 w.URL.createObjectURL=()=> 'blob:isolated';w.URL.revokeObjectURL=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();w.HTMLMediaElement.prototype.pause=()=>{};
 for(const tag of d.querySelectorAll('script[src]'))w.eval(fs.readFileSync(path.join(root,tag.getAttribute('src').split('?')[0]),'utf8'));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function until(fn){for(let i=0;i<500;i++){if(fn())return;await wait(10);}throw Error('等待页面条件超时');}
 await until(()=>d.querySelector('#app-status').textContent.includes('真实教材已读取'));
 async function test(name,fn){await fn();results.push({case:name,result:'PASS'});}
 await test('增量包可导入空白隔离库，正文与49句映射齐全',async()=>{assert.equal(d.querySelector('h1').textContent,p.title);assert.equal(d.querySelectorAll('.sentence-unit').length,sentences.length);assert.equal((await api('/api/blobs')).length,sentences.length+1);});
 await test('每个正文可点击词或短语都显示实有词性中文义，无未收录',async()=>{const buttons=[...d.querySelectorAll('[data-part]')];assert.ok(buttons.length>200);for(const b of buttons){b.click();assert.doesNotMatch(d.querySelector('.meaning-placeholder').textContent,/未收录/);assert.ok(d.querySelector('.meaning-placeholder').textContent.trim());}results.push({metric:'逐一核对的点击位置',count:buttons.length});});
 await test('change两种语境分别映射更改与找零，不串义',async()=>{const values=[];for(const b of [...d.querySelectorAll('[data-part]')].filter(b=>b.textContent==='change')){b.click();values.push(d.querySelector('.meaning-placeholder').textContent);}assert.ok(values.some(x=>x.includes('更改')));assert.ok(values.some(x=>x.includes('找零')));});
 await test('逐句中文默认隐藏、点击按真实n显示对应译文',async()=>{for(const n of [1,2,sentences.length]){const b=d.querySelector('[data-unit="'+n+'"] .sentence-dot');assert.ok(b);b.click();assert.equal(d.querySelector('#translation-placeholder').hidden,true);d.querySelector('#demo-translate').click();assert.equal(d.querySelector('#translation-placeholder').textContent,sentences.find(s=>s.n===n).cn);}});
 await test('4道理解/2道多义词英文单选真实提交后呈现答案解析',async()=>{for(const kind of ['comprehension','polysemy']){const form=d.querySelector('[data-question-form="'+kind+'"]');for(const q of p[kind])form.querySelector('input[name="'+q.id+'"][value="'+q.correct_option_id+'"]').checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>d.querySelectorAll('[data-question-form="'+kind+'"] .answer-feedback').length===p[kind].length);}});
 await test('只读诊断匹配实际服务器词包数，输出不含私密鉴权',async()=>{const report=d.querySelector('#word-diagnostics-json').textContent,j=JSON.parse(report);assert.equal(j.loaded.wordpack_count,p.wordpack.length);assert.equal(j.server.wordpack_count,p.wordpack.length);assert.equal(report.includes(info.token),false);});
 await test('隔离页面学习数据未被冒充真实用户记录上传',async()=>{assert.deepEqual(await api('/api/records/progress'),[]);assert.deepEqual(await api('/api/records/vocab'),[]);assert.deepEqual(await api('/api/records/shadowing'),[]);});
 await wait(50);assert.deepEqual(errors,[]);
 const report={input_id:p.id,environment:{node:process.version,jsdom:require('jsdom/package.json').version,classification:'非真机：实际前端/隔离HTTP与SQLite/真实教材；模拟DOM与媒体；不证明iPhone音频自然度或真实麦克风'},results};
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>{dom?.window.close();child?.kill();fs.rmSync(folder,{recursive:true,force:true});});
