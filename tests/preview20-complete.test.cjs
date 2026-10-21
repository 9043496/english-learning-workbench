/* Complete-baseline regression. DOM/media/microphone are simulated: NOT real-device testing. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom');
const folder=path.join(__dirname,'../preview-2.0');
async function setup(hash='today'){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message);});
 const dom=new JSDOM(fs.readFileSync(path.join(folder,'index.html'),'utf8'),{url:'http://127.0.0.1:8791/#'+hash,runScripts:'outside-only',virtualConsole:vc,pretendToBeVisual:true}),w=dom.window,d=w.document;
 let writes=0,tracks=0;
 w.structuredClone=structuredClone;w.Blob=Blob;w.fetch=()=>{writes++;throw Error('Review must not call backend');};
 for(const name of ['localStorage','indexedDB'])Object.defineProperty(w,name,{get(){writes++;throw Error('Review must not access '+name);}});
 w.HTMLMediaElement.prototype.pause=()=>{};w.HTMLMediaElement.prototype.play=()=>Promise.resolve();
 w.URL.createObjectURL=()=> 'blob:review-isolated';w.URL.revokeObjectURL=()=>{};
 Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){tracks++;}}]})}});
 w.MediaRecorder=class{static isTypeSupported(t){return t==='audio/webm';}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['simulated review recording'],{type:'audio/webm'})});this.onstop();}};
 const interval=w.setInterval.bind(w),timeout=w.setTimeout.bind(w);w.setInterval=(fn,ms,...args)=>interval(fn,ms===1000?1:ms,...args);w.setTimeout=(fn,ms,...args)=>timeout(fn,ms===3000?5:ms,...args);
 for(const tag of d.querySelectorAll('script[src]'))w.eval(fs.readFileSync(path.join(folder,tag.getAttribute('src').split('?')[0]),'utf8'));
 const until=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out: '+fn+'\n'+d.querySelector('#app-status').textContent+'\n'+d.querySelector('#test-message').textContent);};
 const click=s=>{const el=d.querySelector(s);assert.ok(el,s);el.click();};
 const fire=(el,name)=>el.dispatchEvent(new w.Event(name,{bubbles:true,cancelable:true}));
 await until(()=>d.querySelector('#app-status').textContent.includes('完整前端审核'));
 return {w,d,dom,click,fire,until,errors,writes:()=>writes,tracks:()=>tracks,async close(){await new Promise(resolve=>setImmediate(resolve));dom.window.close();}};
}
test('以2.1核对首页：月测/题组/阅读/同步保留，两个旧独立表单必须不存在',async()=>{
 const e=await setup();try{assert.equal(e.d.querySelectorAll('.site-nav a').length,4);assert.ok(e.d.querySelector('[data-open-real-test]'));assert.ok(e.d.querySelector('#open-review-story'));assert.equal(e.d.querySelectorAll('[data-question-form="comprehension"] .practice-question').length,4);assert.equal(e.d.querySelectorAll('[data-question-form="polysemy"] .practice-question').length,2);for(const id of ['reading-check','upload-data','download-data','view-conflicts'])assert.ok(e.d.getElementById(id),id);assert.equal(e.d.querySelector('#unknown-form'),null);assert.equal(e.d.querySelector('#difficulty-form'),null);assert.doesNotMatch(e.d.querySelector('#workspace').textContent,/提交生词上报|提交难度反馈|单词或短语，以逗号分隔/);assert.equal(e.d.querySelector('.article-body table'),null);assert.equal(e.d.querySelector('#course-select').options.length,2);assert.equal(e.errors.length,0);}finally{await e.close();}
});
test('月测真实原组件四项可进入：听读四选一、口语三部分、写作草稿关闭重开保留',async()=>{
 const e=await setup();try{
  e.click('[data-open-real-test]');await e.until(()=>e.d.querySelector('[data-test-choice="listening"]'));assert.equal(e.d.querySelectorAll('[data-test-tab]').length,4);assert.equal(e.d.querySelectorAll('.assessment-choice').length,2);assert.equal(e.d.querySelector('.assessment-choice').querySelectorAll('input').length,4);
  e.click('[data-test-choice="listening"][value="a"]');e.click('#tab-reading');e.click('[data-test-choice="reading"][value="a"]');assert.ok(e.d.querySelector('#real-test-content .article-body'));
  e.click('#tab-speaking');assert.equal(e.d.querySelectorAll('[data-real-part]').length,3);e.click('[data-real-part="2"]');assert.ok(e.d.querySelector('#real-start-preparation'));assert.equal(e.d.querySelector('#real-start-answer').disabled,true);
  e.click('#tab-writing');e.d.querySelector('#real-test-writing').value='An original review draft.';e.fire(e.d.querySelector('#real-test-writing'),'input');e.click('#close-test');await e.until(()=>e.d.querySelector('#level-modal').hidden);
  e.click('[data-open-real-test]');await e.until(()=>!e.d.querySelector('#level-modal').hidden);e.click('#tab-writing');assert.equal(e.d.querySelector('#real-test-writing').value,'An original review draft.');e.click('#tab-listening');assert.equal(e.d.querySelector('[data-test-choice="listening"][value="a"]').checked,true);assert.equal(e.writes(),0);
 }finally{await e.close();}
});
test('月测可走完听读写与5问口语，Part2准备60秒，原始Blob与完整提交独立保留',async()=>{
 const e=await setup();try{
  e.click('[data-open-real-test]');await e.until(()=>e.d.querySelector('[data-test-choice="listening"]'));
  for(const kind of ['listening','reading']){e.click('#tab-'+kind);e.d.querySelectorAll('.assessment-choice').forEach(f=>f.querySelector('input').click());}
  e.click('#tab-writing');e.d.querySelector('#real-test-writing').value='Please meet me at the café tomorrow.';e.fire(e.d.querySelector('#real-test-writing'),'input');e.click('#tab-speaking');
  async function answer(){e.click('#real-start-answer');await e.until(()=>!e.d.querySelector('#real-stop-answer').disabled);e.click('#real-stop-answer');await e.until(()=>e.d.querySelector('#real-answer-status')?.textContent==='本问回答已保存');}
  await answer();e.click('#real-next-question');await answer();e.click('#real-next-question');assert.equal(e.d.querySelector('#real-preparation-clock').textContent,'01:00');e.click('#real-start-preparation');await e.until(()=>!e.d.querySelector('#real-start-answer').disabled);await answer();e.click('#real-next-question');await answer();e.click('#real-next-question');await answer();
  e.click('#real-test-submit');await e.until(()=>!e.d.querySelector('#test-submitted-state').hidden);const row=(await e.w.Data.list('progress')).find(r=>r.inputId==='review-month-now');assert.equal(row.status,'submitted');assert.equal(row.answers.speaking.length,5);for(const a of row.answers.speaking)assert.equal(await(await e.w.Data.getBlob(a.blobKey)).text(),'simulated review recording');assert.equal((await e.w.Data.list('shadowing')).length,0);assert.equal(e.writes(),0);
 }finally{await e.close();}
});
test('月测独立结果保留四项分、总评、水平与下月建议，原三趋势/周报/每篇记录同时存在',async()=>{
 const e=await setup('progress');try{assert.ok(e.d.querySelector('.level-history .assessment-scores'));assert.equal(e.d.querySelectorAll('.assessment-scores dd').length,4);assert.match(e.d.querySelector('.level-history').textContent,/总评.*水平判定.*下月难度建议/s);assert.equal(e.d.querySelectorAll('.trend-section').length,3);assert.ok(e.d.querySelector('.input-history'));assert.ok(e.d.querySelector('.weekly-review'));assert.ok(e.d.querySelector('iframe[src*="embed=metrics"]'));}finally{await e.close();}
});
test('日常理解题与多义词题原选择、英文答案解析和追加反馈不丢失',async()=>{
 const e=await setup();try{for(const kind of ['comprehension','polysemy']){const form=e.d.querySelector('[data-question-form="'+kind+'"]');form.querySelectorAll('.practice-question').forEach(f=>f.querySelector('input').click());e.fire(form,'submit');await e.until(()=>e.d.querySelector('[data-question-form="'+kind+'"] .answer-feedback'));assert.match(e.d.querySelector('[data-question-form="'+kind+'"] .answer-feedback').textContent,/Correct answer/);}const p=(await e.w.Data.list('progress')).find(r=>r.id==='review-daily-01');assert.equal(p.comprehension.answers.length,4);assert.equal(p.polysemy.answers.length,2);assert.equal(e.writes(),0);}finally{await e.close();}
});
test('旧词只改为选2–3造句，保留原quiz提交链路与所有其他日常表单',async()=>{
 const e=await setup();try{e.click('[data-review-word="latte"]');await e.until(()=>e.d.querySelector('[data-review-answer="latte"]'));e.d.querySelector('[data-review-answer="latte"]').value='I drink a latte.';e.fire(e.d.querySelector('[data-review-answer="latte"]'),'input');e.click('[data-review-word="paint"]');await e.until(()=>e.d.querySelector('[data-review-answer="paint"]'));assert.equal(e.d.querySelector('[data-review-answer="latte"]').value,'I drink a latte.');e.d.querySelector('[data-review-answer="paint"]').value='I paint on Sunday.';e.fire(e.d.querySelector('[data-review-answer="paint"]'),'input');e.fire(e.d.querySelector('[data-feature21="reencounter-choice"]'),'submit');await e.until(()=>e.d.querySelector('.review-status')?.textContent.includes('已在审核页提交'));const row=(await e.w.Data.list('progress')).find(r=>r.id==='reencounter:review-daily-01');assert.equal(row.kind,'vocab_quiz');assert.equal(row.answers.length,2);assert.equal(e.d.querySelector('#unknown-form'),null);assert.ok(e.d.querySelector('[data-question-form="polysemy"]'));}finally{await e.close();}
});
test('生词抽查中文回忆与英文造句、熟识和历史来源恢复且可操作',async()=>{
 const e=await setup('vocab');try{assert.ok(e.d.querySelector('.encounter-history'));assert.ok(e.d.querySelector('[data-manual-known]'));e.click('#start-quiz');await e.until(()=>e.d.querySelector('#vocab-quiz'));const form=e.d.querySelector('#vocab-quiz');form.querySelectorAll('.quiz-word').forEach(f=>{f.querySelector('input').value='自己的回忆';f.querySelector('textarea').value='My own English sentence.';});e.fire(form,'submit');await e.until(()=>!e.d.querySelector('#vocab-quiz'));assert.ok((await e.w.Data.list('progress')).some(r=>r.kind==='vocab_quiz'));assert.equal(e.writes(),0);}finally{await e.close();}
});
test('原录音控件保留，提前结束丢弃不隐藏正文/参考，完整两遍分别保存和试听',async()=>{
 const e=await setup('shadowing');try{const body=e.d.querySelector('.article-body'),player=e.d.querySelector('#reference-player');e.click('#start-record');await e.until(()=>!e.d.querySelector('#stop-record').disabled);e.click('#stop-record');await e.until(()=>!e.d.querySelector('#start-record').disabled);assert.equal((await e.w.Data.list('shadowing')).length,0);assert.equal(e.d.querySelector('.article-body'),body);assert.equal(e.d.querySelector('#reference-player'),player);
  for(let i=0;i<2;i++){e.click('#start-record');await e.until(()=>!e.d.querySelector('#stop-record').disabled);player.dispatchEvent(new e.w.Event('ended'));e.click('#stop-record');await e.until(()=>e.d.querySelectorAll('[data-record-audio]').length===i+1);}
  const rows=await e.w.Data.list('shadowing');assert.equal(rows.length,2);assert.notEqual(rows[0].blobKey,rows[1].blobKey);assert.equal(e.d.querySelectorAll('[data-record-audio] audio').length,2);assert.equal(e.d.querySelectorAll('.take-feedback').length,2);assert.ok(e.d.querySelector('iframe[src*="embed=record"]'));assert.ok(e.tracks()>=3);assert.equal(e.writes(),0);
 }finally{await e.close();}
});
test('上传/下载/同步记录入口保留，审核模式不会误发正式API或存储',async()=>{
 const e=await setup();try{assert.equal(e.d.querySelector('#upload-data').disabled,false);e.click('#upload-data');await e.until(()=>e.d.querySelector('#app-status').textContent.includes('审核页只演示'));e.click('#download-data');await e.until(()=>e.d.querySelector('#app-status').textContent.includes('不读取或修改正式学习库'));e.click('#view-conflicts');await e.until(()=>e.d.querySelector('#app-status').textContent.includes('不连接正式同步服务'));assert.match(e.d.querySelector('#sync-state').textContent,/与正式后端隔离/);assert.equal(e.writes(),0);}finally{await e.close();}
});
test('故事入口作为增量弹层打开，关闭后原水平测试和日常题目依然存在',async()=>{
 const e=await setup();try{e.click('#open-review-story');assert.ok(e.d.querySelector('#review-story-dialog[open]'));assert.match(e.d.querySelector('#review-story-holder iframe').src,/embed=story/);e.click('#close-review-story');assert.equal(e.d.querySelector('#review-story-dialog').hasAttribute('open'),false);assert.ok(e.d.querySelector('[data-open-real-test]'));assert.equal(e.d.querySelectorAll('[data-question-form]').length,2);e.click('[data-open-real-test]');await e.until(()=>!e.d.querySelector('#level-modal').hidden);assert.equal(e.errors.length,0);}finally{await e.close();}
});
test('点词加入词库即自动上报本篇，重复操作不重复计数，不需要手动提交',async()=>{
 const e=await setup();try{
  const lovely=[...e.d.querySelectorAll('.demo-word')].find(b=>b.textContent.toLowerCase()==='lovely');assert.ok(lovely);lovely.click();assert.match(e.d.querySelector('.meaning-placeholder').textContent,/漂亮/);e.click('#demo-add');await e.until(()=>e.d.querySelector('#demo-add').textContent==='已加入并上报');
  let p=(await e.w.Data.list('progress')).find(r=>r.id==='review-daily-01');assert.equal(p.unknown_submitted,true);assert.deepEqual(Array.from(p.unknown_words),['lovely']);assert.equal((await e.w.Data.list('vocab')).filter(v=>v.word==='lovely').length,1);
  const pack=(await e.w.Data.list('inputs')).find(r=>r.id===p.id);assert.equal(p.unknown_rate,1/pack.word_count);await e.w.ReviewContext.render();[...e.d.querySelectorAll('.demo-word')].find(b=>b.textContent.toLowerCase()==='lovely').click();assert.equal(e.d.querySelector('#demo-add').disabled,true);e.click('#demo-add');p=(await e.w.Data.list('progress')).find(r=>r.id==='review-daily-01');assert.equal(p.unknown_words.length,1);assert.equal(e.d.querySelector('#unknown-form'),null);assert.equal(e.writes(),0);
 }finally{await e.close();}
});
test('删除旧难度表单后不伪填体感或生词零值，不用隐藏旧流程冒充新版',async()=>{
 const e=await setup();try{e.click('#reading-check');await e.until(async()=> (await e.w.Data.list('progress')).some(r=>r.id==='review-daily-01'));const p=(await e.w.Data.list('progress')).find(r=>r.id==='review-daily-01');assert.equal(p.reading_checked,true);assert.equal(p.difficulty_self,undefined);assert.equal(p.unknown_submitted,undefined);assert.equal(e.d.querySelector('#difficulty-form'),null);assert.equal(e.d.querySelector('input[name="difficulty"]'),null);assert.doesNotMatch(e.d.querySelector('#workspace').textContent,/五项已完成/);}finally{await e.close();}
});
