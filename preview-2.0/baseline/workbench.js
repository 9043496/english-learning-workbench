/* 真实工作台：只读教材，设备保存，显式上传/下载。 */
(function(){
'use strict';
const $=s=>document.querySelector(s),D=window.Data,R=window.ReadingLogic,L=window.LearningLogic,F=window.Features21;
const collections=['inputs','sentences','progress','vocab','shadowing','dictation','dictation_tasks'];
let state={},selected='',page='today',active=null,anchor=null,parts=[],units=[],sentenceAudio=null,recording=null,pendingTake=null,urls=[],quiz=[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const note=s=>{$('#app-status').textContent=s;};
const pr=()=>state.progress?.find(x=>x.id===selected)||{id:selected};
const pack=()=>state.inputs?.find(x=>x.id===selected);
const media=key=>window.ReviewData.media(key);
const flags=()=>pr().sentence_flags||{};
const tag=s=>({new:'新加入',reviewing:'学习中',mastered:'已掌握',hit:'命中',easy:'偏易',hard:'偏难'}[s]||'待确认');
async function read(){state=Object.fromEntries(await Promise.all(collections.map(async c=>[c,await D.list(c)])));state.inputs=state.inputs.filter(p=>p.id!=='input_local_01').sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));if(!pack()||pack().type==='level_test')selected=state.inputs.find(p=>p.type!=='level_test')?.id||'';}
async function saveProgress(fields){await D.patch('progress',selected,{...fields,date:pr().date||date(),completed:L.completed({...pr(),...fields})});state.progress=await D.list('progress');}
function heading(cn,en){return '<header class="article-header"><p class="chinese-title">'+esc(cn)+'</p><h1>'+esc(en)+'</h1><div class="article-rule"></div></header>';}
function audio(p,id){const src=p?.audio_full||media(p?.audioKey||p?.audio_blob_key);return src?'<audio id="'+id+'" controls preload="metadata" src="'+esc(src)+'"></audio>':'<p class="muted">全文音频尚未下发。</p>';}
function rows(){return R.sentences(pack(),state.sentences.find(s=>s.id===selected));}
function article(interactive){
 const p=pack();units=rows();parts=[];
 if(!p)return '';
 function segment(text,unit){return R.segments(text,p.wordpack,unit?.n,state.vocab).map(part=>{if(!interactive||!part.word)return esc(part.text);const id=parts.push({...part,unit})-1;return '<button type="button" class="demo-word '+((part.unknown?'is-added ':'')+(F.reusedKeys(p).has(part.key)?'is-reused':''))+'" data-part="'+id+'" data-n="'+esc(unit?.n??'')+'" aria-haspopup="dialog" aria-expanded="false">'+esc(part.text)+'</button>';}).join('');}
 const blocks=Array.isArray(p.body)?p.body:[p.body||''];
 let previous=-1;
 return '<div class="article-body demo-article" lang="en">'+blocks.map(b=>{
  const text=typeof b==='string'?b:b.text||'';
  let cursor=0,out='';
  for(let i=previous+1;i<units.length;i++){
   const u=units[i],at=text.indexOf(u.text,cursor);if(at<0)continue;
   out+=segment(text.slice(cursor,at),null);
   out+='<span class="sentence-unit '+(flags()[u.n]==='confused'?'is-confused':'')+'" data-unit="'+esc(u.n)+'"><span class="sentence-fragment">'+segment(u.text,u)+'</span>';
   if(interactive)out+='<button type="button" class="sentence-dot" data-unit-button="'+i+'" aria-label="第'+esc(u.n)+'句工具" aria-expanded="false"><span aria-hidden="true"></span></button>';
   out+='</span>';cursor=at+u.text.length;previous=i;
  }
  out+=segment(text.slice(cursor),null);return '<p>'+out+'</p>';
 }).join('')+'</div>';
}
function questionGroup(kind,title){
 const qs=pack()?.[kind]||[],saved=pr()[kind],answers=saved?.answers||[];
 const valid=qs.length&&qs.every(q=>q.id&&q.options?.length===4&&new Set(q.options.map(o=>o.id)).size===4&&q.options.some(o=>o.id===q.correct_option_id)&&q.explanation_en?.trim());
 if(!valid)return '<section class="practice-form"><h3>'+title+'</h3><p class="muted">这份教材尚未提供完整选择题与解析，等待教练补齐；不会自动改造旧题。</p></section>';
 const submitted=!!saved&&['submitted','graded'].includes(saved.status);
 let correct=0;
 const body=qs.map(q=>{
  const a=answers.find(a=>a.question_id===q.id)?.option_id,hit=a===q.correct_option_id;if(hit)correct++;
  const key=q.options.find(o=>o.id===q.correct_option_id);
  return '<fieldset class="practice-question"><legend lang="en">'+esc(q.q)+'</legend>'+(q.sentence?'<blockquote class="context-sentence">'+esc(q.sentence)+'</blockquote>':'')+'<div class="choice-options">'+q.options.map(o=>'<label class="choice-option"><input type="radio" required name="'+esc(q.id)+'" value="'+esc(o.id)+'" '+(submitted?'disabled ':'')+(a===o.id?'checked':'')+'><span class="choice-letter">'+esc(o.id.toUpperCase())+'</span><span>'+esc(o.text)+'</span></label>').join('')+'</div>'+(submitted?'<section class="answer-feedback '+(hit?'is-correct':'is-incorrect')+'"><div class="feedback-heading">'+(hit?'Correct':'Incorrect')+' · Your answer: '+esc(a?.toUpperCase()||'—')+'</div><p>Correct answer: '+esc(key.id.toUpperCase()+'. '+key.text)+'</p><p>'+esc(q.explanation_en)+'</p><p>'+esc(saved.note||'尚无追加教练反馈。')+'</p></section>':'')+'</fieldset>';
 }).join('');
 return '<form class="practice-form" data-question-form="'+kind+'"><h3>'+title+'</h3>'+body+(submitted?'<p>已提交 · '+correct+' / '+qs.length+' 正确 · 原选择已保留</p>':'<button type="submit" class="primary">Submit answers</button>')+'</form>';
}
function today(){
 const p=pack();if(!p)return F.assessmentEntry(state.inputs)+heading('今日学习','Your next story.')+'<p>尚无可展示教材。请让Muse下发正式内容，原数据不会删除。</p>';
 return F.assessmentEntry(state.inputs)+heading(p.title_cn||'今日学习',p.title)+'<div class="reference-audio">'+audio(p,'full-player')+'</div>'+F.reencounterBefore(p,state.vocab)+article(true)+F.reencounterAfter(p,state.vocab)+
 '<section class="after-reading"><label><input type="checkbox" id="reading-check" '+(pr().reading_checked?'checked':'')+'> 我已完整阅读两遍</label>'+
 questionGroup('comprehension','Reading comprehension')+questionGroup('polysemy','Words in context')+
 '<a href="'+esc(window.APP_CONFIG.museUrl||'https://muse.ai/')+'" target="_blank" rel="noopener">前往Muse进行英文讨论</a></section>';
}
function shadowing(){
 const p=pack();return heading('跟读录音',p?.title||'Shadowing')+(p?'<div class="reference-audio">'+audio(p,'reference-player')+'</div><section class="record-dock"><div class="record-information"><span id="recorder-state">准备录音</span><output id="record-duration">00:00</output></div><div class="record-actions"><button type="button" id="start-record">开始录音</button><button type="button" id="stop-record" disabled>结束录音</button></div><p id="record-status">点击后即录音，3秒后播放参考音频；音频播完后手动结束。中途结束丢弃本遍。</p></section>'+article(false)+'<section id="pending-record" hidden></section><section class="record-history"><h2>每一次练习，都留下来</h2><div id="record-list"></div></section>':'<p>请先选择教材。</p>');
}
function vocab(){
 return heading('生词本','Words, in context.')+'<section class="quiz-entry"><div><h2>语境抽查</h2><p>先回忆中文义，再用英文造句，由教练判定。每轮最多5词。</p></div><button id="start-quiz" '+(!state.vocab.length?'disabled':'')+'>开始一轮抽查</button></section>'+
 (quiz.length?'<form id="vocab-quiz">'+quiz.map((v,i)=>'<fieldset class="quiz-word"><legend>'+esc(v.word)+'</legend><p>'+esc(v.source)+'</p><blockquote>'+esc(v.source_sentence||'原句待教练补充')+'</blockquote><label>回忆中文义<input required name="recall'+i+'"></label><label>用该词造英文句子<textarea required name="sentence'+i+'" lang="en"></textarea></label></fieldset>').join('')+'<button type="submit">提交给教练判定</button><button type="button" id="cancel-quiz">返回词库</button></form>':
 '<div class="library-tools"><label class="search-label">搜索词或原句<input type="search" id="vocab-search"></label><label>掌握状态<select id="vocab-filter"><option value="">全部</option><option value="new">新加入</option><option value="reviewing">学习中</option><option value="mastered">教练已掌握</option><option value="familiar">已熟识</option></select></label></div><div id="vocab-list">'+state.vocab.map(v=>'<article class="vocab-entry" data-vocab-id="'+esc(v.id)+'" data-state="'+esc(v.status)+'"><div class="word-heading"><h3>'+esc(v.word)+'</h3><span>'+tag(v.status)+'</span></div><p class="word-meaning">'+esc(v.cn||'释义未提供')+'</p><p class="source-line">'+esc(v.source)+' · '+esc(v.added)+' · 抽查'+Number(v.quizzes||0)+'次</p><blockquote>'+esc(v.source_sentence||'原句待补充')+'</blockquote>'+F.familiarityMarkup(v)+'<details><summary>抽查历史与教练反馈</summary>'+(v.quiz_history?.length?v.quiz_history.map(h=>'<p>'+esc(h.date)+' · '+(h.correct?'正确':'需巩固')+' · '+esc(h.note)+'</p>').join(''):'<p>尚无抽查反馈。</p>')+'</details></article>').join('')+(!state.vocab.length?'<p>暂无生词，在正文中点词加入即可。</p>':'')+'</div>');
}
function stats(p){
 const row=state.progress.find(r=>r.id===p.id)||{},q=p.comprehension||[],a=row.comprehension?.answers;
 const auto=q.length&&q.every(q=>q.correct_option_id)&&a?.every(a=>typeof a==='object');
 const c=auto?{status:'graded',correct:q.filter(q=>a.find(a=>a.question_id===q.id)?.option_id===q.correct_option_id).length,total:q.length}:row.comprehension;
 return {...row,comprehension:c};
}
function chart(points,min,max,label){
 const valid=points.filter(p=>Number.isFinite(p.value));if(!valid.length)return '<p class="chart-wait">数据收集中 · 暂无'+esc(label)+'</p>';
 const all=points.length||1,w=570,h=130;
 const x=i=>40+(all<2?w/2:i/(all-1)*w),y=v=>160-(v-min)/(max-min)*h;
 let svg='<svg viewBox="0 0 640 205" role="img" aria-label="'+esc(label)+'"><path d="M40 30V160H610" fill="none" stroke="#d4dfcc"/><text x="10" y="33">'+max+'</text><text x="10" y="163">'+min+'</text>';
 let last=null;
 points.forEach((p,i)=>{if(!Number.isFinite(p.value)){last=null;return;}const point=[x(i),y(p.value)];if(last)svg+='<path d="M'+last.join(' ')+'L'+point.join(' ')+'" stroke="#708e5d" fill="none"/>';svg+='<circle cx="'+point[0]+'" cy="'+point[1]+'" r="3" fill="#708e5d"><title>'+esc(p.label+': '+p.value)+'</title></circle>';last=point;});return svg+'</svg>';
}
function progress(){
 const normal=state.inputs.filter(p=>p.type!=='level_test');
 const weekly=L.weekly(state.shadowing),unknown=normal.map(p=>{const r=stats(p);return {label:p.id,value:r.unknown_submitted&&p.word_count?100*L.uniqueUnknown((r.unknown_words||[]).join(',')).length/p.word_count:null};}),comp=normal.map(p=>{const r=stats(p);return {label:p.id,value:r.comprehension?.status==='graded'&&r.comprehension.total?100*r.comprehension.correct/r.comprehension.total:null};});
 return heading('学习进度','A little clearer, each day.')+F.testHistory(state)+
 '<section class="trend-section"><h2>跟读质量 · 每周3–9分</h2>'+chart(weekly.map(w=>({label:w.week,value:w.total})),3,9,'跟读评分')+weekly.map(w=>'<p>'+esc(w.week)+' · 流利度 '+w.fluency.toFixed(1)+' / 发音 '+w.pronunciation.toFixed(1)+' / 完整度 '+w.completeness.toFixed(1)+' · 已评分 '+w.count+' 条 · 保存录音 '+state.shadowing.filter(r=>L.isoWeek(r.date)===w.week).length+' 条</p>').join('')+'</section>'+
 '<section class="trend-section"><h2>生词率 · 每篇</h2>'+chart(unknown,0,100,'生词率')+'</section><section class="trend-section"><h2>理解正确率 · 每篇</h2>'+chart(comp,0,100,'理解正确率')+'</section><section class="input-history"><h2>每篇记录</h2>'+normal.map(p=>{const r=stats(p);return '<p>'+esc(p.title)+' · '+(L.completed(r)?'已完成':'进行中')+' · 主观难度 '+esc(r.difficulty_self||'—')+' · 教练判定 '+tag(r.i1_final)+'</p>';}).join('')+'</section><section class="weekly-review"><h2>教练周报</h2>'+((state.progress.find(r=>r.id==='weekly_reports')?.weekly_reports||[]).map(w=>'<p>'+esc(w.week)+' · '+esc(w.focus_next_week||w.note)+'</p>').join('')||'<p>等待教练周报，不生成虚构进步结论。</p>')+'</section>';
}
const diagnosticsEnabled=new URLSearchParams(location.search).get('diagnostics')==='1';
let diagnosticServer=null;
function diagnosticSummary(p){return p?{id:p.id,wordpack_count:Array.isArray(p.wordpack)?p.wordpack.length:null,targets:['latte','to go'].map(word=>({word,entries:(p.wordpack||[]).filter(x=>R.normalize(R.term(x))===word).map(x=>({w:x.w,n:x.n,pos:x.pos,cn:x.cn}))}))}:null;}
function updateDiagnostics(){
 if(!diagnosticsEnabled)return;
 let box=document.getElementById('wordcard-diagnostics');
 if(!box){
  box=document.createElement('details');box.id='wordcard-diagnostics';box.open=false;
  box.style.cssText='margin:16px 0;padding:12px;border:1px solid #708e5d;background:#fff;overflow-wrap:anywhere;max-height:260px;overflow:auto';
  box.innerHTML='<summary>词卡只读诊断（不含连接凭证或学习答案）</summary><button type="button" id="copy-word-diagnostics">复制诊断</button><pre id="word-diagnostics-json" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></pre>';
  document.querySelector('main').prepend(box);
  box.querySelector('button').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(box.querySelector('pre').textContent);note('诊断已复制，可直接粘贴回本对话。');}catch{note('无法访问剪贴板，请长按诊断文字复制。');}});
 }
 const samples=['latte','to go'].map(word=>({word,rendered:parts.map((x,index)=>({x,index})).filter(({x})=>R.normalize(x.w||x.text)===word).map(({x,index})=>({index,n:x.unit?.n??null,has_entry:!!x.entry,entry:x.entry||null}))}));
 const payload={revision:'wordcard-diag-20261018.2',build:window.APP_CONFIG.build,origin:location.origin,userAgent:navigator.userAgent,secureContext:window.isSecureContext,page,read_source:D.contentReads?.()||null,loaded:diagnosticSummary(pack()),server:diagnosticServer,sentence_count:units.length,mapped_sentence_count:document.querySelectorAll('.sentence-unit').length,samples,last_click:active?{word:active.w||active.text||'',n:active.unit?.n??null,has_entry:!!active.entry,entry:active.entry||null,shown_meaning:document.querySelector('.meaning-placeholder')?.textContent}:null,full_audio_rate:document.querySelector('#full-player')?.playbackRate??null};
 box.querySelector('pre').textContent=JSON.stringify(payload,null,2);
}
async function loadDiagnosticServer(){
 if(!diagnosticsEnabled||!selected)return;
 try{const r=await window.LocalWorkbench.request('/api/records/inputs/'+encodeURIComponent(selected),{cache:'no-store'});diagnosticServer=diagnosticSummary(await r.json());}
 catch(e){diagnosticServer={error:e.code||e.name,message:e.message};}
 updateDiagnostics();
}
function closeCard(){window.DemoWordVoice?.stop();sentenceAudio?.pause();$('#combined-card').hidden=true;anchor?.setAttribute('aria-expanded','false');active=null;}
function positionCard(){if(!anchor)return;const card=$('#combined-card'),a=anchor.getBoundingClientRect(),b=card.getBoundingClientRect();card.style.left=Math.max(12,Math.min(a.left,innerWidth-b.width-12))+'px';card.style.top=Math.max(12,Math.min(a.bottom+8,innerHeight-b.height-12))+'px';}
function openCard(target,part){
 closeCard();anchor=target;active=part;
 const card=$('#combined-card'),u=part.unit;card.hidden=false;card.classList.toggle('sentence-only',!part.word);$('#word-section').hidden=!part.word;
 $('#card-title').textContent=part.word?part.w:'本句工具';$('#sentence-quote').textContent=u?.text||'本词未匹配到句子映射';$('#sentence-number').textContent=u?'第'+u.n+'句':'';
 $('#sentence-section').hidden=!u;$('#translation-placeholder').hidden=true;$('#demo-translate').textContent='显示翻译';
 const meaning=$('.meaning-placeholder');meaning.textContent=part.entry?[part.entry.pos,part.entry.cn].filter(Boolean).join(' · '):'词包未收录，可手动添加中文义。';
 $('#demo-add').disabled=!!part.existing;$('#demo-add').textContent=part.existing?'已在词库':'加入生词';
 $('#demo-flag').textContent=flags()[u?.n]==='confused'?'取消没懂':'标记没懂';
 $('.card-note').textContent='加词会自动上报本篇；修改先存本机，设备间上传由你手动操作。';target.setAttribute('aria-expanded','true');positionCard();
 if(part.word)window.DemoWordVoice?.play(part.text||part.w);
 updateDiagnostics();
}
async function render(){
 if(recording)throw Error('请先结束当前录音。');
 closeCard();urls.forEach(URL.revokeObjectURL);urls=[];page=['today','shadowing','vocab','progress'].includes(location.hash.slice(1))?location.hash.slice(1):'today';
 document.querySelectorAll('.site-nav a').forEach(a=>a.classList.toggle('nav-current',a.hash==='#'+page));
 $('#course-picker').innerHTML=state.inputs.length?'<label>选择教材 <select id="course-select">'+state.inputs.filter(p=>p.type!=='level_test').map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selected?'selected':'')+'>'+esc((p.title_cn||p.title)+' · '+p.id)+'</option>').join('')+'</select></label>':'';
 $('#workspace').innerHTML=({today,shadowing,vocab,progress}[page])();if(page==='shadowing')await renderRecordList();await F.onRender(page);updateDiagnostics();
}
async function renderRecordList(){
 const box=$('#record-list');if(!box)return;
 const rows=state.shadowing.filter(r=>(r.inputId||r.input_id)===selected);
 box.innerHTML=rows.length?rows.map(r=>{const s=r.score||r,scored=['fluency','pronunciation','completeness'].every(k=>Number.isFinite(s[k]));return '<article class="vocab-entry"><h3>'+esc(r.filename||r.id)+'</h3><p>'+esc(r.date)+' · '+Math.round(r.durationSec||0)+'秒</p><div data-record-audio="'+esc(r.id)+'"></div><section class="take-feedback"><h3>本遍评分与反馈</h3><p>'+(scored?'流利度 '+s.fluency+' / 发音 '+s.pronunciation+' / 完整度 '+s.completeness: '待批改 · 未评分')+'</p><p>'+esc(s.note||'尚无教练评语')+'</p></section></article>';}).join(''):'<p>暂无本篇录音，完成后会逐条保留。</p>';
 for(const r of rows){const blob=await D.getBlob(r.blobKey||r.audioKey||r.audio_blob_key||r.key);if(!blob)continue;const url=URL.createObjectURL(blob);urls.push(url);const holder=[...box.querySelectorAll('[data-record-audio]')].find(e=>e.dataset.recordAudio===r.id);if(holder)holder.innerHTML='<audio controls src="'+url+'"></audio><a href="'+url+'" download="'+esc(r.filename||'recording')+'">下载本遍</a>';}
}
async function addWord(w,unit,entry){
 let cn=entry?.cn||'',pos=entry?.pos||'';if(!entry){cn=prompt('词包未收录，请填写中文含义（可留空）：','');if(cn===null)return;}
 const existing=state.vocab.find(v=>R.normalize(v.word)===R.normalize(w));
 if(!existing)await D.patch('vocab','word:'+encodeURIComponent(R.normalize(w)),{word:w,cn,pos,source:selected,source_sentence:unit?.text||'',sentence_n:unit?.n,added:date(),status:'new'});
 const all=[...new Set([...(pr().unknown_words||[]),w])];await saveProgress({unknown_words:all,unknown_submitted:true,unknown_rate:all.length/(pack().word_count||1)});state.vocab=await D.list('vocab');await F.recordArticleEncounters();
 document.querySelectorAll('[data-part]').forEach(b=>{const p=parts[Number(b.dataset.part)];if(R.normalize(p.w)===R.normalize(w))b.classList.add('is-added');});$('#demo-add').disabled=true;$('#demo-add').textContent='已加入并上报';note('已保存到本机词库并上报本篇；可点击上传学习数据。');
}
function recordMessage(s){const el=$('#record-status');if(el)el.textContent=s;}
async function startRecording(){
 if(recording||pendingTake)return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('浏览器未提供麦克风录音，请使用Mac Chrome并允许麦克风。');
 const p=pack(),player=$('#reference-player');if(!player)throw Error('未提供全文音频。');
 $('#start-record').disabled=true;recordMessage('等待麦克风授权…');
 let stream;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  if(page!=='shadowing'||p.id!==selected){stream.getTracks().forEach(t=>t.stop());return;}
  const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(t=>MediaRecorder.isTypeSupported?.(t));
  const recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined),chunks=[];
  const session={recorder,stream,player,started:performance.now(),finished:false,inputId:p.id,chunks,cancel:false};
  recording=session;player.pause();player.currentTime=0;player.controls=false;$('#stop-record').disabled=false;$('#recorder-state').textContent='录音中';
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onerror=()=>{session.cancel=true;recordMessage('录音失败，本遍不保存。');stopRecording();};
  player.onended=()=>{if(recording===session){session.finished=true;recordMessage('参考音频播完，录音继续；读完后点击结束录音。');}};
  recorder.onstop=async()=>{
   session.stream.getTracks().forEach(t=>t.stop());clearTimeout(session.delay);clearInterval(session.clock);player.pause();player.controls=true;recording=null;$('#stop-record').disabled=true;
   if(session.cancel||!session.finished){$('#start-record').disabled=false;recordMessage('本遍未完成，已丢弃；之前录音保留。');return;}
   const mime=recorder.mimeType||chunks[0]?.type;if(!mime||!chunks.length){$('#start-record').disabled=false;recordMessage('没有生成录音，请重新尝试。');return;}
   const ext=/mp4/.test(mime)?'m4a':/ogg/.test(mime)?'ogg':/wav/.test(mime)?'wav':'webm';
   const number=state.shadowing.filter(r=>(r.inputId||r.input_id)===session.inputId).length+1,id='shadowing:'+D.uuid(),filename=session.inputId+'_'+number+'_'+date()+'.'+ext;
   pendingTake={blob:new Blob(chunks,{type:mime}),record:{id,inputId:session.inputId,date:date(),durationSec:(performance.now()-session.started)/1000,filename,blobKey:'shadowing/'+id+'.'+ext,mime}};
   await saveTake();
  };
  recorder.start();session.started=performance.now();
  session.clock=setInterval(()=>{const sec=Math.floor((performance.now()-session.started)/1000);const out=$('#record-duration');if(out)out.textContent=String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');},250);
  recordMessage('录音已开始，3秒后播放参考音频。');
  session.delay=setTimeout(async()=>{if(recording!==session||recorder.state!=='recording')return;try{await player.play();if(recording===session)recordMessage('跟随参考音频朗读。提前结束会丢弃本遍。');else player.pause();}catch{session.cancel=true;recordMessage('音频无法播放，取消本遍，请重试。');stopRecording();}},3000);
 }catch(e){stream?.getTracks().forEach(t=>t.stop());recording=null;$('#start-record').disabled=false;throw e;}
}
function stopRecording(){const s=recording;if(!s)return;clearTimeout(s.delay);clearInterval(s.clock);s.player.pause();if(s.recorder.state!=='inactive')s.recorder.stop();}
async function saveTake(){
 if(!pendingTake)return;
 try{
  const {blob,record}=pendingTake;if(!blob.size)throw Error('录音为空，不能保存。');await D.saveBlob(record.blobKey,blob,{mime:record.mime,inputId:record.inputId,durationSec:record.durationSec});await D.patch('shadowing',record.id,record);pendingTake=null;
  state.shadowing=await D.list('shadowing');$('#pending-record').hidden=true;$('#start-record').disabled=false;recordMessage('本遍已保存到本机，可再录一遍。点击上传学习数据可同步录音。');await renderRecordList();
 }catch(e){
  const box=$('#pending-record');box.hidden=false;box.innerHTML='<p>保存失败，录音仍保留在本页，请勿关闭。</p><button id="retry-save">重试保存</button><button id="download-pending">下载备份</button>';recordMessage(e.message);
 }
}
function syncState(){
 const s=D.status();$('#sync-state').textContent=D.mode==='review'?'前端审核 · 与正式后端隔离 · 本页暂存 '+s.pending+' 项':(s.connected?'已连接':'无连接，已暂存本机')+' · 待上传 '+s.pending+' 项 · 上次上传 '+(s.lastUpload?new Date(s.lastUpload).toLocaleString('zh-CN'):'—')+' · 上次下载 '+(s.lastDownload?new Date(s.lastDownload).toLocaleString('zh-CN'):'—');
 for(const id of ['upload-data','download-data'])$('#'+id).disabled=(!s.connected&&D.mode!=='review')||s.busy||!!recording;
}
async function safe(fn){try{await fn();}catch(e){note(e.message||String(e));}finally{syncState();}}
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.id==='upload-data')return safe(async()=>{const result=await D.upload();note(result.preview?'上传入口已保留；审核页只演示，不发送真实数据。':'上传完成，冲突 '+result.conflicts+' 项。');});
 if(b.id==='download-data')return safe(async()=>{if(recording)throw Error('请先结束录音。');await D.download();await read();await render();note('下载入口已保留；审核页只演示，不读取或修改正式学习库。');});
 if(b.id==='view-conflicts')return safe(async()=>{const result=await D.conflicts();note(JSON.stringify(result));});
 if(b.dataset.part!==undefined)return openCard(b,parts[Number(b.dataset.part)]);
 if(b.dataset.unitButton!==undefined)return openCard(b,{word:false,unit:units[Number(b.dataset.unitButton)]});
 if(b.id==='close-card'){closeCard();anchor?.focus();return;}
 if(b.id==='demo-play')return safe(async()=>{const u=active?.unit;if(!u)return;sentenceAudio?.pause();sentenceAudio=new Audio(u.audio?.startsWith('/')?u.audio:media(u.audioKey||u.audio_blob_key));if(!u.audioKey&&!u.audio_blob_key&&!u.audio)throw Error('本句音频未下发。');window.PlaybackSpeed.prepare(sentenceAudio);await sentenceAudio.play();});
 if(b.id==='demo-translate'){const el=$('#translation-placeholder');el.textContent=active?.unit?.cn||'本句翻译尚未下发。';el.hidden=!el.hidden;$('#demo-translate').textContent=el.hidden?'显示翻译':'隐藏翻译';positionCard();return;}
 if(b.id==='demo-flag')return safe(async()=>{const n=active?.unit?.n;if(n==null)return;const value=flags()[n]==='confused'?null:'confused';await saveProgress({sentence_flags:{[n]:value}});document.querySelectorAll('[data-unit]').forEach(el=>{if(el.dataset.unit===String(n))el.classList.toggle('is-confused',value==='confused');});b.textContent=value?'取消没懂':'标记没懂';note('句子标记已存本机。');});
 if(b.id==='demo-add')return safe(()=>addWord(active.w,active.unit,active.entry));
 if(b.id==='start-record')return safe(startRecording);
 if(b.id==='stop-record')return stopRecording();
 if(b.id==='retry-save')return safe(saveTake);
 if(b.id==='download-pending'&&pendingTake){const url=URL.createObjectURL(pendingTake.blob),a=document.createElement('a');a.href=url;a.download=pendingTake.record.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);return;}
 if(b.id==='start-quiz')return safe(async()=>{quiz=L.selectQuiz(state.vocab);await render();});
 if(b.id==='cancel-quiz')return safe(async()=>{quiz=[];await render();});
});
document.addEventListener('submit',e=>{
 const f=e.target;if(!(f instanceof HTMLFormElement)||f.dataset.feature21)return;e.preventDefault();if(!f.reportValidity())return;
 safe(async()=>{
  const data=new FormData(f);
  if(f.dataset.questionForm){const kind=f.dataset.questionForm;if(pr()[kind]?.status)throw Error('本组已有作答，保留原始尝试。');const qs=pack()[kind];await saveProgress({[kind]:{answers:qs.map(q=>({question_id:q.id,option_id:data.get(q.id)})),total:qs.length,status:'submitted',submitted_at:new Date().toISOString()}});await render();note('答案已存本机，已按教练答案展示对错；可手动上传。');}
  if(f.id==='vocab-quiz'){const id='quiz:'+D.uuid();await D.patch('progress',id,{kind:'vocab_quiz',date:date(),status:'submitted',answers:quiz.map((v,i)=>({vocabId:v.id,recall_cn:data.get('recall'+i),sentence:data.get('sentence'+i)}))});quiz=[];await read();await render();note('抽查答案已存本机，上传后由教练批改。');}
 });
});
document.addEventListener('change',e=>{
 if(e.target.id==='course-select')return safe(async()=>{if(recording||pendingTake)throw Error('请先处理当前录音。');selected=e.target.value;await render();});
 if(e.target.id==='reading-check')return safe(async()=>{await saveProgress({reading_checked:e.target.checked});note('阅读确认已存本机。');});
 if(e.target.id==='vocab-filter')filterVocab();
});
function filterVocab(){const term=$('#vocab-search')?.value.toLowerCase()||'',status=$('#vocab-filter')?.value;document.querySelectorAll('.vocab-entry[data-state]').forEach(el=>el.hidden=!el.textContent.toLowerCase().includes(term)||(status==='familiar'?!F.known(state.vocab.find(v=>v.id===el.dataset.vocabId)||{}):!!status&&el.dataset.state!==status));}
document.addEventListener('input',e=>{if(e.target.id==='vocab-search')filterVocab();});
document.addEventListener('click',e=>{if(!e.target.closest('#combined-card,.demo-word,.sentence-dot'))closeCard();if(e.target.closest('.site-nav a')&&(recording||pendingTake)){e.preventDefault();note('请先结束录音并完成保存。');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeCard();anchor?.focus();}});
window.addEventListener('hashchange',()=>safe(async()=>{if(recording||pendingTake){history.replaceState(null,'','#shadowing');return;}await render();}));
window.addEventListener('sync-state',syncState);
window.addEventListener('beforeunload',e=>{if(recording||pendingTake){e.preventDefault();e.returnValue='';}});
window.addEventListener('resize',positionCard);
F.setup({get state(){return state;},get selected(){return selected;},pack,pr,read,render,saveProgress,note,safe,esc,media,date,D,R});
safe(async()=>{await read();await render();await D.probe();await loadDiagnosticServer();syncState();note('完整前端审核：所有教材与记录均为样例，原功能保留；刷新后本页暂存重置。');});
})();
