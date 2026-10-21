# -*- coding: utf-8 -*-
"""教练读取与人工评分工具：字段级合并，不自动判题，不覆盖学生原文。"""
import argparse, copy, json
from datetime import datetime, timezone
from pathlib import Path
from server import Database, ROOT, APIError

SECTIONS={'comprehension','polysemy'}
TOP={'assessment','status','note','graded_at','i1_final','i1_overridden','i1_override_note','discussion_completed','discussion_note'}
SCORE_FIELDS={'fluency','pronunciation','completeness','note'}
def invalid(message):raise APIError('INVALID',message)
def merge_grade(collection,current,grade):
 if not isinstance(grade,dict):invalid('评分必须为对象。')
 result=copy.deepcopy(current)
 if collection=='progress':
  if current.get('kind')=='level_test':
   from features21 import validate_assessment
   if set(grade)-{'assessment','status','graded_at'} or 'assessment' not in grade:invalid('水平测试批改不得改动学生作答或日常指标。')
   if current.get('status') not in ('submitted','graded'):invalid('测试尚未提交。')
   validate_assessment(grade['assessment'])
   result.update(grade);result['status']='graded';result['graded_at']=grade.get('graded_at') or datetime.now(timezone.utc).isoformat()
   return result
  if 'assessment' in grade:invalid('日常输入不能写入水平测试结果。')
  if set(grade)-TOP-SECTIONS:invalid('评分包含非批改字段，禁止改动学生作答。')
  for key,val in grade.items():
   if key in SECTIONS:
    if not isinstance(val,dict) or set(val)-{'correct','total','note','status','graded_at'}:invalid('题目评分字段无效，不能写入 answers。')
    original=current.get(key)
    if not isinstance(original,dict) or original.get('status') not in ('submitted','graded'):invalid('题目尚未提交，不能评分。')
    total=original.get('total',len(original.get('answers',[])))
    if val.get('total',total)!=total:invalid('不能改动题目总数。')
    correct=val.get('correct',original.get('correct'))
    if type(correct) is not int or not 0<=correct<=total:invalid('正确题数超出范围。')
    result[key]={**original,**val,'total':total,'correct':correct,'status':'graded'}
   else:result[key]=val
  if 'i1_final' in grade and grade['i1_final'] not in ('hit','easy','hard'):invalid('最终难度状态无效。')
 elif collection=='shadowing':
  if set(grade)-{'score','status','graded_at'}:invalid('跟读评分不得修改录音或元数据。')
  score=grade.get('score')
  if not isinstance(score,dict) or set(score)-SCORE_FIELDS:invalid('评分维度无效。')
  for key in ['fluency','pronunciation','completeness']:
   if type(score.get(key)) is not int or not 1<=score[key]<=3:invalid('跟读每项必须为1–3分。')
  result.update(grade);result['status']='graded'
 elif collection=='vocab':
  if set(grade)-{'status','note','graded_at','quiz_history'}:invalid('词汇评分不得改词或来源。')
  if grade.get('status',current.get('status')) not in ('new','reviewing','mastered'):invalid('掌握状态无效。')
  history=copy.deepcopy(current.get('quiz_history',[]))
  existing={h.get('quiz_id') for h in history if h.get('quiz_id')}
  base_judged=[h for h in history if type(h.get('correct')) is bool];added=[]
  for entry in grade.get('quiz_history',[]):
   if not isinstance(entry,dict) or set(entry)-{'quiz_id','date','correct','note'} or type(entry.get('correct')) is not bool or not entry.get('quiz_id'):invalid('抽查判定必须含quiz_id、correct及可选日期/评语。')
   if entry['quiz_id'] not in existing:history.append(entry);added.append(entry);existing.add(entry['quiz_id'])
  result.update({k:v for k,v in grade.items() if k!='quiz_history'});result['quiz_history']=history
  result['quizzes']=max(int(current.get('quizzes',0)),len(base_judged))+len(added);result['correct']=max(int(current.get('correct',0)),sum(h['correct'] for h in base_judged))+sum(h['correct'] for h in added)
 else:invalid('该集合不接受人工评分。')
 result['graded_at']=grade.get('graded_at') or datetime.now(timezone.utc).isoformat()
 return result

def apply_grades(db,payload):
 updates=payload.get('updates') if isinstance(payload,dict) else None
 if not isinstance(updates,list):invalid('请提供updates数组。')
 with db.lock,db.connect() as conn:
  conn.execute('BEGIN IMMEDIATE')
  for update in updates:
   if not isinstance(update,dict) or set(update)!={'collection','id','grade'}:invalid('每次更新只允许collection、id、grade。')
   c,id=update['collection'],update['id'];row=conn.execute('SELECT data FROM records WHERE collection=? AND id=?',(c,id)).fetchone()
   if not row:raise APIError('NOT_FOUND','找不到目标记录，未写入。',404)
   current=json.loads(row[0])
   if c=='progress' and current.get('kind')=='level_test':
    from features21 import can_grade_test
    can_grade_test(conn,current,update['grade'].get('assessment'))
   next=merge_grade(c,current,update['grade']);conn.execute('UPDATE records SET data=? WHERE collection=? AND id=?',(json.dumps(next,ensure_ascii=False),c,id))
 return {'gradedRecords':len(updates)}

def pending(db):
 return {'progress':[p for p in db.records('progress') if bool(p.get('sentence_flags')) or p.get('status')=='submitted' or p.get('discussion_status')=='submitted' and not p.get('discussion_completed') or any(p.get(k,{}).get('status')=='submitted' for k in SECTIONS)],'shadowing':[s for s in db.records('shadowing') if s.get('status')!='graded'],'vocab':db.records('vocab'),'inputs':db.records('inputs')}

def main():
 p=argparse.ArgumentParser();p.add_argument('action',choices=['pending','apply']);p.add_argument('file',nargs='?');p.add_argument('--data-dir',default=str(ROOT/'.local-data'));args=p.parse_args();d=Database(args.data_dir)
 if args.action=='pending':print(json.dumps(pending(d),ensure_ascii=False,indent=2));return
 if not args.file:raise SystemExit('apply需要评分JSON文件。')
 print(json.dumps(apply_grades(d,json.loads(Path(args.file).read_text())),ensure_ascii=False))
if __name__=='__main__':main()
