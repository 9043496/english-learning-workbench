/* 实际正文匹配规则的内容门槛；只检查素材，不写DB或生成学习成绩。 */
const fs=require('node:fs'),path=require('node:path'),R=require('../reading.js');
function check(source){
 const p=source.input,group=source.sentences,errors=[],warnings=[];
 if(!p||!p.id||!p.title)throw Error('输入包缺少id/title');
 if(group?.id!==p.id)errors.push('句子集合id与教材id不一致');
 if(!Array.isArray(p.body)||!p.body.length)errors.push('正文必须保留段落数组');
 if(!Array.isArray(p.wordpack)||!p.wordpack.length)errors.push('缺少全文词包');
 if(!(p.word_count>=250&&p.word_count<=350))errors.push('声明词数不在250–350');
 const units=R.sentences(p,group),seen=new Set();
 for(const u of units){if(seen.has(String(u.n)))errors.push('句号重复:'+u.n);seen.add(String(u.n));if(!u.cn?.trim()||!u.audioKey||!u.speaker)errors.push('句子缺cn/audioKey/speaker:'+u.n);}
 let previous=-1,mapped=0,wordUnits=0,known=0;const missing=[];
 function segment(text,u){for(const x of R.segments(text,p.wordpack,u?.n,[])){if(!x.word)continue;wordUnits++;if(x.entry?.cn?.trim()&&x.entry?.pos?.trim())known++;else missing.push({n:u?.n??null,text:x.text});}}
 for(const b of p.body||[]){const text=typeof b==='string'?b:b.text||'';let cursor=0;
  for(let i=previous+1;i<units.length;i++){const u=units[i],at=text.indexOf(u.text,cursor);if(at<0)continue;
   segment(text.slice(cursor,at),null);segment(u.text,u);cursor=at+u.text.length;previous=i;mapped++;
  }
  segment(text.slice(cursor),null);
 }
 if(mapped!==units.length)errors.push('正文句子映射不完整:'+mapped+'/'+units.length);
 if(missing.length)errors.push('正文可点击词包有缺口:'+missing.length+'处');
 for(const [kind,min,max]of[['comprehension',3,4],['polysemy',2,3]]){
  const qs=p[kind]||[];if(qs.length<min||qs.length>max)errors.push(kind+'题数不合规');
  const ids=new Set();
  for(const q of qs){if(!q.id||ids.has(q.id))errors.push(kind+'题号缺失或重复');ids.add(q.id);
   if(!q.q||q.options?.length!==4||new Set((q.options||[]).map(o=>o.id)).size!==4||!q.options.some(o=>o.id===q.correct_option_id)||!q.explanation_en?.trim())errors.push('选择题字段不完整:'+q.id);
   if(/[\u3400-\u9fff]/u.test([q.q,...(q.options||[]).map(o=>o.text),q.explanation_en].join(' ')))errors.push('选择题含中文:'+q.id);
   if(kind==='polysemy'&&!units.some(u=>u.text===q.sentence))errors.push('多义词题缺真实句子语境:'+q.id);
  }
 }
 if(!Array.isArray(p.chunks)||p.chunks.length<3||p.chunks.length>5)errors.push('chunks必须3–5个');
 else for(const c of p.chunks)if(!units.some(u=>u.text.includes(c.text)))errors.push('chunk未在原文出现:'+c.text);
 if(!p.reused_vocab)warnings.push('当前独立旧词不足3个；不伪造重逢名单或学习历史');
 if(!p.discussion_prompts?.length)errors.push('缺少英文讨论/角色扮演提示');
 return {input_id:p.id,declared_word_count:p.word_count,sentence_count:units.length,mapped_sentences:mapped,clickable_units:wordUnits,covered_units:known,missing,errors,warnings,result:errors.length?'FAIL':'PASS'};
}
module.exports={check};
if(require.main===module){try{const report=check(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(report,null,2));if(report.errors.length)process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
