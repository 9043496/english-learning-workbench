/* 2.1：真实测试与旧词重逢，使用既有Data接口和显式同步。 */
(function(){
'use strict';
const $=s=>document.querySelector(s),modes=['listening','speaking','reading','writing'];
let C=null,testPack=null,attempt=null,section=0,part=1,question=0,returnFocus=null,persistQueue=Promise.resolve(),mic=null,preparation=null,prepRemaining=60,prepared=false,audio=null;
let playbackUrls=[],micRequest=0;
const e=s=>C.esc(s);
const known=v=>v.status==='mastered'||v.manual_known===true||Object.keys(v.review_articles||{}).length>=12||v.familiar===true;
const reuseWord=item=>typeof item==='string'?item:item?.w||C.state.vocab.find(v=>v.id===item?.vocabId)?.word||'';
const reencounterDrafts=new Map();
function reused(pack){
 const seen=new Set();return (pack?.reused_vocab||[]).map(item=>C.state.vocab.find(v=>(typeof item==='object'&&item.vocabId===v.id)||C.R.normalize(v.word)===C.R.normalize(reuseWord(item)))).filter(v=>{if(!v||seen.has(v.id))return false;seen.add(v.id);return true;}).map(v=>({word:v.word,vocabId:v.id}));
}
function reencounterDraft(){if(!reencounterDrafts.has(C.selected))reencounterDrafts.set(C.selected,{words:new Set(),answers:{}});return reencounterDrafts.get(C.selected);}
function reusedKeys(pack){return new Set(reused(pack).map(x=>C.R.normalize(x.word)));}
function assessmentEntry(packs){
 const tests=packs.filter(p=>p.type==='level_test');
 return '<section class="assessment-entry"><div class="assessment-entry-copy"><div class="small-caps">MONTHLY CHECK-IN <span class="assessment-pill">水平测试</span></div><h2>停一下，看看现在的自己。</h2><p>听说读写独立记录 · '+(tests.length?tests.length+' 份测试包':'等待 Muse 下发本月测试包')+'</p></div><button type="button" class="assessment-open" data-open-real-test>查看水平测试 ↗</button></section>';
}
function reencounterBefore(pack){
 const words=reused(pack);if(!words.length)return '';
 return '<section class="reencounter"><div class="section-eyebrow">BEFORE READING / 读前重逢</div><h2>这几个词，又见面了。</h2><p class="section-intro">Muse 为本篇安排了 '+words.length+' 个旧词；正文中以淡绿色标出。</p><div class="reencounter-words">'+words.map(x=>'<span class="reencounter-chip" lang="en">'+e(x.word)+'</span>').join('')+'</div></section>';
}
function reencounterAfter(pack){
 const id='reencounter:'+pack.id,prior=C.state.progress.find(p=>p.id===id);
 const heading='<section class="reencounter-output"><div class="section-eyebrow">AFTER READING / 读后回顾</div><h2>让它们，成为你的句子。</h2>';
 if(prior)return heading+(prior.answers||[]).map(a=>'<section class="reencounter-field"><h3>'+e(a.word)+'</h3><blockquote>'+e(a.sentence)+'</blockquote></section>').join('')+'<p class="waiting-feedback">已提交，'+(prior.status==='graded'?'已批改':'待 Muse 批改')+'。'+e(prior.note||'')+'</p></section>';
 const words=reused(pack);if(!words.length)return '';const draft=reencounterDraft();
 return heading+'<p class="section-intro">选择其中2–3个词，各写一句英文。未选词不要求作答。</p><form data-feature21="reencounter" data-record="'+e(id)+'"><div class="reencounter-words">'+words.map(x=>'<label class="reencounter-chip"><input type="checkbox" data-reencounter-word="'+e(x.vocabId)+'" '+(draft.words.has(x.vocabId)?'checked':'')+'>'+e(x.word)+'</label>').join('')+'</div><p>已选 '+draft.words.size+' / 最多3词</p>'+words.filter(x=>draft.words.has(x.vocabId)).map(x=>'<section class="reencounter-field"><h3>'+e(x.word)+'</h3><label>用这个词写一个英文句子<textarea required data-reencounter-answer="'+e(x.vocabId)+'" name="'+e(x.vocabId)+'" lang="en">'+e(draft.answers[x.vocabId]||'')+'</textarea></label></section>').join('')+'<button type="submit" class="green-button" '+(draft.words.size<2?'disabled':'')+'>提交造句</button></form></section>';
}
function familiarityMarkup(v){
 const articles=Object.entries(v.review_articles||{}),count=articles.length;
 return '<section class="familiarity-entry"><div class="familiarity-meter-line"><span>'+(known(v)?'已熟识':'回顾中')+'</span><strong>'+count+' / 12 次</strong></div><meter min="0" max="12" value="'+Math.min(count,12)+'">'+count+'/12</meter><label class="manual-known"><input type="checkbox" data-manual-known="'+e(v.id)+'" '+(v.manual_known?'checked':'')+'> 我已熟识这个词</label><p class="preview-caption">'+(v.manual_known?'自行标注':count>=12?'满12篇自动熟识':'词在一篇文章中出现计1次，同篇不重复')+'</p><details class="encounter-history"><summary>在哪些文章里重逢过？ '+count+' 篇</summary>'+(count?articles.map(([id,x])=>'<p>'+e(x.title||C.state.inputs.find(p=>p.id===id)?.title||id)+' <small>'+e(id)+'</small></p>').join(''):'<p>尚无回顾文章记录。</p>')+'</details></section>';
}
function appears(word,body){
 const tokens=C.R.lex((Array.isArray(body)?body:[body||'']).map(p=>typeof p==='string'?p:p.text||'').join(' ')).map(x=>x.key),keys=C.R.lex(word).map(x=>x.key);
 return keys.length>0&&tokens.some((_,i)=>keys.every((key,j)=>tokens[i+j]===key));
}
async function recordArticleEncounters(){
 const pack=C.pack();if(!pack||pack.type==='level_test')return;
 for(const v of C.state.vocab){
  if(v.review_articles?.[pack.id]||!appears(v.word,pack.body))continue;
  await C.D.patch('vocab',v.id,{review_articles:{[pack.id]:{inputId:pack.id,title:pack.title,first_seen_at:new Date().toISOString()}}});
 }
 C.state.vocab=await C.D.list('vocab');
}
function testHistory(state){
 const tests=state.progress.filter(p=>p.kind==='level_test');
 return '<section class="level-history"><div class="section-eyebrow">MONTHLY ASSESSMENT / 独立测试记录</div><h2>看见你的阶段变化。</h2><p>测试不进入日常三信号或 i+1。</p>'+(tests.length?tests.map(r=>{const a=r.assessment;return '<article class="level-pending-record"><h3>'+e(state.inputs.find(p=>p.id===r.inputId)?.title||r.inputId)+'</h3><p>'+e(r.date)+' · '+(a?'已批改':r.status==='submitted'?'待批改':'尚未提交')+'</p>'+(a?'<dl class="assessment-scores">'+modes.map(k=>'<div><dt>'+k+'</dt><dd>'+e(a.scores?.[k]??'—')+'</dd></div>').join('')+'</dl><p>总评：'+e(a.overall_comment)+'</p><p>水平判定：'+e(a.level)+'</p><p>下月难度建议：'+e(a.next_month_advice)+'</p>':'')+'<button type="button" class="quiet-button" data-open-real-test="'+e(r.inputId)+'">查看作答</button></article>';}).join(''):'<p class="history-empty">暂无测试作答记录。</p>')+'</section>';
}
const submitted=()=>attempt&&['submitted','graded'].includes(attempt.status);
function stopQuestionAudio(){audio?.pause();window.speechSynthesis?.cancel();}
function testNote(message){$('#test-message').textContent=message;}
function persist(){
 if(!attempt||submitted())return persistQueue;
 const snapshot=JSON.parse(JSON.stringify(attempt));
 persistQueue=persistQueue.catch(()=>{}).then(()=>C.D.patch('progress',snapshot.id,snapshot));
 return persistQueue;
}
async function openTest(id,target){
 if(mic)return;
 const packs=C.state.inputs.filter(p=>p.type==='level_test');
 returnFocus=target;$('#combined-card').hidden=true;window.DemoWordVoice?.stop();
 $('#level-modal').hidden=false;$('#workspace-shell').inert=true;$('#workspace-shell').setAttribute('aria-hidden','true');document.body.classList.add('modal-open');
 $('#test-pack-picker').innerHTML=packs.map(p=>'<option value="'+e(p.id)+'">'+e(p.title)+' · '+e(p.date)+'</option>').join('');
 if(!packs.length){testPack=null;attempt=null;$('#test-real-body').hidden=true;testNote('Muse 尚未下发正式水平测试包。这里不使用审核样例填充。');$('#level-dialog').focus();return;}
 const pack=packs.find(p=>p.id===id)||packs[0];$('#test-pack-picker').value=pack.id;
 await loadAttempt(pack);$('#level-dialog').focus();
}
async function loadAttempt(pack){
 if(mic)throw Error('请先结束当前回答。');
 micRequest++;cancelPreparation();stopQuestionAudio();testPack=pack;
 attempt=(await C.D.list('progress')).find(p=>p.kind==='level_test'&&p.inputId===pack.id)||{id:'level_test:'+pack.id,kind:'level_test',type:'level_test',inputId:pack.id,date:C.date(),status:'draft',answers:{listening:[],reading:[],speaking:[],writing:{text:''}},preparation_notes:''};
 if(!attempt.answers)attempt.answers={};for(const kind of ['listening','reading','speaking'])if(!Array.isArray(attempt.answers[kind]))attempt.answers[kind]=[];
 attempt.answers.writing||={text:''};section=0;part=1;question=0;prepared=false;prepRemaining=60;
 $('#test-real-body').hidden=false;$('#test-title').textContent=pack.title;
 $('#test-submitted-state').hidden=!submitted();$('#go-real-test-results').hidden=!submitted();
 $('#real-test-submit').disabled=submitted();$('#real-test-submit').textContent=submitted()?'已提交':'提交本次测试';
 $('#test-pack-picker').disabled=false;renderSection();testNote(submitted()?(attempt.assessment?'Muse 已批改，本次原始作答保留。':'已提交。请上传学习数据，等待 Muse 批改。'):'按四项完成测试。草稿与录音先存本机，完成后请上传。');
}
async function closeTest(){
 if(mic){testNote('请先结束当前回答，再关闭测试。');return;}
 try{await persist();}catch(e){testNote('本机保存失败，请勿关闭：'+e.message);return;}
 micRequest++;cancelPreparation();stopQuestionAudio();playbackUrls.forEach(URL.revokeObjectURL);playbackUrls=[];
 $('#level-modal').hidden=true;$('#workspace-shell').inert=false;$('#workspace-shell').removeAttribute('aria-hidden');document.body.classList.remove('modal-open');returnFocus?.focus();
}
function selectSection(index){
 if(mic){testNote('请先结束当前回答。');return;}
 cancelPreparation();stopQuestionAudio();section=Math.max(0,Math.min(3,index));renderSection();
}
function renderSection(){
 document.querySelectorAll('[data-test-tab]').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===section));b.tabIndex=i===section?0:-1;});
 $('#previous-section').disabled=section===0;$('#next-section').disabled=section===3;
 const kind=modes[section],data=testPack.sections[kind];
 if(kind==='listening'||kind==='reading'){
  const intro=kind==='listening'?'<audio controls preload="metadata" src="'+e(C.media(data.audioKey))+'"></audio>':'<div class="article-body">'+(Array.isArray(data.body)?data.body:[data.body]).map(x=>'<p>'+e(typeof x==='string'?x:x.text)+'</p>').join('')+'</div>';
  $('#real-test-content').innerHTML=intro+data.questions.map(q=>'<fieldset class="assessment-choice"><legend lang="en">'+e(q.q)+'</legend>'+q.options.map(o=>{const chosen=attempt.answers[kind].find(a=>a.question_id===q.id)?.option_id===o.id;return '<label><input type="radio" data-test-choice="'+kind+'" name="'+e(q.id)+'" value="'+e(o.id)+'" '+(chosen?'checked ':'')+(submitted()?'disabled':'')+'><span class="option-letter">'+e(o.id.toUpperCase())+'</span><span>'+e(o.text)+'</span></label>';}).join('')+'</fieldset>').join('');
 }else if(kind==='writing'){
  $('#real-test-content').innerHTML='<h3>Writing</h3><p>'+e(data.prompt)+'</p>'+(data.word_limit?'<p>字数要求：'+e(data.word_limit)+'</p>':'')+'<label for="real-test-writing">英文作答</label><textarea id="real-test-writing" lang="en" rows="9" '+(submitted()?'readonly':'')+'>'+e(attempt.answers.writing.text)+'</textarea>';
 }else renderInterview();
}
function currentTask(){
 const section=testPack.sections.speaking.parts.find(p=>p.part===part);
 return part===2?{...section.task,part:2}:{...section.questions[question],part};
}
function cancelPreparation(){clearInterval(preparation);preparation=null;}
function renderInterview(){
 const partData=testPack.sections.speaking.parts.find(p=>p.part===part),task=currentTask(),answer=attempt.answers.speaking.find(a=>a.question_id===task.id);
 $('#real-test-content').innerHTML='<div class="interview-part-tabs" role="tablist" aria-label="口语三部分">'+[1,2,3].map(n=>'<button type="button" role="tab" data-real-part="'+n+'" aria-selected="'+String(n===part)+'" tabindex="'+(n===part?0:-1)+'">Part '+n+'<span>'+({1:'熟悉话题',2:'题卡陈述',3:'延伸讨论'}[n])+'</span></button>').join('')+'</div>'+
 '<section class="interview-question-card"><div class="interview-heading"><span>PART '+part+'</span><span>问题 '+(part===2?1:question+1)+'</span></div><p id="real-interview-question" lang="en">'+e(task.text)+'</p>'+(task.points?.length?'<ul>'+task.points.map(x=>'<li>'+e(x)+'</li>').join('')+'</ul>':'')+'<button type="button" id="play-real-question" class="quiet-button">▷ 播放提问</button></section>'+
 (part===2?'<section class="interview-preparation"><span>准备1分钟</span> <output id="real-preparation-clock">'+clock(prepRemaining)+'</output><button type="button" id="real-start-preparation" class="quiet-button" '+(submitted()||answer||preparation||prepared?'disabled':'')+'>开始准备</button><label for="real-preparation-notes">准备笔记</label><textarea id="real-preparation-notes" '+(submitted()?'readonly':'')+'>'+e(attempt.preparation_notes||'')+'</textarea></section>':'')+
 '<div class="interview-answer-dock"><div><span id="real-answer-status">'+(answer?'本问回答已保存':'等待回答')+'</span><output id="real-answer-clock">00:00</output></div><div class="interview-answer-actions"><button type="button" id="real-start-answer" class="green-button" '+(submitted()||answer||part===2&&!prepared?'disabled':'')+'>开始回答</button><button type="button" id="real-stop-answer" class="quiet-button" disabled>结束回答</button><button type="button" id="real-next-question" class="quiet-button">'+(part===3&&question===partData.questions.length-1?'回到第一问':part===2?'进入 Part 3':'下一问 →')+'</button></div></div><div id="real-test-answer-audio"></div>';
 $('#real-interview-question').closest('.interview-question-card').append(window.PlaybackSpeed.control());
 if(answer)C.safe(async()=>{const blob=await C.D.getBlob(answer.blobKey);if(!testPack||task.id!==currentTask().id)return;if(blob){const url=URL.createObjectURL(blob);playbackUrls.push(url);const holder=$('#real-test-answer-audio');if(holder)holder.innerHTML='<audio controls src="'+url+'"></audio>';}else testNote('本问录音尚未下载，请关闭后点击“下载学习数据”。');});
}
function clock(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
async function startAnswer(){
 if(mic||submitted())return;
 const task=currentTask();if(attempt.answers.speaking.some(a=>a.question_id===task.id)||part===2&&!prepared)return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('当前浏览器没有麦克风录音能力。');
 stopQuestionAudio();$('#real-start-answer').disabled=true;testNote('等待麦克风授权…');
 const request=++micRequest;let stream;
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:true});
  if(request!==micRequest||$('#level-modal').hidden){stream.getTracks().forEach(t=>t.stop());return;}
  const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(t=>MediaRecorder.isTypeSupported?.(t));
  const recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined),chunks=[];
  const active={recorder,stream,task,recordId:attempt.id,inputId:testPack.id,chunks,started:performance.now(),error:false};mic=active;
  $('#real-stop-answer').disabled=false;$('#real-next-question').disabled=true;$('#play-real-question').disabled=true;$('#real-answer-status').textContent='回答录音中';$('#test-pack-picker').disabled=true;
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  recorder.onerror=()=>{active.error=true;stopAnswer();};
  recorder.onstop=async()=>{
   clearInterval(active.timer);stream.getTracks().forEach(t=>t.stop());
   const seconds=Math.max(.01,(performance.now()-active.started)/1000);
   try{
    if(active.error||!chunks.length){mic=null;$('#test-pack-picker').disabled=false;renderInterview();throw Error('未生成有效录音，请重试。');}
    const mime=recorder.mimeType||chunks[0].type,ext=/mp4/.test(mime)?'m4a':/ogg/.test(mime)?'ogg':/wav/.test(mime)?'wav':'webm';
    const blob=new Blob(chunks,{type:mime}),key='level-tests/'+encodeURIComponent(active.inputId)+'/'+encodeURIComponent(task.id)+'/'+C.D.uuid()+'.'+ext;
    // Keep the actual Blob recoverable until both local saves complete.
    active.pending={blob,key,mime,seconds};
    await saveAnswer(active);
   }catch(e){testNote('录音保存未完成：'+e.message+'。请勿关闭；可下载备份或重试保存。');if(active.pending)$('#real-test-answer-audio').innerHTML='<button type="button" id="retry-test-answer">重试保存</button><button type="button" id="download-test-answer">下载录音备份</button>';}
  };
  recorder.start();active.started=performance.now();active.timer=setInterval(()=>{const seconds=Math.floor((performance.now()-active.started)/1000);if($('#real-answer-clock'))$('#real-answer-clock').textContent=clock(seconds);if(task.part===2&&seconds>=120)stopAnswer();},250);
  testNote('请根据问题作答，结束后点击“结束回答”。本次录音只关联水平测试。');
 }catch(e){stream?.getTracks().forEach(t=>t.stop());mic=null;$('#real-start-answer').disabled=false;throw e;}
}
async function saveAnswer(active){
 if(!active.pending)throw Error('没有可保存的录音。');
 const {blob,key,mime,seconds}=active.pending;
 await C.D.saveBlob(key,blob,{mime,inputId:active.inputId,durationSec:seconds,kind:'level_test',questionId:active.task.id});
 const item={question_id:active.task.id,part:active.task.part,blobKey:key,mime,durationSec:seconds};
 const existing=attempt.answers.speaking.findIndex(a=>a.question_id===item.question_id);
 if(existing<0)attempt.answers.speaking.push(item);else attempt.answers.speaking[existing]=item;
 await persist();mic=null;active.pending=null;$('#test-pack-picker').disabled=false;renderInterview();testNote('本问录音已保存到本机。完成测试后请上传，Muse才能读取录音。');
}
function stopAnswer(){if(!mic||mic.recorder.state==='inactive')return;clearInterval(mic.timer);mic.recorder.stop();$('#real-stop-answer').disabled=true;}
function prepare(){
 if(preparation||prepared||submitted())return;prepRemaining=60;$('#real-start-preparation').disabled=true;
 preparation=setInterval(()=>{prepRemaining--;if($('#real-preparation-clock'))$('#real-preparation-clock').textContent=clock(prepRemaining);if(prepRemaining<=0){cancelPreparation();prepared=true;$('#real-start-answer').disabled=false;testNote('准备结束，可以开始回答；陈述最多2分钟。');}},1000);
}
async function submitTest(){
 if(mic)throw Error('请先结束并保存当前口语回答。');
 const answers=attempt.answers;
 for(const kind of ['listening','reading'])if(testPack.sections[kind].questions.some(q=>!answers[kind].some(a=>a.question_id===q.id)))throw Error('请完成听力与阅读的所有选择题。');
 const tasks=testPack.sections.speaking.parts.flatMap(p=>p.part===2?[p.task]:p.questions);
 if(tasks.some(q=>!answers.speaking.some(a=>a.question_id===q.id)))throw Error('口语还有未回答的问题。');
 if(!answers.writing.text?.trim())throw Error('请完成写作。');
 await persistQueue;
 const next=JSON.parse(JSON.stringify({...attempt,status:'submitted',submitted_at:new Date().toISOString()}));await C.D.patch('progress',next.id,next);attempt=next;
 await C.read();$('#test-submitted-state').hidden=false;$('#go-real-test-results').hidden=false;$('#real-test-submit').disabled=true;renderSection();testNote('测试已提交到本机，请点击上传学习数据。收到 Muse 批改后下载查看。');
}
function setup(ctx){
 C=ctx;
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  const run=fn=>C.safe(fn);
  if(b.hasAttribute('data-open-real-test'))return run(()=>openTest(b.dataset.openRealTest,b));
  if(b.id==='close-test')return run(closeTest);
  if(b.dataset.testTab)return selectSection(modes.indexOf(b.dataset.testTab));
  if(b.id==='previous-section')return selectSection(section-1);
  if(b.id==='next-section')return selectSection(section+1);
  if(b.dataset.realPart){if(mic){testNote('请先结束当前回答。');return;}cancelPreparation();stopQuestionAudio();part=Number(b.dataset.realPart);question=0;prepared=false;prepRemaining=60;return renderInterview();}
  if(b.id==='real-next-question'){
   if(mic)return;stopQuestionAudio();
   if(part===2){part=3;question=0;}else{const list=testPack.sections.speaking.parts.find(p=>p.part===part).questions;if(question+1<list.length)question++;else if(part===1){part=2;question=0;prepared=false;prepRemaining=60;}else question=0;}
   cancelPreparation();return renderInterview();
  }
  if(b.id==='real-start-preparation')return prepare();
  if(b.id==='real-start-answer')return run(startAnswer);
  if(b.id==='real-stop-answer')return stopAnswer();
  if(b.id==='retry-test-answer')return run(()=>saveAnswer(mic));
  if(b.id==='download-test-answer'&&mic?.pending){const url=URL.createObjectURL(mic.pending.blob);playbackUrls.push(url);const a=document.createElement('a');a.href=url;a.download='level-test-answer.'+(/mp4/.test(mic.pending.mime)?'m4a':'webm');a.click();return;}
  if(b.id==='real-test-submit')return run(submitTest);
  if(b.id==='play-real-question')return run(async()=>{
   stopQuestionAudio();const task=currentTask();if(task.audioKey){audio=new Audio(C.media(task.audioKey));window.PlaybackSpeed.prepare(audio);await audio.play();return;}
   const voice=window.speechSynthesis?.getVoices().find(v=>v.localService&&/^en/i.test(v.lang));
   if(!voice)throw Error('本题没有提问音频，本机也无可用英语语音；请阅读题目后回答。');
   const utterance=new SpeechSynthesisUtterance(task.text);utterance.voice=voice;utterance.lang=voice.lang;utterance.rate=window.PlaybackSpeed.get();window.speechSynthesis.speak(utterance);
  });
 });
 document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='test-pack-picker')return C.safe(async()=>{await persist();await loadAttempt(C.state.inputs.find(p=>p.id===el.value));});
  if(el.dataset.reencounterWord)return C.safe(async()=>{const draft=reencounterDraft(),id=el.dataset.reencounterWord;if(el.checked){if(draft.words.size>=3){el.checked=false;C.note('最多选择3个词。');return;}draft.words.add(id);}else draft.words.delete(id);await C.render();});
  if(el.dataset.testChoice){const kind=el.dataset.testChoice;attempt.answers[kind]=attempt.answers[kind].filter(a=>a.question_id!==el.name);attempt.answers[kind].push({question_id:el.name,option_id:el.value});return C.safe(persist);}
  if(el.dataset.manualKnown)return C.safe(async()=>{await C.D.patch('vocab',el.dataset.manualKnown,{manual_known:el.checked});await C.read();await C.render();C.note('熟识标记已存本机；Muse评分未改变。');});
 });
 let writingTimer;
 document.addEventListener('input',event=>{
  if(event.target.dataset.reencounterAnswer)reencounterDraft().answers[event.target.dataset.reencounterAnswer]=event.target.value;
  if(event.target.id==='real-test-writing'){attempt.answers.writing={text:event.target.value};clearTimeout(writingTimer);writingTimer=setTimeout(()=>C.safe(persist),350);}
  if(event.target.id==='real-preparation-notes'){attempt.preparation_notes=event.target.value;clearTimeout(writingTimer);writingTimer=setTimeout(()=>C.safe(persist),350);}
 });
 document.addEventListener('submit',event=>{
  const form=event.target;if(form.dataset.feature21!=='reencounter')return;event.preventDefault();
  if(!form.reportValidity())return;
  C.safe(async()=>{
   if(C.state.progress.some(p=>p.id===form.dataset.record))throw Error('本篇造句已提交，保留原答案。');
   const data=new FormData(form),draft=reencounterDraft(),words=reused(C.pack()).filter(x=>draft.words.has(x.vocabId));
   if(words.length<2||words.length>3)throw Error('请选择2–3个词。');
   if(words.some(x=>!String(data.get(x.vocabId)||'').trim()))throw Error('请填写所选词的英文句子。');
   const answers=words.map(x=>({word:x.word,vocabId:x.vocabId,sentence:data.get(x.vocabId)}));
   await C.D.patch('progress',form.dataset.record,{kind:'vocab_quiz',inputId:C.selected,date:C.date(),status:'submitted',answers});await C.read();await C.render();C.note('重逢造句已保存，上传后由Muse批改；文章计数不依赖造句。');
  });
 });
 $('#go-real-test-results').addEventListener('click',()=>C.safe(async()=>{await closeTest();location.hash='progress';await C.read();await C.render();}));
 $('#level-modal').addEventListener('click',event=>{if(event.target===$('#level-modal'))C.safe(closeTest);});
 document.addEventListener('keydown',event=>{
  if($('#level-modal').hidden)return;
  if(event.key==='Escape'){event.preventDefault();C.safe(closeTest);}
  if(event.key==='Tab'){
   const items=[...$('#level-dialog').querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),textarea,select:not(:disabled)')].filter(el=>!el.closest('[hidden]'));const first=items[0],last=items.at(-1);
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===$('#level-dialog'))){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===$('#level-dialog'))){event.preventDefault();first?.focus();}
  }
 });
 window.addEventListener('beforeunload',event=>{if(mic){event.preventDefault();event.returnValue='';}});
}
async function onRender(page){if(page==='today')await recordArticleEncounters();}
window.Features21={setup,assessmentEntry,reencounterBefore,reencounterAfter,familiarityMarkup,known,reusedKeys,testHistory,onRender,recordArticleEncounters};
})();
