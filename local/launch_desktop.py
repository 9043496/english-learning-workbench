# -*- coding: utf-8 -*-
"""本机入口与Tailscale入口使用同一代码/私有数据库；保留鉴权。"""
from pathlib import Path
import urllib.request,subprocess,sys,time,json,os,signal,ssl
ROOT=Path(__file__).resolve().parents[1]
BUILD='workbench-2.1-phone-20261018.3'
TAILSCALE='/Applications/Tailscale.app/Contents/MacOS/Tailscale'
def health(host,port,secure=False):
 try:
  # Do not inherit external HTTP proxy settings for tailnet connectivity checks.
  handlers=[urllib.request.ProxyHandler({})]
  if secure:handlers.append(urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(ROOT/'.local-data/tls/rootCA.pem'))))
  opener=urllib.request.build_opener(*handlers)
  with opener.open(('%s://%s:%d/health'%('https' if secure else 'http',host,port)),timeout=2) as r:return json.load(r)
 except Exception:return None
def stop_owned(pidfile,port):
 if not pidfile.is_file():return
 try:
  pid=int(pidfile.read_text());p=subprocess.run(['/bin/ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
  command=p.stdout
  if str(ROOT/'local/server.py') not in command or '--port '+str(port) not in command:raise RuntimeError('端口已占用，不能停止不属于工作台的进程。')
  os.kill(pid,signal.SIGTERM)
  for _ in range(30):
   try:os.kill(pid,0)
   except ProcessLookupError:return
   time.sleep(.1)
 except (ValueError,ProcessLookupError):return
def ensure_service(host,port,pidname,logname,secure=False):
 folder=ROOT/'.local-data';folder.mkdir(exist_ok=True)
 current=health(host,port,secure)
 if current and current.get('build')==BUILD:return
 pidfile=folder/pidname
 if current:stop_owned(pidfile,port)
 with (folder/logname).open('ab') as log:
  command=['/usr/bin/python3','-B',str(ROOT/'local/server.py'),'--host',host,'--port',str(port),'--data-dir',str(folder)]
  if secure:command+=['--cert',str(folder/'tls/server.pem'),'--key',str(folder/'tls/server.key')]
  process=subprocess.Popen(command,cwd=str(ROOT),stdout=log,stderr=log,start_new_session=True)
 for _ in range(40):
  value=health(host,port,secure)
  if value and value.get('build')==BUILD:
   pidfile.write_text(str(process.pid));return
  if process.poll() is not None:break
  time.sleep(.15)
 raise RuntimeError('工作台端口%d未能启动；请检查服务日志，勿重置数据库。'%port)
def tailnet_ip():
 if not Path(TAILSCALE).is_file():return None
 try:
  p=subprocess.run([TAILSCALE,'status','--json'],capture_output=True,text=True,timeout=8)
  data=json.loads(p.stdout)
  if data.get('BackendState')=='Running':return next((ip for ip in data.get('TailscaleIPs',[]) if ':' not in ip),None)
 except Exception:pass
 return None
def main():
 ensure_service('127.0.0.1',8780,'desktop2-service.pid','desktop2-service.log')
 ip=tailnet_ip()
 if ip:
  ensure_service(ip,8765,'tailnet-service.pid','tailnet-service.log')
  print('Muse通道已监听：http://%s:8765（API仍需原Bearer鉴权）'%ip)
  try:
   from phone_access import prepare_phone,managed_base
   prepare_phone(ip,ensure_service)
   print('iPhone HTTPS入口：'+(managed_base() or 'https://%s:8766'%ip)+'（需配对）')
  except (RuntimeError,OSError,subprocess.SubprocessError) as e:
   print('手机HTTPS入口未就绪：'+str(e))
 else:print('本机服务已启动；Tailscale未在线，Muse通道暂不可用。')
 if '--no-open' not in sys.argv:
  url='http://127.0.0.1:8780/open-local'
  subprocess.run(['/usr/bin/open','-a','Google Chrome',url] if Path('/Applications/Google Chrome.app').exists() else ['/usr/bin/open',url],check=True)
 print('英语学习工作台：http://127.0.0.1:8780/open-local')
if __name__=='__main__':
 try:main()
 except RuntimeError as e:raise SystemExit(str(e))
