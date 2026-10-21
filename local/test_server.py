"""真实 HTTP + SQLite + 文件 IO 集成；非浏览器、非真机验证。"""
import http.client, io, json, base64, tempfile, threading, unittest, zipfile
from pathlib import Path
from server import make_server, Database

class BackendTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.server=make_server(self.temp.name)
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
 def request(self,method,path,obj=None,raw=None,auth=True,headers=None):
  body=raw if raw is not None else json.dumps(obj).encode() if obj is not None else None
  h={'Authorization':'Bearer '+self.server.data.token} if auth else {}
  if obj is not None:h['Content-Type']='application/json'
  h.update(headers or {});c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5);c.request(method,path,body,h);r=c.getresponse();status=r.status;hdr=dict(r.getheaders());data=r.read();c.close();return status,hdr,data
 def parsed(self,*args,**kwargs):
  s,h,b=self.request(*args,**kwargs);return s,json.loads(b)
 def save_blob(self,key='input01/full.mp3',data=b'ID3audio'):
  meta=base64.b64encode(json.dumps({'mime':'audio/mpeg','inputId':'input01'}).encode()).decode()
  return self.request('PUT','/api/blobs/'+key,raw=data,headers={'X-Blob-Meta':meta})
 def test_H01_health_and_static(self):
  self.assertEqual(self.parsed('GET','/health',auth=False)[1]['ok'],True)
  for p in ['index.html','config.js','local-store.js','store.js']:
   s,h,b=self.request('GET','/'+p,auth=False);self.assertEqual(s,200);self.assertGreater(len(b),0)
   if p=='config.js':self.assertIn(b'APP_CONFIG',b)
 def test_H01b_retired_ui_not_served(self):
  for p in ['/app.js','/styles.css']:
   self.assertEqual(self.request('GET',p,auth=False)[0],404)
 def test_H02_auth_and_private_files(self):
  self.assertEqual(self.request('GET','/api/records/inputs',auth=False)[0],401)
  for p in ['/local/server.py','/.local-data/settings.json','/../config.toml','/tests/fixture.json']:
   self.assertEqual(self.request('GET',p,auth=False)[0],404)
 def test_H03_session_cookie(self):
  s,h,b=self.request('POST','/api/session');self.assertEqual(s,200);self.assertIn('HttpOnly',h['Set-Cookie']);self.assertIn('SameSite=Strict',h['Set-Cookie'])
 def test_H03b_https_proxy_secure_cookie_and_no_local_login(self):
  s,h,b=self.request('POST','/api/session',headers={'X-Forwarded-Proto':'https'})
  self.assertEqual(s,200);self.assertIn('; Secure',h['Set-Cookie'])
  self.assertEqual(self.request('GET','/open-local',auth=False,headers={'X-Forwarded-Proto':'https'})[0],403)
  self.assertEqual(self.request('POST','/api/session',auth=False,headers={'X-Forwarded-Proto':'https'})[0],401)
 def test_H03c_local_http_cookie_retained(self):
  s,h,b=self.request('POST','/api/session')
  self.assertEqual(s,200);self.assertNotIn('; Secure',h['Set-Cookie'])
 def test_H04_store_contract(self):
  self.assertEqual(self.parsed('GET','/api/records/progress/missing'),(200,None))
  for n in [1,2]:self.assertEqual(self.request('PUT','/api/records/progress/x',{'id':'x','value':n})[0],200)
  self.assertEqual(self.parsed('GET','/api/records/progress')[1],[{'id':'x','value':2}])
  self.assertEqual(self.request('DELETE','/api/records/progress/x')[0],200)
  self.assertEqual(self.parsed('DELETE','/api/records/progress/x')[1]['code'],'NOT_FOUND')
 def test_H05_invalid_and_readonly(self):
  for c in ['inputs','sentences','dictation_tasks']:
   self.assertEqual(self.parsed('PUT','/api/records/'+c+'/x',{'id':'x'})[1]['code'],'INVALID')
  self.assertEqual(self.parsed('PUT','/api/records/progress/x',{'id':'y'})[1]['code'],'INVALID')
  self.assertEqual(self.parsed('GET','/api/records/wrong')[1]['code'],'INVALID')
 def test_H06_blob_roundtrip(self):
  self.assertEqual(self.save_blob()[0],200)
  s,h,b=self.request('GET','/api/blobs/input01%2Ffull.mp3');self.assertEqual(b,b'ID3audio');self.assertEqual(h['Content-Type'],'audio/mpeg')
  self.assertEqual(len(self.parsed('GET','/api/blobs?prefix=input01')[1]),1)
  self.assertEqual(self.request('GET','/api/blobs/missing')[0],404)
 def test_H07_media_ranges(self):
  self.save_blob(data=b'0123456789')
  s,h,b=self.request('GET','/media/input01%2Ffull.mp3',headers={'Range':'bytes=2-5'});self.assertEqual((s,b),(206,b'2345'));self.assertEqual(h['Content-Range'],'bytes 2-5/10')
  self.assertEqual(self.request('GET','/media/input01%2Ffull.mp3',headers={'Range':'bytes=-3'})[2],b'789')
  self.assertEqual(self.request('GET','/media/input01%2Ffull.mp3',headers={'Range':'bytes=100-'})[0],416)
 def test_H08_blob_key_validation(self):
  meta=base64.b64encode(b'{"mime":"audio/mpeg"}').decode()
  for key in ['..%2Fsettings.json','%2Ftmp%2Ffile','x%2F..%2Fy']:
   self.assertEqual(self.request('PUT','/api/blobs/'+key,raw=b'a',headers={'X-Blob-Meta':meta})[0],400)
 def test_H09_database_persists_and_reopens(self):
  self.request('PUT','/api/records/progress/x',{'id':'x','completed':True});self.save_blob()
  reopened=Database(self.temp.name);self.assertEqual(reopened.get('progress','x')['completed'],True);self.assertEqual(reopened.blob('input01/full.mp3')[0],b'ID3audio')
 def test_H10_import_is_incremental_and_transactional(self):
  self.assertEqual(self.parsed('POST','/api/import',{'inputs':[{'id':'input01','title':'original'}]})[1]['added'],1)
  self.assertEqual(self.parsed('POST','/api/import',{'inputs':[{'id':'input01','title':'original'}]})[1]['added'],0)
  s,b=self.parsed('POST','/api/import',{'inputs':[{'id':'new'},{'id':'input01','title':'changed'}]});self.assertEqual(s,400)
  self.assertIsNone(self.server.data.get('inputs','new'));self.assertEqual(self.server.data.get('inputs','input01')['title'],'original')
 def test_H11_backup_contains_content_and_audio_but_no_secrets(self):
  self.request('POST','/api/import',{'inputs':[{'id':'input01','title':'original'}]});self.save_blob()
  s,h,b=self.request('GET','/api/export');self.assertEqual(s,200)
  with zipfile.ZipFile(io.BytesIO(b)) as z:
   self.assertEqual(json.loads(z.read('collections.json'))['inputs'][0]['id'],'input01');self.assertEqual(z.read('blobs/00000'),b'ID3audio');self.assertNotIn('settings.json',z.namelist());self.assertNotIn(self.server.data.token.encode(),b)
 def test_H12_cookie_media_authorization(self):
  self.save_blob();s,h,b=self.request('POST','/api/session');cookie=h['Set-Cookie'].split(';',1)[0]
  self.assertEqual(self.request('GET','/media/input01%2Ffull.mp3',auth=False,headers={'Cookie':cookie})[0],200)
  self.assertEqual(self.request('GET','/media/input01%2Ffull.mp3',auth=False)[0],401)
 def test_H13_malformed_json(self):
  s,b=self.parsed('PUT','/api/records/progress/x',raw=b'{bad');self.assertEqual(s,400);self.assertEqual(b['code'],'INVALID')
 def test_H14_blob_limits(self):
  s,b=self.parsed('PUT','/api/blobs/x',raw=b'a',headers={'X-Blob-Meta':base64.b64encode(b'{"mime":"text/html"}').decode()});self.assertEqual(s,400);self.assertEqual(b['code'],'INVALID')
 def test_H15_backup_restore_into_new_database(self):
  from import_muse import import_zip
  self.request('POST','/api/import',{'inputs':[{'id':'input01','title':'original'}]});self.save_blob()
  archive=Path(self.temp.name)/'backup.zip';archive.write_bytes(self.server.data.export_zip())
  restored=Database(Path(self.temp.name)/'restored');result=import_zip(restored,archive)
  self.assertEqual(result['audio_count'],1);self.assertEqual(restored.get('inputs','input01')['title'],'original');self.assertEqual(restored.blob('input01/full.mp3')[0],b'ID3audio')
 def test_H16_restore_refuses_conflicting_existing_audio(self):
  from import_muse import import_zip
  self.save_blob();archive=Path(self.temp.name)/'backup.zip';archive.write_bytes(self.server.data.export_zip())
  restored=Database(Path(self.temp.name)/'restored');restored.save_blob('input01/full.mp3',b'keep-original',{'mime':'audio/mpeg'})
  with self.assertRaises(Exception):import_zip(restored,archive)
  self.assertEqual(restored.blob('input01/full.mp3')[0],b'keep-original')
 def test_H17_original_spec_directory_import_preserves_ids_and_audio(self):
  from import_muse import import_directory
  base=Path(self.temp.name)/'source';f=base/'inputs'/'input01';f.mkdir(parents=True)
  (base/'inputs'/'input01.json').write_text(json.dumps({'id':'input01','title':'original'}))
  (f/'sentences.json').write_text(json.dumps([{'n':1,'text':'Many people love animated films.','audio':'s01.mp3'}]))
  (f/'full.mp3').write_bytes(b'ID3full');(f/'s01.mp3').write_bytes(b'ID3sentence')
  result=import_directory(self.server.data,base)
  self.assertEqual(result['audio_count'],2);self.assertEqual(self.server.data.get('inputs','input01')['audioKey'],'input01/full.mp3');self.assertEqual(self.server.data.get('sentences','input01')['items'][0]['audioKey'],'input01/s01.mp3')
if __name__=='__main__':unittest.main(verbosity=2)
