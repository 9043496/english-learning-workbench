# -*- coding: utf-8 -*-
"""隔离SQLite/HTTP/文件测试；非浏览器、非真机。"""
import copy,http.client,json,math,tempfile,threading,time,unittest
from server import Database,APIError,make_server
from sync_engine import push,pull,save_device_blob
from coach import apply_grades,pending

def package():
 def choices(id):return {'id':id,'q':'Fixture question','options':[{'id':a,'text':a} for a in 'abcd']}
 return {'id':'test-month','type':'level_test','date':'2026-10-18','title':'Isolated level-test fixture','score_scale':{'min':0,'max':9},'sections':{
 'listening':{'audioKey':'fixtures/listen.mp3','questions':[choices('l1')]},
 'reading':{'body':['Fixture only.'],'questions':[choices('r1')]},
 'speaking':{'parts':[{'part':1,'questions':[{'id':'s1','text':'Fixture Part1 question'}]},{'part':2,'task':{'id':'s2','text':'Fixture topic card','points':['Fixture point']}},{'part':3,'questions':[{'id':'s3','text':'Fixture discussion question'}]}]},
 'writing':{'prompt':'Fixture writing task'}}}
def attempt():
 return {'id':'level_test:test-month','kind':'level_test','type':'level_test','inputId':'test-month','status':'submitted','answers':{
 'listening':[{'question_id':'l1','option_id':'b'}],'reading':[{'question_id':'r1','option_id':'c'}],
 'speaking':[{'question_id':'s'+str(i),'part':i,'blobKey':'level-tests/month/s'+str(i)+'.webm','durationSec':3} for i in (1,2,3)],'writing':{'text':'Fixture writing response'}}}
def assessment():
 return {'scores':{'listening':6,'reading':6,'speaking':5,'writing':5},'overall_comment':'Fixture review','level':'Fixture level','next_month_advice':'Fixture advice'}
class Features21Test(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.db=Database(self.temp.name);self.n=0
  self.db.import_bundle({'inputs':[package()]+[{'id':'article-'+str(i),'title':'Article '+str(i),'body':['Try a word. Keep the change.'],'date':'2026-10-18'} for i in range(1,14)]})
 def tearDown(self):self.temp.cleanup()
 def change(self,c,id,data,device='A',at=None):
  self.n+=1
  return push(self.db,{'device_id':device,'changes':[{'collection':c,'id':id,'change_id':str(self.n)+device,'updated_at':at if at is not None else int(time.time()*1000)+1000+self.n,'data':{'id':id,**data}}]})
 def record(self,upload_audio=True):
  r=attempt();self.change('progress',r['id'],r)
  if upload_audio:
   for a in r['answers']['speaking']:save_device_blob(self.db,a['blobKey'],b'fixture recording',{'mime':'audio/webm'},int(time.time()*1000)+2000,'A')
  return r
 def test_F01_type_and_readonly_incremental_import(self):
  p=self.db.get('inputs','test-month');self.assertEqual(p['type'],'level_test')
  with self.assertRaises(APIError):self.db.import_bundle({'inputs':[{**p,'title':'overwrite'}]})
  self.assertEqual(self.db.get('inputs','test-month')['title'],p['title'])
 def test_F02_reject_non_choice_listening_and_reading(self):
  for kind in ('listening','reading'):
   p=package();p['id']='invalid-'+kind;p['sections'][kind]['questions'][0]['options']=[]
   with self.assertRaises(APIError):self.db.import_bundle({'inputs':[p]})
   self.assertIsNone(self.db.get('inputs',p['id']))
 def test_F03_reject_incomplete_or_reordered_speaking(self):
  p=package();p['id']='bad';p['sections']['speaking']['parts'].reverse()
  with self.assertRaises(APIError):self.db.import_bundle({'inputs':[p]})
 def test_F04_incomplete_submission_has_no_partial_record(self):
  r=attempt();r['answers']['speaking'].pop()
  with self.assertRaises(APIError):self.change('progress',r['id'],r)
  self.assertIsNone(self.db.get('progress',r['id']))
 def test_F05_draft_and_submit_never_daily_completion_or_i1(self):
  r=attempt();r['status']='draft';r['answers']={}
  self.change('progress',r['id'],r);self.change('progress',r['id'],attempt())
  p=self.db.get('progress',r['id']);self.assertFalse(p['completed']);self.assertIsNone(p['i1_suggested'])
  with self.assertRaises(APIError):self.change('progress',r['id'],{'kind':'daily'})
 def test_F06_test_audio_uploaded_and_incremental_pull_contains_all(self):
  r=self.record();data=pull(self.db,0);self.assertEqual(len(data['blobs']),3)
  self.assertEqual({x['key'] for x in data['blobs']},{a['blobKey'] for a in r['answers']['speaking']})
  self.assertEqual(self.db.records('shadowing'),[])
 def test_F07_coach_grade_requires_uploaded_audio(self):
  r=self.record(False)
  with self.assertRaises(APIError):apply_grades(self.db,{'updates':[{'collection':'progress','id':r['id'],'grade':{'assessment':assessment()}}]})
  self.assertNotIn('assessment',self.db.get('progress',r['id']))
 def test_F08_coach_scores_and_original_answers_protected(self):
  r=self.record();grade=assessment()
  apply_grades(self.db,{'updates':[{'collection':'progress','id':r['id'],'grade':{'assessment':grade}}]})
  response=self.change('progress',r['id'],{'assessment':{**grade,'level':'forged'},'status':'submitted'})
  saved=self.db.get('progress',r['id']);self.assertEqual(saved['assessment'],grade);self.assertEqual(saved['answers'],r['answers']);self.assertEqual(saved['status'],'graded');self.assertTrue(response['conflicts'])
  edited=copy.deepcopy(r['answers']);edited['writing']['text']='changed'
  with self.assertRaises(APIError):self.change('progress',r['id'],{'answers':edited})
 def test_F09_invalid_scores_and_student_answer_in_grade_rejected(self):
  r=self.record()
  for g in [{'assessment':{**assessment(),'scores':{'listening':1}}},{'assessment':assessment(),'answers':{}},{'assessment':{**assessment(),'scores':{k:10 for k in ('listening','speaking','reading','writing')}}}]:
   with self.assertRaises(APIError):apply_grades(self.db,{'updates':[{'collection':'progress','id':r['id'],'grade':g}]})
 def test_F10_same_article_twice_two_devices_still_one_and_title_verified(self):
  self.change('vocab','word:try',{'word':'try','review_articles':{'article-1':{'title':'forged'}}})
  self.change('vocab','word:try',{'review_articles':{'article-1':{}}},'B')
  v=self.db.get('vocab','word:try');self.assertEqual(v['review_count'],1);self.assertEqual(v['review_articles']['article-1']['title'],'Article 1')
 def test_F11_concurrent_article_union_and_twelve_threshold(self):
  at=int(time.time()*1000)+10000
  self.change('vocab','word:try',{'word':'try','review_articles':{('article-'+str(i)):{} for i in range(1,12)}},at=at)
  self.assertFalse(self.db.get('vocab','word:try')['familiar'])
  self.change('vocab','word:try',{'review_articles':{'article-12':{}}},'B',at=at-100)
  v=self.db.get('vocab','word:try');self.assertEqual(v['review_count'],12);self.assertTrue(v['familiar']);self.assertEqual(v['familiarity_source'],'article_count')
 def test_F12_manual_flag_lww_does_not_change_coach_state(self):
  self.db.save('vocab','word:try',{'id':'word:try','word':'try','status':'mastered','note':'keep'})
  self.change('vocab','word:try',{'manual_known':True});self.assertTrue(self.db.get('vocab','word:try')['familiar'])
  self.change('vocab','word:try',{'manual_known':False});v=self.db.get('vocab','word:try');self.assertFalse(v['manual_known']);self.assertEqual(v['status'],'mastered');self.assertEqual(v['note'],'keep')
 def test_F13_missing_article_wrong_word_and_level_test_do_not_count(self):
  self.change('vocab','word:disorder',{'word':'disorder'})
  for article in ('article-1','missing','test-month'):
   with self.assertRaises(APIError):self.change('vocab','word:disorder',{'review_articles':{article:{}}})
  self.assertEqual(self.db.get('vocab','word:disorder')['review_count'],0)
 def test_F14_phrase_whole_match_no_stemming_and_no_history_delete(self):
  self.change('vocab','phrase',{'word':'keep the change','review_articles':{'article-1':{}}})
  self.change('vocab','phrase',{'review_articles':{},'review_count':99,'familiar':True})
  self.assertEqual(self.db.get('vocab','phrase')['review_count'],1);self.assertFalse(self.db.get('vocab','phrase')['familiar'])
  with self.assertRaises(APIError):self.change('vocab','word:tried',{'word':'tried','review_articles':{'article-1':{}}})
 def test_F15_pending_includes_test(self):
  r=self.record();self.assertTrue(any(p['id']==r['id'] for p in pending(self.db)['progress']))
 def test_F16_http_coach_auth_and_proxy_cannot_get_local_login(self):
  server=make_server(self.temp.name);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  def req(path,auth=False,headers=None):
   h={'Authorization':'Bearer '+server.data.token} if auth else {};h.update(headers or {})
   c=http.client.HTTPConnection('127.0.0.1',server.server_port);c.request('GET',path,headers=h);r=c.getresponse();code=r.status;body=r.read();c.close();return code,body
  try:
   self.assertEqual(req('/api/coach/pending')[0],401);self.assertEqual(req('/api/coach/pending',True)[0],200)
   self.assertEqual(req('/api/status/2.1',True)[0],200)
   self.assertEqual(req('/open-local',headers={'X-Forwarded-For':'100.1.2.3'})[0],403)
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main(verbosity=2)
