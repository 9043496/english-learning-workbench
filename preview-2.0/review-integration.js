/* Incremental review additions around the complete, existing frontend. */
(() => {
 'use strict';
 const F=window.Features21,originalSetup=F.setup,originalRender=F.onRender;
 let C=null;const selections=new Map();
 const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const words=()=> (C.pack()?.reused_vocab||[]).map(x=>typeof x==='string'?x:x.w).map(w=>C.state.vocab.find(v=>C.R.normalize(v.word)===C.R.normalize(w))).filter(Boolean);
 const selected=()=>{if(!selections.has(C.selected))selections.set(C.selected,{words:new Set(),answers:{}});return selections.get(C.selected);};
 F.setup=ctx=>{C=ctx;window.ReviewContext=ctx;originalSetup(ctx);};
 F.reencounterBefore=()=>{
  const items=words();if(!items.length)return '';
  return '<section class="reencounter"><div class="section-eyebrow">BEFORE READING / 读前重逢</div><h2>这几个词，又见面了。</h2><p class="section-intro">从生词本选出的 '+items.length+' 个旧词。先回忆，再看原来的语境与释义。</p><div class="reencounter-words">'+items.map(v=>'<span class="reencounter-chip">'+e(v.word)+'</span>').join('')+'</div>'+items.map(v=>'<details class="review-reuse-origin"><summary>'+e(v.word)+' · 回看原句与词义</summary><blockquote>'+e(v.source_sentence)+'</blockquote><p>'+e(v.pos)+' · '+e(v.cn)+'</p><p>来源：'+e(v.source)+'（审核样例）</p></details>').join('')+'</section>';
 };
 F.reencounterAfter=()=>{
  const items=words();if(!items.length)return '';
  const prior=C.state.progress.find(p=>p.id==='reencounter:'+C.selected),s=selected();
  if(prior)return '<section class="reencounter-output"><div class="section-eyebrow">AFTER READING / 读后回顾</div><h2>让它们，成为你的句子。</h2>'+prior.answers.map(a=>'<section class="reencounter-field"><h3>'+e(a.word)+'</h3><blockquote>'+e(a.sentence)+'</blockquote></section>').join('')+'<p class="review-status">已在审核页提交 '+prior.answers.length+' 词；待批改。刷新后重置。</p></section>';
  return '<section class="reencounter-output"><div class="section-eyebrow">AFTER READING / 读后回顾</div><h2>让它们，成为你的句子。</h2><p class="section-intro">选择其中2–3个词，各写一句英文。未选词不要求作答。</p><form data-feature21="reencounter-choice"><div class="review-reuse-choice">'+items.map(v=>'<label><input type="checkbox" data-review-word="'+e(v.word)+'" '+(s.words.has(v.word)?'checked':'')+'>'+e(v.word)+'</label>').join('')+'</div><p class="review-status">已选 '+s.words.size+' / 最多3词</p>'+items.filter(v=>s.words.has(v.word)).map(v=>'<section class="reencounter-field"><h3>'+e(v.word)+'</h3><label>用这个词写一个英文句子<textarea required data-review-answer="'+e(v.word)+'" lang="en">'+e(s.answers[v.word]||'')+'</textarea></label></section>').join('')+'<button type="submit" class="green-button" '+(s.words.size<2?'disabled':'')+'>提交造句（审核页）</button></form></section>';
 };
 function frame(kind,title){return '<iframe class="review-frame" src="additions.html?embed='+kind+'&amp;rev=baseline21-3" title="'+title+'" loading="eager"></iframe>';}
 function ensureStoryDialog(){
  if(document.getElementById('review-story-dialog'))return;
  const el=document.createElement('dialog');el.id='review-story-dialog';el.className='review-story-dialog';el.setAttribute('aria-label','故事精听');
  el.innerHTML='<div class="review-dialog-top"><span>故事精听 · 增量审核</span><button type="button" id="close-review-story" aria-label="关闭故事精听">×</button></div><div id="review-story-holder"></div>';
  document.body.append(el);
  el.addEventListener('close',()=>{el.querySelector('iframe')?.remove();document.querySelector('#open-review-story')?.focus();});
 }
 F.onRender=async page=>{
  await originalRender(page);const workspace=document.querySelector('#workspace');
  if(page==='today'){
   workspace.insertAdjacentHTML('afterbegin','<div class="review-daily-plan"><strong>每日两篇 · 整体约两小时</strong>　原有练习完整保留，故事精听作为新增入口。</div>');
   const node=document.createElement('section');node.className='review-story-entry';node.innerHTML='<div><div class="section-eyebrow">STORY LISTENING / 新增故事精听</div><h2>先听见一个故事。</h2><p>听故事 → 检查理解 → 文字对照。无需逐字听写。</p></div><button type="button" id="open-review-story">开始精听 →</button>';
   workspace.querySelector('.assessment-entry').after(node);
  }
  if(page==='shadowing')workspace.insertAdjacentHTML('beforeend','<section class="review-increment"><div class="section-eyebrow">NEW / 每遍量化反馈</div><h2>新增的量化反馈，会接在对应录音下。</h2><p>上方原有录音、多遍保存、试听和反馈完整保留。下方仅展示新增分析样例，不代表你的实际录音表现。</p>'+frame('record','录音量化反馈样例')+'</section>');
  if(page==='progress')workspace.insertAdjacentHTML('beforeend','<section class="review-increment"><div class="section-eyebrow">NEW / 量化与十篇复评</div><h2>在原有进度之上，补充判定依据。</h2><p>上方独立月测、三趋势、每篇记录和教练周报完整保留。下方为量化试算与样本计数的审核样例。</p>'+frame('metrics','难度规则试算与十篇复评')+'</section>');
  ensureStoryDialog();
 };
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.id==='open-review-story'){
   document.querySelectorAll('audio').forEach(a=>a.pause());
   const dialog=document.getElementById('review-story-dialog');document.getElementById('review-story-holder').innerHTML=frame('story','故事精听：听故事、理解检查、文字对照');
   if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
  }
  if(b.id==='close-review-story'){
   const dialog=document.getElementById('review-story-dialog');if(dialog.close)dialog.close();else{dialog.removeAttribute('open');document.getElementById('review-story-holder').innerHTML='';}
  }
 });
 document.addEventListener('change',event=>{
  const w=event.target.dataset.reviewWord;if(!w)return;
  C.safe(async()=>{const s=selected();if(event.target.checked){if(s.words.size>=3){event.target.checked=false;C.note('最多选择3个词。');return;}s.words.add(w);}else s.words.delete(w);await C.render();});
 });
 document.addEventListener('input',event=>{const w=event.target.dataset.reviewAnswer;if(w)selected().answers[w]=event.target.value;});
 document.addEventListener('submit',event=>{
  if(event.target.dataset.feature21!=='reencounter-choice')return;event.preventDefault();
  C.safe(async()=>{
   const s=selected();if(s.words.size<2||s.words.size>3)throw Error('请选择2–3个词。');
   if([...s.words].some(w=>!(s.answers[w]||'').trim()))throw Error('请填写所选词的英文句子。');
   await C.D.patch('progress','reencounter:'+C.selected,{kind:'vocab_quiz',inputId:C.selected,date:C.date(),status:'submitted',answers:[...s.words].map(w=>({word:w,vocabId:words().find(v=>v.word===w).id,sentence:s.answers[w]}))});
   await C.read();await C.render();C.note('原造句提交链路保留：本页样例已暂存，未上传正式后端。');
  });
 });
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.data?.type!=='review-frame-height'||!Number.isFinite(event.data.height))return;
  const iframe=[...document.querySelectorAll('.review-frame')].find(f=>f.contentWindow===event.source);if(iframe)iframe.style.height=Math.max(250,Math.min(12000,event.data.height+12))+'px';
 });
})();
