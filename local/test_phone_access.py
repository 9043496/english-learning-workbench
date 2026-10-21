# -*- coding: utf-8 -*-
"""隔离证书/HTTPS测试；没有iPhone麦克风或Safari结论。"""
import hashlib,http.client,json,ssl,subprocess,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
import phone_access
from server import make_server
class PhoneAccessTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.tls=self.root/'.local-data/tls';self.tls.mkdir(parents=True)
  self.mock=patch.object(phone_access,'ROOT',self.root);self.mock.start()
 def tearDown(self):self.mock.stop();self.temp.cleanup()
 def crypto(self,*args):
  subprocess.run(['/usr/bin/openssl',*map(str,args)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def seed(self):
  self.crypto('req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Isolated Phone CA','-keyout',self.tls/'rootCA.key','-out',self.tls/'rootCA.pem')
  self.crypto('x509','-in',self.tls/'rootCA.pem','-outform','DER','-out',self.tls/'rootCA.cer')
  self.crypto('req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-keyout',self.tls/'server.key','-out',self.tls/'server.csr')
  (self.tls/'server.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
  self.crypto('x509','-req','-in',self.tls/'server.csr','-CA',self.tls/'rootCA.pem','-CAkey',self.tls/'rootCA.key','-CAcreateserial','-days','2','-extfile',self.tls/'server.ext','-out',self.tls/'server.pem')
 def test_P01_missing_ca_fails_without_new_trust_root(self):
  with self.assertRaises(RuntimeError):phone_access.ensure_certificate('100.64.0.20')
  self.assertFalse((self.tls/'rootCA.key').exists())
 def test_P02_add_tailnet_san_preserves_ca_and_key_and_previous_san(self):
  self.seed();names=['rootCA.pem','rootCA.key','rootCA.cer','server.key']
  before={n:(self.tls/n).read_bytes() for n in names}
  phone_access.ensure_certificate('100.64.0.20')
  self.assertEqual(before,{n:(self.tls/n).read_bytes() for n in names})
  sans=phone_access.decode_cert(self.tls/'server.pem')['subjectAltName']
  self.assertIn(('IP Address','100.64.0.20'),sans);self.assertIn(('IP Address','127.0.0.1'),sans)
  self.assertIn(('DNS','localhost'),sans)
  self.assertEqual(len(list((self.root/'.local-data/recovery').iterdir())),1)
 def test_P03_matching_valid_certificate_not_reissued(self):
  self.seed();before=(self.tls/'server.pem').read_bytes()
  phone_access.ensure_certificate('127.0.0.1')
  self.assertEqual(before,(self.tls/'server.pem').read_bytes())
  self.assertFalse((self.root/'.local-data/recovery').exists())
 def test_P04_https_cookie_pairing_and_remote_local_login_denied(self):
  self.seed();s=make_server(self.root/'isolated-db')
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(self.tls/'server.pem',self.tls/'server.key')
  s.socket=context.wrap_socket(s.socket,server_side=True);s.secure=True
  thread=threading.Thread(target=s.serve_forever,daemon=True);thread.start()
  trust=ssl.create_default_context(cafile=str(self.tls/'rootCA.pem'))
  connection=http.client.HTTPSConnection('127.0.0.1',s.server_port,context=trust,timeout=3)
  try:
   connection.request('GET','/api/records/inputs');r=connection.getresponse();self.assertEqual(r.status,401);r.read()
   connection.request('POST','/api/session',headers={'Authorization':'Bearer '+s.data.token})
   r=connection.getresponse();self.assertEqual(r.status,200);cookie=r.getheader('Set-Cookie');r.read()
   for flag in ('Secure','HttpOnly','SameSite=Strict'):self.assertIn(flag,cookie)
   connection.request('GET','/api/records/inputs',headers={'Cookie':cookie.split(';')[0]})
   r=connection.getresponse();self.assertEqual(r.status,200);self.assertEqual(json.loads(r.read()),[])
   connection.request('GET','/open-local',headers={'X-Forwarded-For':'100.64.0.21'})
   r=connection.getresponse();self.assertEqual(r.status,403);r.read()
  finally:connection.close();s.shutdown();s.server_close();thread.join(timeout=2)
 def test_P05_managed_https_requires_exact_private_proxy(self):
  config={'TCP':{'443':{'HTTPS':True}},'Web':{'isolated.example.ts.net:443':{'Handlers':{'/':{'Proxy':'http://127.0.0.1:8780'}}}}}
  with patch('phone_access.subprocess.run',return_value=SimpleNamespace(stdout=json.dumps(config))):
   self.assertEqual(phone_access.managed_base(),'https://isolated.example.ts.net')
  config['Web']['isolated.example.ts.net:443']['Handlers']['/']['Proxy']='http://127.0.0.1:9999'
  with patch('phone_access.subprocess.run',return_value=SimpleNamespace(stdout=json.dumps(config))):
   self.assertIsNone(phone_access.managed_base())
 def test_P06_public_funnel_cannot_silently_be_used(self):
  with patch('phone_access.subprocess.run',return_value=SimpleNamespace(stdout=json.dumps({'AllowFunnel':{'isolated.example.ts.net:443':True}}))):
   with self.assertRaises(RuntimeError):phone_access.managed_base()
 def test_P07_managed_pairing_uses_domain_and_no_manual_certificate(self):
  (self.root/'.local-data/settings.json').write_text(json.dumps({'token':'isolated-test-token'}))
  with patch('phone_access.managed_base',return_value='https://isolated.example.ts.net'):
   info=phone_access.connection_info('100.64.0.20')
  self.assertEqual(set(info),{'workbench'})
  self.assertEqual(info['workbench'],'https://isolated.example.ts.net/#pair=isolated-test-token')
if __name__=='__main__':unittest.main()
