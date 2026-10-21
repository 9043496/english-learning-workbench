#!/usr/bin/env python3
"""导入 Muse 导出资料或本工作台备份，不生成教学内容，不重置已有库。"""
import argparse, io, json, mimetypes, zipfile
from pathlib import Path
from server import ROOT, Database, APIError, COLLECTIONS

def import_zip(db,path):
 with zipfile.ZipFile(path) as z:
  if sum(i.file_size for i in z.infolist())>256*1024*1024:raise APIError('QUOTA','导入包超过 256MB，请拆分。')
  bundle=json.loads(z.read('collections.json'))
  index=json.loads(z.read('blob-index.json'))
  staged=[]
  for n,record in enumerate(index):
   data=z.read(f'blobs/{n:05d}')
   if len(data)!=record['size']:raise APIError('INVALID','音频大小与清单不符。')
   old=db.blob(record['key'])
   if old and (old[0]!=data or old[1]!=record['mime']):raise APIError('INVALID','已有同 key 的不同音频，拒绝覆盖。')
   staged.append((record['key'],data,{'mime':record['mime']}))
  # 预检所有记录冲突，不把备份覆盖成当前学习记录。
  for c,rows in bundle.items():
   db.collection(c)
   for row in rows:
    old=db.get(c,row['id'])
    if old and old!=row:raise APIError('INVALID','已有同 ID 的不同记录，拒绝覆盖。')
  for key,data,meta in staged:db.save_blob(key,data,meta)
  result=db.import_bundle(bundle)
 return {**result,'audio_count':len(staged)}

def import_directory(db,folder):
 folder=Path(folder).resolve();bundle={};audio=[]
 content_file=folder/'collections.json'
 if content_file.exists():bundle=json.loads(content_file.read_text())
 else:
  for f in sorted((folder/'inputs').glob('input*.json')):
   row=json.loads(f.read_text());bundle.setdefault('inputs',[]).append(row)
   source=folder/'inputs'/f.stem
   sf=source/'sentences.json'
   if sf.exists():
    sentences=json.loads(sf.read_text());items=sentences if isinstance(sentences,list) else sentences.get('items',sentences.get('sentences',[]))
    bundle.setdefault('sentences',[]).append({'id':row['id'],'items':[{**s,'audioKey':row['id']+'/'+s.get('audio','s%02d.mp3'%s['n'])} for s in items]})
   for f_audio in source.iterdir() if source.exists() else []:
    if f_audio.is_file() and mimetypes.guess_type(f_audio.name)[0] and mimetypes.guess_type(f_audio.name)[0].startswith('audio/'):
     audio.append((row['id']+'/'+f_audio.name,f_audio))
   full=next((a for a in ['audio_full.mp3','full.mp3'] if (source/a).exists()),None)
   if full:row['audioKey']=row['id']+'/'+full
  for collection in ['vocab','dictation_tasks']:
   f=folder/(collection+'.json')
   if f.exists():
    rows=json.loads(f.read_text())
    for r in rows:
     if not r.get('id') and collection=='vocab':
      from urllib.parse import quote
      r['id']='word:'+quote(r['word'].strip().lower(),safe="~()*!.'-")
    bundle[collection]=rows
  f=folder/'progress.json'
  if f.exists():
   legacy=json.loads(f.read_text());bundle.setdefault('progress',[]).extend(legacy.get('inputs',[]));bundle.setdefault('dictation',[]).extend(legacy.get('dictation',[]))
   if legacy.get('weekly_reports'):bundle['progress'].append({'id':'weekly_reports','weekly_reports':legacy['weekly_reports']})
   for score in legacy.get('shadowing_scores',[]):bundle.setdefault('shadowing',[]).append({**score,'id':score['file']})
  for f_audio in (folder/'shadowing').iterdir() if (folder/'shadowing').exists() else []:
   if f_audio.is_file():audio.append((f_audio.name,f_audio))
 for c,rows in bundle.items():
  db.collection(c)
  for row in rows:
   if not row.get('id'):raise APIError('INVALID','导入记录缺少 id。')
   old=db.get(c,row['id'])
   if old and old!=row:raise APIError('INVALID','已有同 ID 的不同记录，拒绝覆盖。')
 for key,file in audio:
  old=db.blob(key)
  if old and old[0]!=file.read_bytes():raise APIError('INVALID','已有同 key 的不同音频，拒绝覆盖。')
 for key,file in audio:db.save_blob(key,file.read_bytes(),{'mime':mimetypes.guess_type(file.name)[0] or 'audio/mp4'})
 result=db.import_bundle(bundle);return {**result,'audio_count':len(audio)}

def main():
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('--data-dir',default=str(ROOT/'.local-data'));args=p.parse_args()
 d=Database(args.data_dir)
 # 自动备份到本机私有目录后再增量导入。
 from datetime import datetime
 backup=d.folder/('before-import-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.zip');backup.write_bytes(d.export_zip())
 try:result=import_zip(d,args.source) if Path(args.source).suffix.lower()=='.zip' else import_directory(d,args.source);print('增量导入结果：',result,'；导入前备份已保存。')
 except (APIError,ValueError,KeyError,zipfile.BadZipFile) as e:print('导入未完成：',getattr(e,'message','文件格式不符合接入说明。'));raise SystemExit(1)
if __name__=='__main__':main()
