/* Increment-only review components. No legacy standalone daily/vocab screens. */
(() => {
'use strict';
const $=s=>document.querySelector(s),f=window.REVIEW_FIXTURE;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const audioFile='assets/cafe-excerpt.mp3',turns=f.turns,questions=f.questions,units=[];
turns.forEach((t,i)=>{t.units=t.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((text,j)=>{const u={n:units.length,text:text.trim(),cn:f.translations[i][j],speaker:t.speaker};units.push(u);return u;});});
  const sample = (id,u,c,d,type='daily') => ({id,type,word_count:300,unknown_submitted:true,unknown_words:Array.from({length:u},(_,i)=>'word'+i),comprehension:{status:'graded',correct:c,total:4},difficulty_self:d,revision:1});
  const eight = [sample('sample-01',22,2,'吃力但能懂'),sample('sample-02',18,3,'吃力但能懂'),sample('sample-03',15,3,'正好'),sample('sample-04',12,4,'正好'),sample('sample-05',10,3,'正好'),sample('sample-06',9,4,'正好'),sample('sample-07',12,4,'正好'),sample('sample-08',12,4,'正好')];
  const excluded = [sample('sample-month',8,4,'正好','level_test'),{...sample('sample-missing',8,4,'正好'),comprehension:{status:'submitted',correct:null,total:4}}];
const state={story:{step:'listen',answers:{},submitted:false,flags:new Set()},analysis:'analysed',sampleMode:'eight',caseId:'normal',trial:null,policy:{easyU:2,hardU:8,lowC:50,highC:100,selfHard:true},speed:1};
  function deriveSignals(row) {
    const count=Number(row?.word_count),total=Number(row?.comprehension?.total),correct=row?.comprehension?.correct;
    const words=[...new Set((Array.isArray(row?.unknown_words)?row.unknown_words:[]).map(w=>String(w).trim().toLowerCase()).filter(Boolean))];
    const meanings={'太简单':-1,'正好':0,'吃力但能懂':1,'太难':2};
    const validU=row?.unknown_submitted===true && Array.isArray(row.unknown_words) && Number.isFinite(count) && count>0;
    const validC=row?.comprehension?.status==='graded' && Number.isInteger(total) && total>0 && Number.isInteger(correct) && correct>=0 && correct<=total;
    const validD=Object.hasOwn(meanings,row?.difficulty_self);
    return {u:validU?words.length/count:null,unknown:validU?words.length:null,words:validU?count:null,c:validC?correct/total:null,correct:validC?correct:null,total:validC?total:null,d:validD?meanings[row.difficulty_self]:null,self:validD?row.difficulty_self:null,complete:validU&&validC&&validD};
  }
  function validSamples(rows) {
    const latest=new Map();
    for(const row of rows){if(!row.id || ['level_test','demo','test'].includes(row.type)||row.is_demo===true||row.is_test===true)continue;const old=latest.get(row.id);if(!old || (row.revision||0)>=(old.revision||0))latest.set(row.id,row);}
    return [...latest.values()].filter(row=>deriveSignals(row).complete);
  }
  function trialDecision(signals,policy) {
    const nums=['easyU','hardU','lowC','highC'].map(k=>policy[k]);
    if(nums.some(n=>!Number.isFinite(n)||n<0||n>100)||policy.hardU<=policy.easyU||policy.highC<policy.lowC)return {state:'invalid',label:'请检查阈值范围及上下界',reasons:[]};
    if(!signals.complete)return {state:'missing',label:'数据不足',reasons:['三项信号尚未完整，不作难度判断。']};
    const reasons=[];
    if(signals.u*100>policy.hardU)reasons.push('生词率超过偏难阈值');
    if(signals.c*100<policy.lowC)reasons.push('理解正确率低于偏难阈值');
    if(policy.selfHard && signals.self==='太难')reasons.push('主观反馈为“太难”');
    if(reasons.length)return {state:'hard',label:'偏难',reasons};
    if(signals.u*100<policy.easyU && signals.c*100>=policy.highC && signals.self==='太简单')return {state:'easy',label:'偏易',reasons:['生词率、理解正确率及“太简单”反馈同时满足偏易条件。']};
    return {state:'hit',label:'合适',reasons:['未触发偏难规则，也未同时满足偏易条件。']};
  }
  function audioMetrics(x) {
    const keys=['n','omissions','substitutions','insertions','assessed','pronunciation','pauses','readWords','seconds'];
    if(keys.some(k=>!Number.isFinite(x[k])||x[k]<0)||keys.filter(k=>k!=='seconds').some(k=>!Number.isInteger(x[k]))||x.n===0||x.seconds===0||x.omissions+x.substitutions>x.n||x.assessed===0||x.assessed>x.readWords||x.pronunciation>x.assessed)return null;
    return {coverage:(x.n-x.omissions)/x.n,deviation:(x.omissions+x.substitutions+x.insertions)/x.n,pronunciation:x.pronunciation/x.assessed,pauseRate:x.readWords?x.pauses/x.readWords*100:null,wpm:x.readWords/x.seconds*60};
  }
  const demoAudio={n:280,omissions:12,substitutions:4,insertions:2,assessed:268,pronunciation:3,pauses:4,readWords:274,seconds:156};
  const currentCase=()=>({normal:eight[7],hard:sample('case-hard',30,1,'太难'),conflict:sample('case-conflict',12,4,'太难'),easy:sample('case-easy',3,4,'太简单'),missing:excluded[1]})[state.caseId];
  const fmt=n=>n===null?'—':(100*n).toFixed(1)+'%';
  const badge=(text,kind='')=>'<span class="badge '+kind+'">'+esc(text)+'</span>';
  const heading=(k,title,subtitle)=>'<div class="eyebrow">'+k+'</div><header class="page-header"><h1 tabindex="-1">'+title+'</h1><p class="muted">'+subtitle+'</p></header>';
  function audio(id){return '<div class="audio-panel"><div class="flex-heading"><span>已认可的日常语气试听 · 约28秒</span><span class="tiny">Puck / Aoede</span></div><audio id="'+id+'" controls preload="metadata" src="'+audioFile+'">你的浏览器不支持音频播放。</audio><label class="speed-control">播放速度 <select data-speed aria-label="播放速度">'+[.5,.75,1,1.25,1.5,2].map(n=>'<option value="'+n+'" '+(n===state.speed?'selected':'')+'>'+n+'×</option>').join('')+'</select></label><p class="tiny">复用已试听的真实音频。本样板展示节选，不代表正式故事包。</p></div>';}
function articleMarkup(){return '<div class="article-body">'+turns.map(t=>'<p><span class="speaker">'+t.speaker.toUpperCase()+'</span>'+t.units.map(u=>'<span class="sentence-unit '+(state.story.flags.has(u.n)?'confused':'')+'" data-unit="'+u.n+'">'+esc(u.text)+'</span><button class="sentence-dot '+(state.story.flags.has(u.n)?'marked':'')+'" type="button" data-action="flag-story" data-n="'+u.n+'" aria-label="标记或取消没听清第'+(u.n+1)+'句" aria-pressed="'+state.story.flags.has(u.n)+'"></button>').join(' ')+'</p>').join('')+'</div>';}
  function story(){
    const s=state.story,correct=questions.filter(q=>s.answers[q.id]===q.answer).length;
    const quiz='<form id="story-form">'+questions.map((q,i)=>'<fieldset class="question"><legend><span>0'+(i+1)+'</span>'+q.q+'</legend><div class="choice-list">'+q.options.map((o,j)=>'<label class="choice-option"><input type="radio" name="'+q.id+'" value="'+j+'" required '+(s.answers[q.id]===j?'checked':'')+' '+(s.submitted?'disabled':'')+'><span>'+o+'</span></label>').join('')+'</div>'+(s.submitted?'<p class="correct-note">'+(s.answers[q.id]===q.answer?'✓ ':'↳ ')+esc(q.note)+'</p>':'')+'</fieldset>').join('')+'<div class="actions"><button class="primary" type="submit" '+(s.submitted?'disabled':'')+'>提交本次理解检查</button><span class="tiny">选择题为待审核方案，不是已固定题型。</span></div></form>';
    return heading('STORY LISTENING / 精听','A little art game.','一杯外带咖啡，一个意外的邀请。先听，不急着看文字。')+'<div class="story-steps" aria-label="故事精听步骤">'+[['listen','01 先听故事'],['check','02 检查理解'],['compare','03 文字对照']].map(([id,label],i)=>(i?'<span aria-hidden="true"></span>':'')+'<button type="button" data-action="story-step" data-step="'+id+'" '+(s.step===id?'aria-current="step"':'')+'>'+label+'</button>').join('')+'</div>'+audio('story-audio')+(s.submitted?'<div class="story-result"><div class="flex-heading"><span>本次样板作答</span><strong>'+correct+' <small>/ 3</small></strong></div><p class="tiny">只根据你在本页的选择计算；不写入学习记录，也不用于调整难度。</p></div>':'')+(s.step==='listen'?'<section class="listening-intro"><h2>先听听，发生了什么。</h2><p class="muted">不必逐字写下来。听出人物在做什么，故事有什么变化。</p><div class="actions"><button type="button" class="primary" data-action="story-step" data-step="check">我听好了，检查理解 →</button><button type="button" class="quiet" data-action="story-step" data-step="compare">查看文字对照</button></div></section>':s.step==='check'?'<section class="section"><h2>你听见了怎样的故事？</h2><p class="tiny">以下问题仅作前端交互示例；正式题型与题量待审核。</p>'+quiz+'<div class="actions"><button type="button" class="text-button" data-action="story-step" data-step="compare">查看文字，找到没听出的地方 →</button></div></section>':'<section class="section transcript"><div class="transcript-tools"><h2>听过之后，再看文字。</h2><button type="button" class="quiet compact" data-action="story-step" data-step="listen">收起文字</button></div><p class="muted">点句尾圆点，标记这一句没有听清。文章保留完整排版。</p>'+articleMarkup(false,true)+'<p class="transcript-footer">'+(s.flags.size?'已标记 '+s.flags.size+' 处没有听清。可再次点击取消。':'听懂大意之后，再找出没有听清的具体位置。')+'</p><p class="tiny">每句单独标注，保留对话的段落与说话人。</p></section>');
  }
  function analysisPanel(){
    if(state.analysis==='pending')return '<div class="empty-panel"><h3>这一遍，等待分析。</h3><p>取得实际录音并完成核查后，再显示指标、证据与建议。</p><div class="score-strip"><span>流利度 <strong>—</strong></span><span>发音 <strong>—</strong></span><span>完整度 <strong>—</strong></span></div></div>';
    if(state.analysis==='invalid')return '<div class="empty-panel"><h3>这段录音暂时无法可靠评价。</h3><p>样例原因：参考音频盖过了学习者声音。无法确定的部分不计为读对，也不计为读错。</p><span class="badge orange">未评分 · 建议佩戴耳机重录</span></div>';
    const m=audioMetrics(demoAudio);
    return '<div class="analysis-panel"><div class="flex-heading"><h3>本遍量化反馈</h3>'+badge('示例指标 · 非本人录音')+'</div><p class="tiny">统计与证据仅用于审核呈现方式，尚未接入语音评测。</p><dl class="metric-grid"><div><dt>内容完整度</dt><dd>'+fmt(m.coverage)+'</dd><small>漏读12 / 原文280词</small></div><div><dt>确认发音问题</dt><dd>3 <small>处</small></dd><small>核查覆盖268词</small></div><div><dt>非自然卡顿</dt><dd>4 <small>次</small></dd><small>正常停顿已排除</small></div><div><dt>替换 / 多读</dt><dd>4 <small>/ 2词</small></dd><small>与漏读分开统计</small></div><div><dt>每百词卡顿</dt><dd>'+m.pauseRate.toFixed(2)+'</dd><small>按实际朗读274词</small></div><div><dt>有效朗读速度</dt><dd>'+Math.round(m.wpm)+' <small>词/分</small></dd><small>播放倍率0.75×</small></div></dl><div class="score-strip"><span>流利度 <strong>待定档</strong></span><span>发音 <strong>待定档</strong></span><span>完整度 <strong>待定档</strong></span></div><p class="tiny">1–3分的阈值待讨论。先看可核查的表现，不凭印象补分。</p><section class="section"><div class="flex-heading"><h3>每个问题，都能找到位置。</h3>'+badge('示例证据')+'</div><div class="evidence-item"><span class="timestamp">00:18</span><div><strong>Could I … get a small latte?</strong><p>句中出现一次非自然停顿。先把“Could I get a…”作为一块连起来。</p></div></div><div class="evidence-item"><span class="timestamp">00:42</span><div><strong>I painted it last night.</strong><p>示例发音问题：painted词尾未清楚表达。正式反馈需附该录音片段。</p></div></div><div class="evidence-item"><span class="timestamp">01:06</span><div><strong>animation</strong><p>'+badge('待核查 · 未扣分','gold')+' 识别文本与原文不同，尚不能确认是读音问题还是识别误差。</p></div></div></section><div class="focus-note"><div class="eyebrow">ONE THING TO TRY NEXT</div><h3>下一遍，先把请求说顺。</h3><p>把 “Could I get a small latte to go?” 连成一个意思完整的语块，再自然停顿。不必急着加快。</p></div><details class="rubric"><summary>查看量化口径与评分标准</summary><div class="table-scroll"><table><thead><tr><th>维度</th><th>依据</th><th>分数边界</th></tr></thead><tbody><tr><td>完整度</td><td>原文覆盖、确认漏读</td><td>1 / 2 / 3 分待确认</td></tr><tr><td>发音</td><td>音频核查、问题词与覆盖范围</td><td>1 / 2 / 3 分待确认</td></tr><tr><td>流利度</td><td>非自然卡顿、重启与连续表达</td><td>1 / 2 / 3 分待确认</td></tr></tbody></table></div><p class="tiny">准备时间、尾部静音不参与；同一问题避免重复扣分。示例时间点未绑定真实音频。</p></details></div>';
  }
  function unknownChart(rows){
    const points=rows.map((r,i)=>({x:35+(rows.length<2?290:i/(rows.length-1)*580),y:145-deriveSignals(r).u*1400}));
    return '<svg class="mini-chart" viewBox="0 0 650 165" role="img" aria-label="'+rows.length+'篇有效样例的生词率"><rect x="35" y="75" width="580" height="42" fill="#eaf0df"/><path d="M35 20V145H615" fill="none" stroke="#d4ddc9"/><path d="'+points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')+'" fill="none" stroke="#849b6e" stroke-width="1.5"/><g fill="#849b6e">'+points.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="3"/>').join('')+'</g><g font-size="10" fill="#9ba88e"><text x="8" y="37">8%</text><text x="8" y="79">5%</text><text x="8" y="121">2%</text><text x="33" y="163">01</text><text x="599" y="163">'+String(rows.length).padStart(2,'0')+'</text></g></svg>';
  }
  function progress(){
    const rows=state.sampleMode==='ten'?[...eight,sample('sample-09',9,4,'正好'),sample('sample-10',6,4,'正好'),...excluded]:[...eight,...excluded];
    const count=validSamples(rows).length,s=deriveSignals(currentCase());
    return heading('LEARNING PROGRESS / 学习进度','See what is getting clearer.','把感受、作答与录音表现放在一起。每个结论，都能看见依据。')+'<div class="sample-switch">'+[['eight','8篇状态'],['ten','满10篇状态']].map(([id,t])=>'<button type="button" class="compact" data-action="sample-mode" data-mode="'+id+'" aria-pressed="'+(state.sampleMode===id)+'">演示'+t+'</button>').join('')+'</div><section class="analysis-panel"><div class="flex-heading"><h2>第一轮，先积累十篇。</h2>'+badge(count>=10?'可开始复评':'样本积累中',count>=10?'gold':'')+'</div><div class="sample-counter"><span class="counter-number">'+count+' <small>/ 10</small></span><div><div class="sample-dots" aria-label="'+count+'篇有效样例">'+Array.from({length:10},(_,i)=>'<span class="'+(i<count?'filled':'')+'"></span>').join('')+'</div><span class="tiny">不同文章 · 三项信号完整</span></div></div><p class="muted">月度测试、缺项和同篇重复提交不计入。这里全部是示例样本。</p>'+(count>=10?'<div class="review-ready"><strong>十篇样例已齐，可查看复评材料。</strong><br>核对信号冲突、实际耗时与主观感受，再讨论阈值是否需要调整。不是自动宣布进步。</div>':'<p class="tiny">再积累 '+(10-count)+' 篇有效文章后复评。未满十篇，也可以随时讨论规则。</p>')+'</section><section class="section"><div class="flex-heading"><h2>三项信号，明确地放在一起。</h2><label class="tiny">试算样本 <select id="signal-case" aria-label="选择试算样本">'+[['normal','正常样例'],['hard','困难样例'],['conflict','信号冲突样例'],['easy','偏易样例'],['missing','缺项样例']].map(([id,t])=>'<option value="'+id+'" '+(state.caseId===id?'selected':'')+'>'+t+'</option>').join('')+'</select></label></div><div class="signal-panel"><dl class="metric-grid"><div><dt>生词率 U</dt><dd>'+fmt(s.u)+'</dd><small>'+ (s.words?s.unknown+' / '+s.words+'词':'未完成上报')+'</small></div><div><dt>理解正确率 C</dt><dd>'+fmt(s.c)+'</dd><small>'+(s.total?s.correct+' / '+s.total+'题':'等待完整作答')+'</small></div><div><dt>主观难度 D</dt><dd style="font-size:20px">'+esc(s.self||'—')+'</dd><small>工作编码 '+(s.d??'—')+'，不直接加权</small></div></dl><div class="decision"><span>正式自动判定</span>'+badge('尚未启用 · 阈值待确认','gold')+'</div></div><details class="rubric" open><summary>难度规则试算 · 可调整数值</summary><p class="tiny">以下仅为交互试算，初始数值参考旧实现；体感组合为待审核方案，不代表正式标准。只在本页运行，不写回后端。</p><form id="rule-form"><div class="rule-form"><label>偏易：生词率低于（%）<input name="easyU" type="number" min="0" max="100" step="0.1" required value="'+state.policy.easyU+'"></label><label>偏难：生词率高于（%）<input name="hardU" type="number" min="0" max="100" step="0.1" required value="'+state.policy.hardU+'"></label><label>偏难：理解率低于（%）<input name="lowC" type="number" min="0" max="100" step="0.1" required value="'+state.policy.lowC+'"></label><label>偏易：理解率至少（%）<input name="highC" type="number" min="0" max="100" step="0.1" required value="'+state.policy.highC+'"></label></div><label class="rule-check"><input name="selfHard" type="checkbox" '+(state.policy.selfHard?'checked':'')+'> 主观选择“太难”时，触发偏难</label><p class="tiny">先判断偏难；偏易需同时满足两项数值与“太简单”；其他为合适。缺数据不判断。</p><button type="submit" class="primary">按这些数值试算</button><div class="rule-feedback" id="rule-result" role="status">'+(state.trial?'<strong>试算结果：'+esc(state.trial.label)+'</strong><br>'+state.trial.reasons.map(esc).join('；'):'调整阈值后，查看这组样本会得到怎样的结果。')+'</div></form></details></section><section class="section"><div class="flex-heading"><h2>生词率，逐篇看。</h2><span class="tiny">示例曲线 · 目标区间2–5%</span></div>'+unknownChart(validSamples(rows))+'<div class="chart-caption"><span>浅绿色是既有目标区间</span><span>曲线为样例，不是你的学习趋势</span></div></section><section class="section"><h2>日常安排</h2><p class="muted">每天至少两篇，整体约两小时。具体分配仍可调整。</p><div class="target-time"><span>两篇听读与作答</span><strong>约60分钟</strong></div><div class="target-time"><span>跟读录音</span><strong>约30分钟</strong></div><div class="target-time"><span>场景口语、旧词与订正</span><strong>约30分钟</strong></div><p class="tiny">时间为建议预算，样板不伪造已学时长，不设置强制等待。</p></section><section class="section"><div class="flex-heading"><h2>月度水平测试</h2>'+badge('独立记录','gold')+'</div><p class="muted">听、说、读、写及总评继续单独展示，不参与日常十篇样本和i+1计算。</p><p class="tiny">本轮审核不改月度测试流程。</p></section>';
  }

function render(){
 document.querySelectorAll('audio').forEach(a=>a.pause());
 const embed=new URLSearchParams(location.search).get('embed');document.body.dataset.embed=embed||'internal';
 const record=()=>'<div class="sample-switch">'+[['analysed','已分析'],['pending','待分析'],['invalid','无法评估']].map(([id,t])=>'<button type="button" class="compact" data-action="analysis-state" data-state="'+id+'" aria-pressed="'+(state.analysis===id)+'">'+t+'样例</button>').join('')+'</div>'+analysisPanel();
 $('#view').innerHTML=embed==='story'?story():embed==='record'?record():embed==='metrics'?progress():'<p class="muted">这是内部增量组件。<a href="index.html" target="_top">返回完整工作台</a></p>';
 document.querySelectorAll('audio').forEach(a=>a.playbackRate=state.speed);
 const send=()=>{if(parent!==window)parent.postMessage({type:'review-frame-height',height:Math.ceil($('#main').getBoundingClientRect().height)},location.origin);};
 requestAnimationFrame(send);if(window.ResizeObserver&&!window.__reviewResizeObserver){window.__reviewResizeObserver=new ResizeObserver(send);window.__reviewResizeObserver.observe(document.body);}
}
let noticeTimer;function notify(text){$('#notice').textContent=text;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').textContent='',4500);}
document.addEventListener('click',event=>{
 const b=event.target.closest('[data-action]');if(!b)return;
 if(b.dataset.action==='story-step')state.story.step=b.dataset.step;
 else if(b.dataset.action==='flag-story'){const n=Number(b.dataset.n);state.story.flags.has(n)?state.story.flags.delete(n):state.story.flags.add(n);}
 else if(b.dataset.action==='analysis-state')state.analysis=b.dataset.state;
 else if(b.dataset.action==='sample-mode')state.sampleMode=b.dataset.mode;
 else return;
 render();
});
document.addEventListener('change',event=>{
 if(event.target.matches('[data-speed]')){state.speed=Number(event.target.value);document.querySelectorAll('audio').forEach(a=>a.playbackRate=state.speed);}
 if(event.target.closest('#story-form')&&event.target.type==='radio')state.story.answers[event.target.name]=Number(event.target.value);
 if(event.target.id==='signal-case'){state.caseId=event.target.value;state.trial=null;render();}
});
document.addEventListener('input',event=>{if(event.target.closest('#rule-form')){state.trial=null;$('#rule-result').textContent='阈值已改变，请重新试算。';}});
document.addEventListener('submit',event=>{
 if(!['story-form','rule-form'].includes(event.target.id))return;event.preventDefault();
 if(event.target.id==='story-form'){
  if(questions.some(q=>!Number.isInteger(state.story.answers[q.id]))){notify('请完成三个问题。');return;}
  state.story.submitted=true;render();
 }else{
  const data=new FormData(event.target),policy={selfHard:data.has('selfHard')};for(const k of ['easyU','hardU','lowC','highC'])policy[k]=data.get(k)===''?NaN:Number(data.get(k));
  const result=trialDecision(deriveSignals(currentCase()),policy);if(result.state==='invalid'){$('#rule-result').textContent=result.label;return;}
  state.policy=policy;state.trial=result;render();
 }
});
window.Preview20=Object.freeze({deriveSignals,validSamples,trialDecision,audioMetrics});render();
})();
