# -*- coding: utf-8 -*-
"""批改字段保护的本地测试，非浏览器验证。"""
import unittest,tempfile
from server import Database,APIError
from coach import merge_grade,apply_grades
class CoachTest(unittest.TestCase):
 def test_C01_preserve_answers_and_student_fields(self):
  original={'id':'input_local_01','comprehension':{'answers':['My own answer.'],'status':'submitted','total':1},'unknown_words':['kindness'],'difficulty_self':'正好','discussion_answer':'I want to make a film.'}
  next=merge_grade('progress',original,{'comprehension':{'correct':1,'total':1,'note':'意思准确'}})
  self.assertEqual(next['comprehension']['answers'],original['comprehension']['answers']);self.assertEqual(next['unknown_words'],original['unknown_words']);self.assertEqual(next['discussion_answer'],original['discussion_answer']);self.assertEqual(original['comprehension']['status'],'submitted')
 def test_C02_forbid_answer_override(self):
  for grade in [{'unknown_words':[]},{'comprehension':{'answers':['replacement']}},{'discussion_answer':'replacement'}]:
   with self.assertRaises(APIError):merge_grade('progress',{'id':'x'},grade)
 def test_C03_batch_rollback_on_invalid_grade(self):
  with tempfile.TemporaryDirectory() as t:
   d=Database(t);d.save('progress','x',{'id':'x','status':'submitted'})
   with self.assertRaises(APIError):apply_grades(d,{'updates':[{'collection':'progress','id':'x','grade':{'status':'graded'}},{'collection':'progress','id':'x','grade':{'answers':[]}}]})
   self.assertEqual(d.get('progress','x')['status'],'submitted')
 def test_C04_vocab_history_idempotent_preserves_legacy_counts(self):
  old={'id':'word:detail','word':'detail','quizzes':3,'correct':2,'status':'reviewing','quiz_history':[{'date':'2026-10-15','correct':True}]}
  grade={'quiz_history':[{'quiz_id':'quiz:1','date':'2026-10-16','correct':False,'note':'待巩固'}]}
  once=merge_grade('vocab',old,grade);twice=merge_grade('vocab',once,grade)
  self.assertEqual((once['quizzes'],once['correct']),(4,2));self.assertEqual((twice['quizzes'],twice['correct']),(4,2));self.assertEqual(twice['word'],'detail')
 def test_C05_shadowing_rubric_and_metadata(self):
  old={'id':'recording.mp4','durationSec':10,'inputId':'input_local_01','wpm':120}
  next=merge_grade('shadowing',old,{'score':{'fluency':2,'pronunciation':2,'completeness':3,'note':'完整'}})
  self.assertEqual(next['durationSec'],10);self.assertEqual(next['status'],'graded')
  with self.assertRaises(APIError):merge_grade('shadowing',old,{'score':{'fluency':4,'pronunciation':2,'completeness':3}})
 def test_C06_unsubmitted_cannot_be_graded(self):
  with self.assertRaises(APIError):merge_grade('progress',{'id':'x'},{'comprehension':{'correct':1,'total':1}})
if __name__=='__main__':unittest.main(verbosity=2)
