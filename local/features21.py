# -*- coding: utf-8 -*-
"""2.1数据校验：测试、评分保护及词在文章中重逢。无教学内容生成。"""
import copy,json,math,re,time,unicodedata
from datetime import datetime,timezone
from server import APIError

def invalid(message):raise APIError('INVALID',message)
def text(value):return isinstance(value,str) and bool(value.strip())
def tokens(value):
 value=unicodedata.normalize('NFKC',str(value)).lower()
 return [''.join(c for c in word if c.isalnum()) for word in re.findall(r"[^\W_]+(?:['’][^\W_]+)*",value,re.UNICODE)]
def appears(word,body):
 source=tokens(' '.join(b if isinstance(b,str) else b.get('text','') for b in body) if isinstance(body,list) else body)
 term=tokens(word)
 return bool(term) and any(source[i:i+len(term)]==term for i in range(len(source)-len(term)+1))
def validate_questions(rows):
 if not isinstance(rows,list) or not rows:invalid('水平测试听力/阅读需要选择题。')
 for q in rows:
  if not isinstance(q,dict) or not text(q.get('id')) or not text(q.get('q')):invalid('测试选择题必须有id和英文题干q。')
  options=q.get('options')
  if not isinstance(options,list) or len(options)!=4 or any(not isinstance(o,dict) or not text(o.get('id')) or not text(o.get('text')) for o in options):invalid('水平测试听力/阅读仅接受四选一选择题。')
  if len({o['id'] for o in options})!=4:invalid('选项id不能重复。')
  if 'correct_option_id' in q and q['correct_option_id'] not in {o['id'] for o in options}:invalid('选择题正确选项无效。')
def speaking_tasks(pack):
 parts=pack.get('sections',{}).get('speaking',{}).get('parts',[])
 result=[]
 for part in parts:
  if part.get('part')==2:
   task=part.get('task')
   if isinstance(task,dict):result.append({**task,'part':2})
  else:result.extend({**q,'part':part.get('part')} for q in part.get('questions',[]))
 return result
def validate_input(pack):
 if pack.get('type')!='level_test':
  reused=pack.get('reused_vocab')
  if reused is not None and (not isinstance(reused,list) or not 3<=len(reused)<=5 or any(not (text(v) or isinstance(v,dict) and (text(v.get('w')) or text(v.get('vocabId')))) for v in reused)):invalid('reused_vocab须为3–5个词或词汇引用。')
  return
 sections=pack.get('sections')
 if not isinstance(sections,dict) or set(sections)!={'listening','speaking','reading','writing'} or any(not isinstance(v,dict) for v in sections.values()):invalid('level_test须包含听说读写四项sections。')
 validate_questions(sections['listening'].get('questions'));validate_questions(sections['reading'].get('questions'))
 if not text(sections['listening'].get('audioKey')):invalid('听力测试须提供真实audioKey。')
 if not sections['reading'].get('body'):invalid('阅读测试须提供正文body。')
 if not text(sections['writing'].get('prompt')):invalid('写作测试须提供prompt。')
 parts=sections['speaking'].get('parts')
 if not isinstance(parts,list) or [p.get('part') if isinstance(p,dict) else None for p in parts]!=[1,2,3]:invalid('口语须依次包含Part1/2/3。')
 for p in parts:
  if p['part']==2:
   if not isinstance(p.get('task'),dict) or not text(p['task'].get('id')) or not text(p['task'].get('text')):invalid('Part2须提供题卡。')
   if p.get('preparation_seconds',60)!=60 or p.get('response_seconds',120)!=120:invalid('本版Part2为准备60秒、陈述最多120秒。')
  elif not isinstance(p.get('questions'),list) or not p['questions'] or any(not isinstance(q,dict) or not text(q.get('id')) or not text(q.get('text')) for q in p['questions']):invalid('Part1/3须提供实际提问。')
 ids=[q['id'] for kind in ('listening','reading') for q in sections[kind]['questions']]+[q['id'] for q in speaking_tasks(pack)]
 if len(set(ids))!=len(ids):invalid('测试包题目id必须全包唯一。')
 scale=pack.get('score_scale')
 if scale is not None and (not isinstance(scale,dict) or any(type(scale.get(k)) not in (int,float) or not math.isfinite(scale[k]) for k in ('min','max')) or scale['min']>=scale['max']):invalid('评分范围无效。')
def validate_attempt(conn,current,record):
 if record.get('kind')!='level_test' and record.get('type')!='level_test':return
 if record.get('kind')!='level_test' or record.get('type')!='level_test':invalid('测试记录必须独立标记kind/type为level_test。')
 row=conn.execute("SELECT data FROM records WHERE collection='inputs' AND id=?",(record.get('inputId'),)).fetchone()
 if not row:invalid('测试包不存在。')
 pack=json.loads(row[0])
 if pack.get('type')!='level_test':invalid('不能把日常输入标为水平测试。')
 answers=record.get('answers',{})
 if not isinstance(answers,dict):invalid('测试作答必须为对象。')
 if current.get('status') in ('submitted','graded') and answers!=current.get('answers',{}):invalid('已提交测试的原作答不能被覆盖。')
 complete=record.get('status') in ('submitted','graded')
 for kind in ('listening','reading'):
  values=answers.get(kind,[])
  if not isinstance(values,list):invalid('听读答案须使用选择题数组。')
  questions={q['id']:q for q in pack['sections'][kind]['questions']};seen=set()
  for a in values:
   if not isinstance(a,dict) or a.get('question_id') not in questions or a.get('option_id') not in {o['id'] for o in questions[a['question_id']]['options']} or a['question_id'] in seen:invalid('听读选择题答案或题号无效。')
   seen.add(a['question_id'])
  if complete and seen!=set(questions):invalid('听读题尚未全部作答。')
 speech=answers.get('speaking',[])
 if not isinstance(speech,list):invalid('口语答案须逐题关联录音。')
 tasks={q['id']:q for q in speaking_tasks(pack)};seen=set()
 for a in speech:
  if not isinstance(a,dict) or a.get('question_id') not in tasks or a.get('part')!=tasks[a['question_id']]['part'] or not text(a.get('blobKey')) or a['question_id'] in seen:invalid('口语题号、part或录音引用无效。')
  if not a['blobKey'].startswith('level-tests/'):invalid('水平测试录音须与日常跟读分开。')
  duration=a.get('durationSec')
  if type(duration) not in (int,float) or not math.isfinite(duration) or duration<=0:invalid('口语录音时长无效。')
  seen.add(a['question_id'])
 if complete and seen!=set(tasks):invalid('口语尚有未回答的问题。')
 writing=answers.get('writing',{})
 if not isinstance(writing,dict):invalid('写作答案须为对象。')
 if complete and not text(writing.get('text')):invalid('请完成写作。')
 record['completed']=False # 测试不伪装成日常输入包完成。
 record['i1_suggested']=None
def reconcile_vocab(conn,current,merged,incoming):
 history=copy.deepcopy(current.get('review_articles') or {})
 if not isinstance(history,dict):history={}
 supplied=incoming.get('review_articles',{})
 if not isinstance(supplied,dict) or len(supplied)>1000:invalid('文章回顾记录须按文章id提供对象。')
 for article_id in supplied:
  if not text(article_id) or article_id in ('__proto__','constructor','prototype'):invalid('回顾文章id无效。')
  if article_id in history:continue
  row=conn.execute("SELECT data FROM records WHERE collection='inputs' AND id=?",(article_id,)).fetchone()
  if not row:invalid('回顾来源文章不存在。')
  pack=json.loads(row[0])
  if pack.get('type')=='level_test':invalid('水平测试不计入日常旧词重逢。')
  if not appears(merged.get('word',''),pack.get('body',[])):invalid('词并未在该文章中出现，不能计数。')
  history[article_id]={'inputId':article_id,'title':pack.get('title',''),'first_seen_at':datetime.now(timezone.utc).isoformat()}
 if type(merged.get('manual_known',False)) is not bool:invalid('手动熟识标记须为布尔值。')
 merged['review_articles']=history;merged['review_count']=len(history)
 merged['familiar']=merged.get('manual_known',False) or len(history)>=12
 merged['familiarity_source']='manual' if merged.get('manual_known') else 'article_count' if len(history)>=12 else None
 return merged
def validate_assessment(assessment,scale=None):
 if not isinstance(assessment,dict) or set(assessment)!={'scores','overall_comment','level','next_month_advice'}:invalid('测试批改须含四项scores、overall_comment、level、next_month_advice。')
 scores=assessment['scores']
 if not isinstance(scores,dict) or set(scores)!={'listening','speaking','reading','writing'}:invalid('必须填写听说读写四项分。')
 for value in scores.values():
  if type(value) not in (int,float) or not math.isfinite(value) or value<0 or scale and not scale['min']<=value<=scale['max']:invalid('测试分数无效或超出Muse下发的分制。')
 if any(not text(assessment.get(k)) for k in ('overall_comment','level','next_month_advice')):invalid('总评、水平判定、下月建议不能为空。')
def can_grade_test(conn,record,assessment):
 validate_attempt(conn,{},record)
 row=conn.execute("SELECT data FROM records WHERE collection='inputs' AND id=?",(record.get('inputId'),)).fetchone()
 if not row:invalid('测试包不存在。')
 pack=json.loads(row[0]);validate_assessment(assessment,pack.get('score_scale'))
 for a in record.get('answers',{}).get('speaking',[]):
  if not conn.execute('SELECT 1 FROM blobs WHERE key=?',(a['blobKey'],)).fetchone():invalid('口语录音尚未上传完整，请等待后再批改。')
