# -*- coding: utf-8 -*-
"""非浏览器验证：真实SQLite/文件，隔离目录，不触碰用户数据库。"""
import json, sqlite3, tempfile, time, unittest
from pathlib import Path
from server import Database, APIError
from sync_engine import pull, push, log, save_device_blob
from coach import apply_grades

class SyncTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.db=Database(self.tmp.name);self.seq=0
 def tearDown(self):self.tmp.cleanup()
 def change(self,c='progress',id='p',data=None,at=None):
  self.seq+=1;return {'collection':c,'id':id,'data':{'id':id,**(data or {})},'updated_at':int(time.time()*1000)+1000+self.seq if at is None else at,'change_id':str(self.seq)}
 def send(self,*changes):return push(self.db,{'device_id':'test-device','changes':list(changes)})
 def test_S01_migrate_existing_db_without_json_change(self):
  with tempfile.TemporaryDirectory() as d:
   c=sqlite3.connect(str(Path(d)/'workbench.sqlite3'));c.execute('CREATE TABLE records(collection TEXT,id TEXT,data TEXT,PRIMARY KEY(collection,id))');c.execute('INSERT INTO records VALUES(?,?,?)',('progress','p','{"id":"p","reading_checked":true}'));c.commit();c.close()
   db=Database(d);self.assertTrue(pull(db,0)['records'][0]['updated_at']>0);self.assertEqual(db.get('progress','p'),{'id':'p','reading_checked':True})
 def test_S02_incremental_monotonic_cursor_and_coach_writes(self):
  a=pull(self.db,0)['cursor'];self.db.save('progress','p',{'id':'p','difficulty_self':'正好'});b=pull(self.db,a);self.assertEqual(len(b['records']),1)
  self.db.save('progress','p',{'id':'p','difficulty_self':'吃力'});c=pull(self.db,b['cursor']);self.assertEqual(c['records'][0]['data']['difficulty_self'],'吃力');self.assertGreater(c['cursor'],b['cursor']);self.assertEqual(pull(self.db,c['cursor'])['records'],[])
 def test_S03_boolean_or_even_older_device(self):
  self.db.save('progress','p',{'id':'p','reading_checked':True});r=self.send(self.change(data={'reading_checked':False,'unknown_submitted':True},at=1));v=self.db.get('progress','p');self.assertTrue(v['reading_checked']);self.assertTrue(v['unknown_submitted']);self.assertIn('reading_checked:boolean_or',r['applied'][0]['conflicts']);self.send(self.change(data={'reading_checked':None}));self.assertTrue(self.db.get('progress','p')['reading_checked'])
 def test_S04_lww_and_conflict_log(self):
  self.db.save('progress','p',{'id':'p','difficulty_self':'正好'});self.send(self.change(data={'difficulty_self':'旧'},at=1));self.assertEqual(self.db.get('progress','p')['difficulty_self'],'正好');self.assertEqual(log(self.db)[0]['fields'],['difficulty_self:server_newer']);self.send(self.change(data={'difficulty_self':'新'}));self.assertEqual(self.db.get('progress','p')['difficulty_self'],'新')
 def test_S05_coach_scores_preserved_nested_and_scalar(self):
  original={'id':'p','i1_final':'hit','comprehension':{'answers':['old'],'total':1,'correct':1,'status':'graded'}};self.db.save('progress','p',original)
  self.send(self.change(data={'i1_final':'easy','comprehension':None}));self.assertEqual(self.db.get('progress','p'),original)
  self.send(self.change(data={'comprehension':{'answers':['new'],'correct':0,'status':'submitted'}}));r=self.db.get('progress','p');self.assertEqual(r['comprehension']['correct'],1);self.assertEqual(r['comprehension']['status'],'graded');self.assertEqual(r['comprehension']['answers'],['new'])
 def test_S06_no_device_invented_scores_but_dictation_accuracy_allowed(self):
  self.send(self.change('shadowing','r',{'score':{'fluency':3},'fluency':3,'status':'graded'}));self.assertNotIn('score',self.db.get('shadowing','r'))
  self.send(self.change('dictation','d',{'word_accuracy':0.75,'text':'words'}));self.assertEqual(self.db.get('dictation','d')['word_accuracy'],0.75)
 def test_S07_batch_rollback_teaching_rejected(self):
  with self.assertRaises(APIError):self.send(self.change(),self.change('inputs','input01',{'title':'do not overwrite'}))
  self.assertIsNone(self.db.get('progress','p'));self.assertIsNone(self.db.get('inputs','input01'))
 def test_S08_record_retry_idempotent_after_coach_grade(self):
  change=self.change('shadowing','r',{'status':'submitted'});a=self.send(change);apply_grades(self.db,{'updates':[{'collection':'shadowing','id':'r','grade':{'score':{'fluency':1,'pronunciation':2,'completeness':3}}}]});b=self.send(change);self.assertEqual(a,b);self.assertEqual(self.db.get('shadowing','r')['score']['fluency'],1)
 def test_S09_only_learning_recordings_in_pull(self):
  self.db.import_bundle({'inputs':[{'id':'input01','audioKey':'teaching.mp3'}],'sentences':[{'id':'input01','items':[]}],'dictation_tasks':[{'id':'d','audio':'dict.mp3'}]})
  for k in ['teaching.mp3','dict.mp3','r.webm']:self.db.save_blob(k,b'audio',{'mime':'audio/webm'})
  self.db.save('shadowing','r.webm',{'id':'r.webm','audioKey':'teaching.mp3'});r=pull(self.db,0);self.assertEqual({b['key'] for b in r['blobs']},{'r.webm'});self.assertEqual({r['collection'] for r in r['records']},{'shadowing'})
 def test_S10_blob_roundtrip_retry_and_lww(self):
  self.send(self.change('shadowing','r.webm'));at=int(time.time()*1000)+1000;meta={'mime':'audio/webm','inputId':'input01'};raw=b'\x1a\x45\xdf\xa3recording'
  self.assertEqual(save_device_blob(self.db,'r.webm',raw,meta,at,'A')['conflicts'],[]);cursor=pull(self.db,0)['cursor'];self.assertEqual(save_device_blob(self.db,'r.webm',raw,meta,at,'A')['conflicts'],[]);self.assertEqual(pull(self.db,cursor)['blobs'],[])
  self.assertTrue(save_device_blob(self.db,'r.webm',b'older',meta,1,'B')['conflicts']);self.assertEqual(self.db.blob('r.webm')[0],raw);self.assertEqual(log(self.db)[0]['collection'],'blobs')
 def test_S11_teaching_audio_never_overwritten_or_uploaded(self):
  self.db.import_bundle({'inputs':[{'id':'input01','audioKey':'original.mp3'}]});self.db.save_blob('original.mp3',b'original',{'mime':'audio/mpeg'});self.send(self.change('shadowing','original.mp3'))
  with self.assertRaises(APIError):save_device_blob(self.db,'original.mp3',b'replacement',{'mime':'audio/mpeg'},int(time.time()*1000),'A')
  self.assertEqual(self.db.blob('original.mp3')[0],b'original')
  with self.assertRaises(APIError):save_device_blob(self.db,'unreferenced.webm',b'a',{'mime':'audio/webm'},1,'A')
 def test_S12_deleted_record_tombstone_rejects_old_revival(self):
  self.db.save('progress','p',{'id':'p'});cursor=pull(self.db,0)['cursor'];self.db.remove('progress','p');self.assertEqual(pull(self.db,cursor)['deleted'][0]['id'],'p');self.assertIsNone(self.send(self.change(at=1))['applied'][0]['data'])
 def test_S13_clock_and_payload_validation_rollback(self):
  for at in [-1,True,float('nan'),None,int(time.time()*1000)+600000]:
   with self.assertRaises(APIError):self.send(self.change(at=at) if at is not None else {**self.change(),'updated_at':None})
  with self.assertRaises(APIError):pull(self.db,-1)
 def test_S14_grade_changes_visible_in_incremental_download(self):
  self.db.save('shadowing','r',{'id':'r','status':'submitted'});cursor=pull(self.db,0)['cursor'];apply_grades(self.db,{'updates':[{'collection':'shadowing','id':'r','grade':{'score':{'fluency':2,'pronunciation':2,'completeness':3}}}]});r=pull(self.db,cursor);self.assertEqual(r['records'][0]['data']['score']['completeness'],3)

 def test_S15_sentence_flag_cancel_lww_no_revival(self):
  at=int(time.time()*1000)+1000
  self.send(self.change(data={'sentence_flags':{'1':'confused','2':'confused'}},at=at))
  self.send(self.change(data={'sentence_flags':{'1':None}},at=at+1));self.assertEqual(self.db.get('progress','p')['sentence_flags'],{'2':'confused'})
  r=self.send(self.change(data={'sentence_flags':{'1':'confused'}},at=at));self.assertEqual(self.db.get('progress','p')['sentence_flags'],{'2':'confused'});self.assertIn('sentence_flags.1:server_newer',r['applied'][0]['conflicts'])
 def test_S16_invalid_sentence_flags_rollback(self):
  for flags in [None,[],{'1':True},{'1':'guessed'},{'__proto__':'confused'}]:
   with self.assertRaises(APIError):self.send(self.change(data={'sentence_flags':flags}))
  self.assertIsNone(self.db.get('progress','p'))
 def test_S17_confused_only_record_visible_in_coach_pending(self):
  from coach import pending
  self.send(self.change(data={'sentence_flags':{'4':'confused'}}));self.assertEqual(pending(self.db)['progress'][0]['sentence_flags'],{'4':'confused'})

if __name__=='__main__':unittest.main(verbosity=2)
