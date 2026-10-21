#!/usr/bin/env python3
"""单用户 Mac 工作台：SQLite JSON 记录 + 文件 Blob。仅使用 Python 标准库。"""
import argparse, base64, hashlib, hmac, io, json, mimetypes, os, re, secrets, sqlite3, ssl, tempfile, threading, zipfile
from pathlib import Path, PurePosixPath
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, unquote, parse_qs, quote

ROOT = Path(__file__).resolve().parents[1]
COLLECTIONS = {'inputs','sentences','vocab','progress','shadowing','dictation','dictation_tasks'}
READONLY = {'inputs','sentences','dictation_tasks'}
STATIC = {'playback-speed.js', 'logic.js', 'progress-example.css', 'reading.js', 'local-store.js', 'workbench.js', 'features21.js', 'features21.css', 'features21-revision.css', 'today-choice.css', 'workbench.css', 'preview.css', 'interaction-example.css', 'store.js', 'index.html', 'vocab-example.css', 'device-sync.js', 'today-practice.css', 'config.js', 'word-pronunciation.js', 'shadowing-example.css'}
MAX_JSON = 8 * 1024 * 1024
MAX_BLOB = 128 * 1024 * 1024
BUILD = 'workbench-2.1-phone-20261018.3'
class APIError(Exception):
    def __init__(self,code,message,status=400): self.code,self.message,self.status=code,message,status

class Database:
    def __init__(self,folder):
        self.folder=Path(folder).resolve(); self.folder.mkdir(parents=True,exist_ok=True); os.chmod(self.folder,0o700)
        self.blobs=self.folder/'blobs'; self.blobs.mkdir(exist_ok=True)
        self.lock=threading.RLock()
        self.db=self.folder/'workbench.sqlite3'
        with self.connect() as c:
            c.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS records(collection TEXT,id TEXT,data TEXT NOT NULL,PRIMARY KEY(collection,id));
            CREATE TABLE IF NOT EXISTS blobs(key TEXT PRIMARY KEY,filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,meta TEXT NOT NULL);''')
        from sync_engine import initialize
        with self.connect() as conn:initialize(conn)
        self.settings=self.folder/'settings.json'
        if not self.settings.exists():self.settings.write_text(json.dumps({'token':secrets.token_urlsafe(32)}));os.chmod(self.settings,0o600)
        self.token=json.loads(self.settings.read_text())['token']
        self.session=hmac.new(self.token.encode(),b'workbench-local-session',hashlib.sha256).hexdigest()
    def connect(self): return sqlite3.connect(self.db,timeout=30)
    def collection(self,c):
        if c not in COLLECTIONS:raise APIError('INVALID','未知数据集合。')
    def records(self,c):
        self.collection(c)
        with self.connect() as db:return [json.loads(row[0]) for row in db.execute('SELECT data FROM records WHERE collection=? ORDER BY id',(c,))]
    def get(self,c,id):
        self.collection(c)
        with self.connect() as db:row=db.execute('SELECT data FROM records WHERE collection=? AND id=?',(c,id)).fetchone()
        return json.loads(row[0]) if row else None
    def save(self,c,id,obj,allow_content=False):
        self.collection(c)
        if c in READONLY and not allow_content:raise APIError('INVALID','教材为只读，请使用内容导入。')
        if not isinstance(obj,dict) or obj.get('id')!=id:raise APIError('INVALID','记录 id 不一致。')
        with self.connect() as db:db.execute('INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data',(c,id,json.dumps(obj,ensure_ascii=False)))
    def remove(self,c,id):
        self.collection(c)
        if c in READONLY:raise APIError('INVALID','教材为只读。')
        with self.connect() as db:
            if db.execute('DELETE FROM records WHERE collection=? AND id=?',(c,id)).rowcount==0:raise APIError('NOT_FOUND','记录不存在。',404)
    def save_blob(self,key,data,meta):
        if not key or len(key)>512 or '\x00' in key or '\\' in key or any(x in ('..','.') for x in key.split('/')) or key.startswith('/'):
            raise APIError('INVALID','音频 key 无效。')
        if not isinstance(meta,dict):raise APIError('INVALID','录音元数据必须是对象。')
        mime=meta.get('mime','')
        if not isinstance(mime,str) or not mime.startswith('audio/'):raise APIError('INVALID','仅接受音频文件。')
        filename=hashlib.sha256(key.encode()).hexdigest()+'.blob'
        with self.lock:
            with tempfile.NamedTemporaryFile(dir=self.blobs,delete=False) as f:
                f.write(data); temp=Path(f.name)
            temp.replace(self.blobs/filename)
            with self.connect() as db:db.execute('INSERT INTO blobs(key,filename,mime,size,meta) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET filename=excluded.filename,mime=excluded.mime,size=excluded.size,meta=excluded.meta',(key,filename,mime,len(data),json.dumps(meta,ensure_ascii=False)))
        return {'key':key,'size':len(data),'mime':mime}
    def blob(self,key):
        with self.connect() as db:row=db.execute('SELECT filename,mime,size FROM blobs WHERE key=?',(key,)).fetchone()
        if not row:return None
        p=self.blobs/row[0]
        if not p.is_file():raise APIError('NOT_FOUND','录音文件缺失，请保留原文件。',404)
        return p.read_bytes(),row[1]
    def list_blobs(self,prefix=''):
        with self.connect() as db:rows=db.execute('SELECT key,size,mime FROM blobs ORDER BY key').fetchall()
        return [dict(key=k,size=n,mime=m) for k,n,m in rows if k.startswith(prefix)]
    def import_bundle(self,bundle):
        # 增量导入，绝不清库。已有同 ID 的不同记录拒绝覆盖，防止丢失学习数据。
        if not isinstance(bundle,dict):raise APIError('INVALID','导入内容必须是集合对象。')
        added=0
        with self.lock,self.connect() as db:
            for collection,rows in bundle.items():
                self.collection(collection)
                if not isinstance(rows,list):raise APIError('INVALID','每个集合必须是记录数组。')
                for row in rows:
                    if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not row['id']:raise APIError('INVALID','每条记录必须带 id。')
                    old=db.execute('SELECT data FROM records WHERE collection=? AND id=?',(collection,row['id'])).fetchone()
                    if old and json.loads(old[0])!=row:raise APIError('INVALID','已有同编号的不同内容，导入取消，原数据未覆盖。')
                    if not old and collection=='inputs':
                        from features21 import validate_input
                        validate_input(row)
                    if not old:db.execute('INSERT INTO records(collection,id,data) VALUES(?,?,?)',(collection,row['id'],json.dumps(row,ensure_ascii=False)));added+=1
        return {'added':added}
    def export_zip(self):
        out=io.BytesIO()
        with self.lock,zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
            z.writestr('collections.json',json.dumps({c:self.records(c) for c in sorted(COLLECTIONS)},ensure_ascii=False,indent=2))
            blobs=self.list_blobs()
            z.writestr('blob-index.json',json.dumps(blobs,ensure_ascii=False,indent=2))
            for i,b in enumerate(blobs):z.writestr(f'blobs/{i:05d}',self.blob(b['key'])[0])
        return out.getvalue()

class Handler(BaseHTTPRequestHandler):
    server_version='LearningWorkbench/1.0'
    def log_message(self,fmt,*args):
        # 不记录请求 URL、配对码、Cookie 或作答。
        pass
    @property
    def data(self):return self.server.data
    def auth(self):
        header=self.headers.get('Authorization','')
        if header.startswith('Bearer ') and hmac.compare_digest(header[7:],self.data.token):return True
        cookies=dict(p.strip().split('=',1) for p in self.headers.get('Cookie','').split(';') if '=' in p)
        return hmac.compare_digest(cookies.get('workbench_session',''),self.data.session)
    def reply(self,status,body=b'',mime='application/json; charset=utf-8',headers=None):
        if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Permissions-Policy','microphone=(self)')
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers()
        if self.command!='HEAD':self.wfile.write(body)
    def read_body(self,limit):
        try:n=int(self.headers.get('Content-Length','0'))
        except ValueError:raise APIError('INVALID','请求长度无效。')
        if n<0 or n>limit:raise APIError('QUOTA','文件超过本地服务允许的大小。',413)
        return self.rfile.read(n)
    def json_body(self):
        try:return json.loads(self.read_body(MAX_JSON))
        except (ValueError,UnicodeDecodeError):raise APIError('INVALID','JSON 格式不正确。')
    def session_cookie(self):
        cookie='workbench_session='+self.data.session+'; Path=/; HttpOnly; SameSite=Strict'
        via_https_proxy=self.client_address[0] in ('127.0.0.1','::1') and self.headers.get('X-Forwarded-Proto','').lower()=='https'
        return cookie+'; Secure' if self.server.secure or via_https_proxy else cookie
    def require_auth(self):
        if not self.auth():raise APIError('INVALID','此设备尚未连接，请从 Mac 提供的连接链接打开。',401)
    def do_HEAD(self):self.do_GET()
    def do_GET(self):self.handle_request('GET')
    def do_PUT(self):self.handle_request('PUT')
    def do_POST(self):self.handle_request('POST')
    def do_DELETE(self):self.handle_request('DELETE')
    def handle_request(self,method):
        try:self.route(method)
        except APIError as e:self.reply(e.status,{'code':e.code,'message':e.message})
        except (BrokenPipeError,ConnectionResetError):pass
        except (sqlite3.Error,OSError):self.reply(503,{'code':'QUOTA','message':'本地数据暂时无法保存，请保留录音并检查 Mac 磁盘空间。'})
        except Exception:self.reply(500,{'code':'INVALID','message':'请求处理失败，请保留当前数据并重试。'})
    def route(self,method):
        path=urlsplit(self.path).path; query=parse_qs(urlsplit(self.path).query)
        if path=='/open-local' and method=='GET':
            if self.client_address[0] not in ('127.0.0.1','::1') or any(self.headers.get(k) for k in ('Forwarded','X-Forwarded-For','X-Forwarded-Host','X-Forwarded-Proto','Tailscale-User-Login')):raise APIError('INVALID','请从Mac本机打开，手机请用设备连接链接。',403)
            return self.reply(302,b'',headers={'Location':'/','Set-Cookie':self.session_cookie()})
        if path=='/health' and method=='GET':return self.reply(200,{'ok':True,'build':BUILD})
        if path=='/local-ca.cer' and method=='GET':
            cert=self.data.folder/'tls'/'rootCA.cer'
            if not cert.exists():raise APIError('NOT_FOUND','本地证书尚未生成。',404)
            return self.reply(200,cert.read_bytes(),'application/x-x509-ca-cert',{'Content-Disposition':'attachment; filename=LearningWorkbench-Local-CA.cer'})
        if path=='/api/session' and method=='POST':
            self.require_auth()
            return self.reply(200,{'ok':True},headers={'Set-Cookie':self.session_cookie()})
        if path.startswith('/api/') or path.startswith('/media/'):
            self.require_auth()
            if path.startswith('/api/sync/'):
                from sync_engine import pull, push, log, save_device_blob
                if path=='/api/sync/pull' and method=='GET':
                    try:since=int(query.get('since',['0'])[0])
                    except ValueError:raise APIError('INVALID','since必须为Unix毫秒。')
                    return self.reply(200,pull(self.data,since))
                if path=='/api/sync/push' and method=='POST':return self.reply(200,push(self.data,self.json_body()))
                if path=='/api/sync/log' and method=='GET':return self.reply(200,log(self.data))
                if path.startswith('/api/sync/blobs/') and method=='PUT':
                    try:
                        meta=json.loads(base64.b64decode(self.headers.get('X-Blob-Meta','e30=')).decode())
                        at=int(self.headers.get('X-Updated-At',''))
                    except (ValueError,UnicodeDecodeError):raise APIError('INVALID','录音元数据或时间无效。')
                    return self.reply(200,save_device_blob(self.data,unquote(path[len('/api/sync/blobs/'):]),self.read_body(MAX_BLOB),meta,at,self.headers.get('X-Device-Id','')))
            if path=='/api/coach/pending' and method=='GET':
                from coach import pending
                return self.reply(200,pending(self.data))
            if path=='/api/coach/grades' and method=='POST':
                from coach import apply_grades
                return self.reply(200,apply_grades(self.data,self.json_body()))
            if path=='/api/status/2.1' and method=='GET':
                return self.reply(200,{'build':BUILD,'level_tests':True,'reencounter':True,'explicit_sync':True,'collections':sorted(COLLECTIONS)})
            if path=='/api/export' and method=='GET':return self.reply(200,self.data.export_zip(),'application/zip',{'Content-Disposition':'attachment; filename=workbench-backup.zip'})
            if path=='/api/import' and method=='POST':return self.reply(200,self.data.import_bundle(self.json_body()))
            if path=='/api/blobs' and method=='GET':return self.reply(200,self.data.list_blobs(query.get('prefix',[''])[0]))
            if path.startswith('/api/blobs/'):
                key=unquote(path[len('/api/blobs/'):])
                if method=='PUT':
                    try:meta=json.loads(base64.b64decode(self.headers.get('X-Blob-Meta','e30=')).decode())
                    except Exception:raise APIError('INVALID','录音元数据无效。')
                    return self.reply(200,self.data.save_blob(key,self.read_body(MAX_BLOB),meta))
                if method=='GET':
                    blob=self.data.blob(key)
                    return self.reply(200,blob[0],blob[1]) if blob else self.reply(404,{'code':'NOT_FOUND','message':'录音不存在。'})
            if path.startswith('/media/') and method=='GET':
                blob=self.data.blob(unquote(path[len('/media/'):]))
                if not blob:raise APIError('NOT_FOUND','音频不存在。',404)
                data,mime=blob;range_header=self.headers.get('Range','')
                if range_header:
                    match=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
                    if not match:return self.reply(416,b'',mime,{'Content-Range':f'bytes */{len(data)}'})
                    a,b=match.groups()
                    if not a and not b:return self.reply(416,b'',mime)
                    start=int(a) if a else max(0,len(data)-int(b));end=min(int(b),len(data)-1) if b and a else len(data)-1
                    if start>end or start>=len(data):return self.reply(416,b'',mime,{'Content-Range':f'bytes */{len(data)}'})
                    return self.reply(206,data[start:end+1],mime,{'Content-Range':f'bytes {start}-{end}/{len(data)}','Accept-Ranges':'bytes'})
                return self.reply(200,data,mime,{'Accept-Ranges':'bytes'})
            if path.startswith('/api/records/'):
                bits=path[len('/api/records/'):].split('/',1);c=unquote(bits[0]);self.data.collection(c)
                if len(bits)==1 and method=='GET':return self.reply(200,self.data.records(c))
                if len(bits)==2:
                    id=unquote(bits[1])
                    if method=='GET':return self.reply(200,self.data.get(c,id))
                    if method=='PUT':self.data.save(c,id,self.json_body());return self.reply(200,None)
                    if method=='DELETE':self.data.remove(c,id);return self.reply(200,None)
            raise APIError('NOT_FOUND','接口不存在。',404)
        if method!='GET':raise APIError('NOT_FOUND','页面不存在。',404)
        name=unquote(path).lstrip('/') or 'index.html'
        if name not in STATIC:raise APIError('NOT_FOUND','页面不存在。',404)
        file=ROOT/name
        if not file.is_file():raise APIError('NOT_FOUND','页面不存在。',404)
        return self.reply(200,file.read_bytes(),mimetypes.guess_type(name)[0] or 'application/octet-stream')

def make_server(folder,host='127.0.0.1',port=0,secure=False):
    s=ThreadingHTTPServer((host,port),Handler);s.daemon_threads=True;s.data=Database(folder);s.secure=secure;return s

def main():
    p=argparse.ArgumentParser(description='英语学习工作台 Mac 本地服务')
    p.add_argument('--data-dir',default=str(ROOT/'.local-data'));p.add_argument('--host',default='127.0.0.1');p.add_argument('--port',type=int,default=8765);p.add_argument('--cert');p.add_argument('--key');p.add_argument('--import-json');p.add_argument('--export-zip')
    args=p.parse_args()
    if args.import_json:
        d=Database(args.data_dir);print(d.import_bundle(json.loads(Path(args.import_json).read_text())));return
    if args.export_zip:
        d=Database(args.data_dir);Path(args.export_zip).write_bytes(d.export_zip());print('备份已导出。');return
    server=make_server(args.data_dir,args.host,args.port,bool(args.cert))
    if args.cert:
        ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.minimum_version=ssl.TLSVersion.TLSv1_2;ctx.load_cert_chain(args.cert,args.key);server.socket=ctx.wrap_socket(server.socket,server_side=True)
    scheme='https' if args.cert else 'http'
    print(f'本地工作台已启动：{scheme}://{args.host}:{server.server_port}（连接信息见 .local-data/连接信息.txt）',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
