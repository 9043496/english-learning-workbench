/* Isolated DOM checks, not real-browser, microphone, or real-device validation. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const folder=path.join(__dirname,'../preview-2.0');
function env(hash=''){
 const dom=new JSDOM(fs.readFileSync(path.join(folder,'additions.html'),'utf8'),{url:'http://127.0.0.1:8791/additions.html?embed='+(hash.includes('progress')?'metrics':hash.includes('shadowing')?'record':'story'),runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;
 w.HTMLMediaElement.prototype.pause=function(){};w.scrollTo=()=>{};
 let writes=0;
 w.fetch=()=>{writes++;throw Error('Preview must not call the backend');};
 Object.defineProperty(w,'localStorage',{get(){writes++;throw Error('Preview must not access localStorage');}});
 Object.defineProperty(w,'indexedDB',{get(){writes++;throw Error('Preview must not access IndexedDB');}});
 w.eval(fs.readFileSync(path.join(folder,'review-fixture.js'),'utf8'));w.eval(fs.readFileSync(path.join(folder,'increments.js'),'utf8'));
 return {w,d:w.document,api:w.Preview20,dom,writes:()=>writes,close:()=>w.close()};
}
function click(e,s){const b=e.d.querySelector(s);assert.ok(b,'missing '+s);b.click();}
function event(e,s,name){e.d.querySelector(s).dispatchEvent(new e.w.Event(name,{bubbles:true,cancelable:true}));}
const row=(id='a')=>({id,type:'daily',word_count:100,unknown_submitted:true,unknown_words:['go','Go','to go'],difficulty_self:'正好',comprehension:{status:'graded',correct:0,total:4},revision:1});
const policy={easyU:2,hardU:8,lowC:50,highC:100,selfHard:true};

test('故事初始不暴露文字，理解检查可正常作答并准确算分',()=>{
 const e=env('#today/story');try{
  assert.equal(e.d.querySelector('.transcript'),null);assert.equal(e.d.body.textContent.includes('Good morning.'),false);
  click(e,'[data-step="check"]');
  for(const [name,value] of [['q1','0'],['q2','1'],['q3','2']]){const s='input[name="'+name+'"][value="'+value+'"]';e.d.querySelector(s).checked=true;event(e,s,'change');}
  event(e,'#story-form','submit');assert.match(e.d.querySelector('.story-result').textContent,/3\s*\/ 3/);assert.equal(e.writes(),0);
 }finally{e.close();}
});
test('听后文字对照可逐句标记与取消，重返对照保留本页状态',()=>{
 const e=env('#today/story');try{click(e,'[data-step="compare"]');assert.equal(e.d.querySelectorAll('.transcript .sentence-unit').length,13);click(e,'[data-action="flag-story"][data-n="1"]');assert.equal(e.d.querySelector('.sentence-unit[data-unit="1"]').classList.contains('confused'),true);assert.equal(e.d.querySelectorAll('.confused').length,1);click(e,'[data-step="listen"]');assert.equal(e.d.querySelector('.transcript'),null);click(e,'[data-step="compare"]');assert.equal(e.d.querySelectorAll('.confused').length,1);click(e,'[data-action="flag-story"][data-n="1"]');assert.equal(e.d.querySelectorAll('.confused').length,0);}finally{e.close();}
});
test('调速使用真实audio playbackRate，不改音频资源',()=>{
 const e=env('#today/story');try{const a=e.d.querySelector('audio'),src=a.getAttribute('src');e.d.querySelector('[data-speed]').value='0.75';event(e,'[data-speed]','change');assert.equal(a.playbackRate,.75);assert.equal(a.getAttribute('src'),src);}finally{e.close();}
});
test('零生词和零正确率有效，未上报与缺字段不能伪装零',()=>{
 const e=env();try{const a={...row(),unknown_words:[]};assert.equal(e.api.deriveSignals(a).u,0);assert.equal(e.api.deriveSignals(a).c,0);assert.equal(e.api.deriveSignals(a).complete,true);assert.equal(e.api.deriveSignals({...a,unknown_submitted:false}).u,null);assert.equal(e.api.deriveSignals({...a,unknown_words:undefined}).complete,false);assert.equal(e.api.deriveSignals({...a,word_count:0}).complete,false);}finally{e.close();}
});
test('生词按词形去重、短语一个单位；不把体感当等距加权分',()=>{
 const e=env();try{const s=e.api.deriveSignals(row());assert.equal(s.unknown,2);assert.equal(s.u,.02);assert.equal(s.d,0);assert.equal(s.c,0);}finally{e.close();}
});
test('十篇计数排除月测、演示和缺项，跨设备同ID只计一次',()=>{
 const e=env();try{const rows=[row(),{...row(),revision:2},{...row('m'),type:'level_test'},{...row('d'),is_demo:true},{...row('t'),is_test:true},{...row('b'),difficulty_self:null}];assert.equal(e.api.validSamples(rows).length,1);assert.equal(e.api.validSamples([...rows,row('c')]).length,2);assert.equal(e.api.validSamples([row(),{...row(),revision:3,comprehension:{status:'submitted'}}]).length,0);}finally{e.close();}
});
test('试算规则覆盖一致、冲突和缺项；阈值非法不作判断',()=>{
 const e=env();try{
  const sig=e.api.deriveSignals({...row(),comprehension:{status:'graded',correct:4,total:4},unknown_words:['one'],difficulty_self:'太简单'});
  assert.equal(e.api.trialDecision(sig,policy).state,'easy');
  const hard={...sig,self:'太难',d:2};assert.equal(e.api.trialDecision(hard,policy).state,'hard');
  assert.equal(e.api.trialDecision({...hard,complete:false},policy).state,'missing');
  assert.equal(e.api.trialDecision(sig,{...policy,hardU:1}).state,'invalid');assert.equal(e.api.trialDecision(sig,{...policy,lowC:NaN}).state,'invalid');
  assert.equal(JSON.stringify(e.api.trialDecision(sig,policy)),JSON.stringify(e.api.trialDecision(sig,policy)));
 }finally{e.close();}
});
test('边界值按页面说明计算；试算与正式判定明确分开',()=>{
 const e=env('#progress');try{const sig={complete:true,u:.08,c:.5,self:'正好'};assert.equal(e.api.trialDecision(sig,policy).state,'hit');assert.equal(e.api.trialDecision({...sig,u:.081},policy).state,'hard');assert.equal(e.api.trialDecision({...sig,c:.49},policy).state,'hard');event(e,'#rule-form','submit');assert.match(e.d.querySelector('#rule-result').textContent,/试算结果/);assert.match(e.d.querySelector('.decision').textContent,/尚未启用/);assert.equal(e.writes(),0);}finally{e.close();}
});
test('8篇和10篇状态按有效样例计算，十篇只提示复评',()=>{
 const e=env('#progress');try{assert.match(e.d.querySelector('.counter-number').textContent,/8\s*\/ 10/);assert.equal(e.d.querySelector('.mini-chart').querySelectorAll('circle').length,8);assert.equal(e.d.querySelector('.review-ready'),null);click(e,'[data-mode="ten"]');assert.match(e.d.querySelector('.counter-number').textContent,/10\s*\/ 10/);assert.equal(e.d.querySelector('.mini-chart').querySelectorAll('circle').length,10);assert.match(e.d.querySelector('.review-ready').textContent,/复评/);assert.match(e.d.querySelector('.review-ready').textContent,/不是自动宣布进步/);}finally{e.close();}
});
test('录音原始指标可复算，无音频证据或分档不生成分数',()=>{
 const e=env('#shadowing');try{
  const m=e.api.audioMetrics({n:100,omissions:5,substitutions:2,insertions:3,assessed:95,pronunciation:2,pauses:4,readWords:100,seconds:60});assert.equal(m.coverage,.95);assert.equal(m.deviation,.1);assert.equal(m.wpm,100);assert.equal(m.pauseRate,4);assert.equal(e.api.audioMetrics({}),null);
  assert.match(e.d.querySelector('.score-strip').textContent,/待定档/);click(e,'[data-state="pending"]');assert.match(e.d.querySelector('.empty-panel').textContent,/等待分析/);click(e,'[data-state="invalid"]');assert.match(e.d.querySelector('.empty-panel').textContent,/无法可靠评价/);assert.match(e.d.querySelector('.empty-panel').textContent,/参考音频盖过/);
 }finally{e.close();}
});
test('页面资源相对路径可独立移交，样板代码不加载真实Store与连接凭证',()=>{
 const html=fs.readFileSync(path.join(folder,'additions.html'),'utf8');for(const ref of [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1])){if(ref.startsWith('data:'))continue;assert.ok(fs.existsSync(path.join(folder,ref.split('?')[0])),ref);}
 assert.doesNotMatch(html,/config\.js|store\.js|workbench\.js/);assert.ok(fs.statSync(path.join(folder,'assets/cafe-excerpt.mp3')).size>1000);
});
