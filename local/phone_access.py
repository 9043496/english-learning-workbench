# -*- coding: utf-8 -*-
"""iPhone Tailscale HTTPS入口；沿用私有CA，凭证仅存本机私有目录。"""
from pathlib import Path
from datetime import datetime
import argparse,html,ipaddress,json,os,shutil,ssl,subprocess
ROOT=Path(__file__).resolve().parents[1]
def decode_cert(path):
 return ssl._ssl._test_decode_cert(str(path))
def run_crypto(*args):
 p=subprocess.run(['/usr/bin/openssl',*map(str,args)],capture_output=True,text=True)
 if p.returncode:raise RuntimeError('本地HTTPS证书处理失败，原证书和CA保持在私有目录；请检查证书材料。')
def ensure_certificate(host):
 ipaddress.ip_address(host)
 tls=ROOT/'.local-data/tls'
 for name in ('rootCA.pem','rootCA.key','rootCA.cer','server.pem','server.key'):
  if not (tls/name).is_file():raise RuntimeError('缺少既有HTTPS证书材料；未自动建立新的信任根。')
 old=decode_cert(tls/'server.pem')
 if ('IP Address',host) in old.get('subjectAltName',[]) and ssl.cert_time_to_seconds(old['notAfter'])>datetime.now().timestamp()+86400:
  return
 backup=ROOT/'.local-data/recovery'/('phone-certificate-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
 backup.mkdir(parents=True,exist_ok=False);os.chmod(backup,0o700)
 for name in ('server.pem','server.key','server.csr','server.cnf','server.ext'):
  if (tls/name).exists():shutil.copy2(tls/name,backup/name)
 dns=list(dict.fromkeys(['localhost']+[value for kind,value in old.get('subjectAltName',[]) if kind=='DNS']))
 ips=list(dict.fromkeys(['127.0.0.1',host]+[value for kind,value in old.get('subjectAltName',[]) if kind=='IP Address']))
 # Values originate from the already parsed X509 SAN, not free-form shell input.
 config=backup/'new-server.cnf'
 config.write_text('[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=v3_req\n[dn]\nCN='+dns[-1]+'\n[v3_req]\nsubjectAltName=@alt\n[alt]\n'+''.join('DNS.%d=%s\n'%(i+1,value) for i,value in enumerate(dns))+''.join('IP.%d=%s\n'%(i+1,value) for i,value in enumerate(ips)))
 ext=backup/'new-server.ext';ext.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName='+','.join(['DNS:'+value for value in dns]+['IP:'+value for value in ips])+'\n')
 csr=backup/'new-server.csr';cert=backup/'new-server.pem'
 run_crypto('req','-new','-key',tls/'server.key','-out',csr,'-config',config)
 run_crypto('x509','-req','-in',csr,'-CA',tls/'rootCA.pem','-CAkey',tls/'rootCA.key','-set_serial',str(int.from_bytes(os.urandom(16),'big')),'-out',cert,'-days','90','-extfile',ext)
 run_crypto('verify','-CAfile',tls/'rootCA.pem',cert)
 assert ('IP Address',host) in decode_cert(cert).get('subjectAltName',[])
 # Reuse existing server private key and CA. Replace only after chain validation.
 staged=tls/'server.pem.new';shutil.copy2(cert,staged);staged.replace(tls/'server.pem')
def managed_base():
 try:
  cli='/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  result=subprocess.run([cli,'serve','status','--json'],capture_output=True,text=True,timeout=5)
  config=json.loads(result.stdout)
  if any(config.get('AllowFunnel',{}).values()):raise RuntimeError('检测到公网Funnel配置，手机入口需要先核对访问范围。')
  if not config.get('TCP',{}).get('443',{}).get('HTTPS'):return None
  for name,web in config.get('Web',{}).items():
   if name.endswith('.ts.net:443') and web.get('Handlers',{}).get('/',{}).get('Proxy')=='http://127.0.0.1:8780':
    return 'https://'+name[:-4]
 except (OSError,ValueError,subprocess.SubprocessError):pass
 return None
def connection_info(host):
 folder=ROOT/'.local-data'
 token=json.loads((folder/'settings.json').read_text())['token']
 base=managed_base()
 if base:return {'workbench':base+'/#pair='+token}
 return {'certificate':'http://%s:8765/local-ca.cer'%host,'workbench':'https://%s:8766/#pair=%s'%(host,token)}
def prepare_phone(host,ensure_service):
 if not managed_base():
  ensure_certificate(host)
  ensure_service(host,8766,'phone-https-service.pid','phone-https-service.log',secure=True)
 folder=ROOT/'.local-data'
 p=folder/'iPhone连接信息.json';p.write_text(json.dumps(connection_info(host)));os.chmod(p,0o600)
def show_connection(host):
 folder=ROOT/'.local-data';info=connection_info(host)
 swift=ROOT/'local/phone_qr.swift'
 qr_ready=False
 try:
  subprocess.run(['/usr/bin/swift','-module-cache-path',str(folder/'swift-module-cache'),str(swift),str(folder/'iPhone连接信息.json'),str(folder)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45)
  qr_ready=True
 except (OSError,subprocess.SubprocessError):pass
 cards=[]
 for key,title in [('certificate','1. 扫码下载本机证书'),('workbench','扫码打开 2.1 工作台（Safari）')]:
  if key not in info:continue
  cards.append('<section><h2>'+title+'</h2>'+('<img width="300" height="300" src="iphone-'+key+'.png" alt="手机连接二维码">' if qr_ready else '')+'<p><a href="'+html.escape(info[key],quote=True)+'">'+('下载本机证书' if key=='certificate' else 'iPhone 工作台配对入口')+'</a></p></section>')
 instructions='iPhone 保持 Tailscale 已连接，用系统相机扫描下方二维码，选择在 Safari 打开。此入口使用 Tailscale 受信 HTTPS 域名。' if 'certificate' not in info else 'iPhone 打开 Tailscale。先安装并信任 English Learning Workbench Local CA，再用系统相机扫描工作台二维码，用 Safari 打开。'
 page=folder/'iPhone连接.html'
 page.write_text('<!doctype html><meta charset="utf-8"><title>iPhone 工作台连接（私密）</title><style>body{font:17px system-ui;max-width:860px;margin:40px auto;background:#faf8f2;color:#243528}main{display:flex;flex-wrap:wrap;gap:30px}section{flex:1;min-width:320px}img{image-rendering:pixelated;background:white;padding:12px}a{color:#1c6340}</style><h1>iPhone 工作台连接</h1><p>仅供 David 本人配对；工作台二维码含私密连接凭证，请勿公开或转发给 Muse。</p><p>'+instructions+'</p><main>'+''.join(cards)+'</main>')
 os.chmod(page,0o600)
 subprocess.run(['/usr/bin/open',str(page)],check=True)
 print('私密连接页已在Mac打开；凭证未输出到聊天。二维码生成：'+('成功' if qr_ready else '未成功，可用页面中的私密链接接续。'))
def main():
 from launch_desktop import tailnet_ip,ensure_service
 host=tailnet_ip()
 if not host:raise RuntimeError('Mac的Tailscale未在线。')
 prepare_phone(host,ensure_service)
 if '--show' in __import__('sys').argv:show_connection(host)
 print('手机HTTPS入口：'+(managed_base() or 'https://%s:8766'%host)+'；尚未宣称iPhone真机通过。')
if __name__=='__main__':
 try:main()
 except RuntimeError as e:raise SystemExit(str(e))
