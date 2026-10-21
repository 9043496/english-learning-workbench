/* 纯计算规则：不生成教材、不自动判定人工评分。 */
(function(root){
'use strict';
const uniqueUnknown = text => [...new Set(String(text || '').split(/[,，;；\n]/).map(w=>w.trim().toLowerCase()).filter(Boolean))];
function completed(p){return Boolean(p.reading_checked && ['submitted','graded'].includes(p.comprehension?.status) && ['submitted','graded'].includes(p.polysemy?.status) && p.unknown_submitted && p.difficulty_self);}
function selectQuiz(vocab,count=5){
 const last=v=>(v.quiz_history||[]).filter(q=>typeof q.correct==='boolean').map(q=>q.date||'').sort().at(-1)||'';
 const cmp=(a,b)=>String(a||'').localeCompare(String(b||''));
 const tie=(a,b)=>cmp(a.id,b.id);
 const groups=[[],[],[],[]];
 for(const v of vocab){const q=Number(v.quizzes||0),c=Number(v.correct||0);const rank=v.status==='mastered'?3:q===0?0:c/q<.6?1:2;groups[rank].push(v);}
 groups[0].sort((a,b)=>cmp(a.added,b.added)||tie(a,b));
 groups[1].sort((a,b)=>((b.quizzes-b.correct)-(a.quizzes-a.correct))||tie(a,b));
 groups[2].sort((a,b)=>cmp(last(a),last(b))||tie(a,b));groups[3].sort((a,b)=>cmp(last(a),last(b))||tie(a,b));
 return [...groups[0],...groups[1],...groups[2],...groups[3].slice(0,1)].slice(0,count);
}
function isoWeek(date){const d=new Date(String(date).slice(0,10)+'T00:00:00Z');if(!Number.isFinite(+d))return null;d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const year=d.getUTCFullYear(),start=new Date(Date.UTC(year,0,1));return year+'-W'+String(Math.ceil((((d-start)/86400000)+1)/7)).padStart(2,'0');}
function weekly(records){const m=new Map();for(const r of records){const s=r.score||r;if(!['fluency','pronunciation','completeness'].every(k=>Number.isFinite(s[k])&&s[k]>=1&&s[k]<=3))continue;const w=isoWeek(r.date);if(!w)continue;const a=m.get(w)||{week:w,count:0,fluency:0,pronunciation:0,completeness:0};a.count++;for(const k of ['fluency','pronunciation','completeness'])a[k]+=s[k];m.set(w,a);}return [...m.values()].sort((a,b)=>a.week.localeCompare(b.week)).map(a=>{for(const k of ['fluency','pronunciation','completeness'])a[k]/=a.count;a.total=a.fluency+a.pronunciation+a.completeness;return a;});}
const api={uniqueUnknown,completed,selectQuiz,isoWeek,weekly};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LearningLogic=api;
})(typeof window==='undefined'?globalThis:window);
