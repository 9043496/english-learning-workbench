/* Complete workbench preview adapter. Synthetic fixtures only; memory only. */
(() => {
 'use strict';
 window.APP_CONFIG={build:'workbench-2.0-complete-review-20261019',storeMode:'review',coachName:'教练'};
 const f=window.REVIEW_FIXTURE,copy=x=>JSON.parse(JSON.stringify(x));
 const choices=(id,q,options,answer,explanation)=>({id,q,options:options.map((text,i)=>({id:'abcd'[i],text})),correct_option_id:'abcd'[answer],explanation_en:explanation});
 const qs=[...f.questions.map((q,i)=>choices(q.id,q.q,[...q.options,'The story does not say this.'],q.answer,q.note)),choices('q4','What does David study?',['Animation.','Medicine.','Music.','Cooking.'],0,'David says that he studies animation.')];
 const body=f.turns.map(t=>({speaker:t.speaker,text:t.speaker+': '+t.text}));
 let n=0;const sentences=f.turns.flatMap((t,i)=>t.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((text,j)=>({n:++n,text:text.trim(),speaker:t.speaker,cn:f.translations[i][j]})));
 const wordpack=Object.entries(f.meanings).map(([w,[pos,cn]])=>({w,pos,cn,...(w.includes(' ')?{phrase:true}:{})}));
 wordpack.push({w:'David',pos:'name',cn:'戴维'},{w:'Yuna',pos:'name',cn:'尤娜'});
 const polysemy=[choices('p1','What does “right” mean in this sentence?',['Correct for the occasion.','The opposite of left.','A legal permission.','Immediately.'],0,'The right day is a suitable day for this visit.'),choices('p2','What does “small things” refer to?',['Little objects that David likes to draw.','Unimportant arguments.','Young children.','A short time.'],0,'David enjoys drawing little objects.')];
 polysemy[0].sentence='Then you came on the right day.';polysemy[1].sentence='I also like drawing small things.';
 const daily={id:'review-daily-01',type:'daily',date:'2026-10-19',title:'A cup with a story.',title_cn:'一只杯子，也有自己的故事（审核节选）',body,word_count:f.turns.map(t=>t.text).join(' ').match(/[A-Za-z]+/g).length,level:'A2',audioKey:'review/cafe',audio_full:'assets/cafe-excerpt.mp3',wordpack,comprehension:qs,polysemy,reused_vocab:f.library.map(v=>v.word),chunks:['Could I get a small latte to go?','Would you like hot milk or cold milk?','You came on the right day.'],discussion_prompts:['You are at a café. Order a drink and ask about today’s activity.']};
 const daily2={...copy(daily),id:'review-daily-02',date:'2026-10-18',title:'When a drawing moves.',title_cn:'画面动起来的那一刻（审核节选）',body:['A drawing can tell a story. When the drawings move, a small change becomes a new idea.'],word_count:19,audioKey:null,audio_full:null,reused_vocab:[],wordpack:[{w:'drawing',pos:'n.',cn:'画'},{w:'story',pos:'n.',cn:'故事'},{w:'move',pos:'v.',cn:'移动'},{w:'change',pos:'n.',cn:'变化'},{w:'idea',pos:'n.',cn:'想法'}],comprehension:[choices('d2q1','What can a drawing do?',['Tell a story.','Make coffee.','Catch a train.','Cook a meal.'],0,'The first sentence says a drawing can tell a story.')],polysemy:[]};
 const month={id:'review-month-now',type:'level_test',date:'2026-10-19',title:'月度水平测试 · 完整流程审核样例',score_scale:{min:0,max:9},sections:{
  listening:{audioKey:'review/cafe',questions:copy(qs.slice(0,2))},
  reading:{body:['David enjoys drawing small things. One morning, he brings his painted cup to a café. The barista notices the cup and tells him about an art game.'],questions:[choices('r1','What does the barista notice?',['The painted cup.','David’s school bag.','A cinema ticket.','A new menu.'],0,'The barista notices David’s painted cup.'),choices('r2','What activity is taking place?',['An art game.','A running race.','A cooking lesson.','A concert.'],0,'The café is hosting an art game.')]},
  speaking:{parts:[{part:1,questions:[{id:'s1',text:'What do you usually do in the morning?'},{id:'s1b',text:'Do you prefer studying at home or in a café? Why?'}]},{part:2,task:{id:'s2',text:'Describe a place where you enjoy spending time.',points:['Where it is','What you usually do there','Who you go there with','Explain why you enjoy this place']}},{part:3,questions:[{id:'s3',text:'Why do some people enjoy visiting the same places regularly?'},{id:'s3b',text:'How can public places help people meet each other?'}]}]},
  writing:{prompt:'Write a message to a friend inviting them to a café. Explain where it is, what you can do there, and when you would like to meet.',word_limit:'审核样例：按题目表达完整信息，不作为正式字数标准。'}
 }};
 const previous={...copy(month),id:'review-month-previous',date:'2026-09-19',title:'已批改测试记录（展示样例，非本人分数）'};
 const reviewArticles=(count)=>Object.fromEntries(Array.from({length:count},(_,i)=>['review-source-'+i,{title:'来源文章样例 '+(i+1),first_seen_at:'2026-10-01'}]));
 const vocab=f.library.map(v=>({id:'review-word-'+v.word,word:v.word,cn:v.cn,pos:v.pos,source:v.source,source_sentence:v.quote,added:'2026-10-01',status:'reviewing',quizzes:1,correct:0,quiz_history:[{quiz_id:'review-quiz-'+v.word,date:'2026-10-01',correct:false,note:'抽查反馈样例：请结合原句理解。'}],review_articles:reviewArticles(v.count)}));
 const records={inputs:[daily,daily2,month,previous,{id:'input_local_01',title:'Mina（隐藏入口的样例）',date:'2020-01-01',body:['Hidden review fixture.']}],sentences:[{id:daily.id,items:sentences},{id:daily2.id,items:[{n:1,text:daily2.body[0],cn:'一幅画可以讲故事。画动起来时，小小变化带来新的想法。'}]}],vocab,shadowing:[],dictation:[],dictation_tasks:[],progress:[{id:'level_test:'+previous.id,kind:'level_test',type:'level_test',inputId:previous.id,date:previous.date,status:'graded',answers:{listening:[],reading:[],speaking:[],writing:{text:'A synthetic response for the result layout.'}},assessment:{scores:{listening:6,speaking:5,reading:7,writing:5},overall_comment:'仅为四项分与总评的排版样例，不代表David的真实成绩。',level:'水平判定展示样例',next_month_advice:'下月建议展示样例：继续在生活场景中练习连续表达。'}},{id:'weekly_reports',weekly_reports:[{week:'审核样例',focus_next_week:'此处保留教练周报；本页不生成真实学习结论。'}]}]};
 const blobs=new Map();let pending=0;
 const readonly=new Set(['inputs','sentences','dictation_tasks']);
 function merge(a,b){const next={...a,...b};for(const k of ['sentence_flags','review_articles'])if(b[k]){next[k]={...(a[k]||{})};for(const [key,v]of Object.entries(b[k])){if(v===null)delete next[k][key];else next[k][key]=v;}}return next;}
 const emit=()=>window.dispatchEvent(new CustomEvent('sync-state'));
 window.Data={
  mode:'review',
  async list(c){if(!records[c])throw Error('未知集合');return copy(records[c]);},
  async patch(c,id,fields){if(readonly.has(c)||!records[c])throw Error('教材只读');const i=records[c].findIndex(r=>r.id===id),prior=i<0?{id}:records[c][i];const next=merge(prior,{...copy(fields),id});if(i<0)records[c].push(next);else records[c][i]=next;pending++;emit();},
  async saveBlob(key,blob,meta){blobs.set(key,{blob,meta});pending++;emit();return {key,mime:meta.mime,size:blob.size};},
  async getBlob(key){return blobs.get(key)?.blob||null;},
  async listBlobs(prefix=''){return [...blobs].filter(([k])=>k.startsWith(prefix)).map(([key,{blob,meta}])=>({key,size:blob.size,mime:meta.mime}));},
  uuid(){return crypto.randomUUID?crypto.randomUUID():'review-'+Date.now()+'-'+Math.random().toString(16).slice(2);},
  async upload(){return {preview:true,conflicts:0};},async download(){return {preview:true};},async conflicts(){return {preview:true,conflicts:[],note:'审核页不连接正式同步服务。'};},async probe(){emit();return true;},
  status(){return {connected:false,pending,busy:false,lastUpload:null,lastDownload:null};},pending:()=>pending,async flush(){},async manual(){}
 };
 window.ReviewData={media:key=>key==='review/cafe'?'assets/cafe-excerpt.mp3':null};
})();
