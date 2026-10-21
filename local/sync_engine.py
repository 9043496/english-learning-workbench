"""显式设备同步；所有时间为 UTC Unix 毫秒，服务端游标单调递增。"""
import copy, hashlib, json, math, time
from server import APIError
LEARNING={'progress','vocab','shadowing','dictation'}
PROTECTED={'assessment','review_count','familiar','familiarity_source','score','fluency','pronunciation','completeness','i1_final','i1_overridden','i1_override_note','graded_at','correct','feedback','note','quiz_history','quizzes','discussion_completed','discussion_note'}
def invalid(message): raise APIError('INVALID',message)
def timestamp(value):
    if type(value) not in (int,float) or not math.isfinite(value) or value<0 or value>time.time()*1000+300000:invalid('同步时间无效或设备时钟超前，请校准时钟。')
    return int(value)
def initialize(conn):
    for table in ('records','blobs'):
        columns={r[1] for r in conn.execute('PRAGMA table_info('+table+')')}
        for column in ('updated_at','write_at'):
            if column not in columns:conn.execute('ALTER TABLE '+table+' ADD COLUMN '+column+' INTEGER NOT NULL DEFAULT 0')
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS sync_clock(value INTEGER NOT NULL);
    INSERT INTO sync_clock SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM sync_clock);
    CREATE TABLE IF NOT EXISTS sync_log(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, device_id TEXT NOT NULL, collection TEXT, record_id TEXT, fields TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_receipts(device_id TEXT, change_id TEXT, result TEXT NOT NULL, PRIMARY KEY(device_id,change_id));
    CREATE TABLE IF NOT EXISTS sync_deleted(collection TEXT,id TEXT,updated_at INTEGER,PRIMARY KEY(collection,id));
    ''')
    for table,identity,changes in [('records','collection=NEW.collection AND id=NEW.id','data'),('blobs','key=NEW.key','filename,mime,size,meta')]:
        for event in ('INSERT','UPDATE OF '+changes):
            name=table+('_sync_insert' if event=='INSERT' else '_sync_update')
            conn.executescript(f'''CREATE TRIGGER IF NOT EXISTS {name} AFTER {event} ON {table} BEGIN
            UPDATE sync_clock SET value=MAX(value+1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
            UPDATE {table} SET updated_at=(SELECT value FROM sync_clock),write_at=(SELECT value FROM sync_clock) WHERE {identity};
            END;''')
    conn.executescript('''CREATE TRIGGER IF NOT EXISTS records_sync_delete AFTER DELETE ON records BEGIN
    UPDATE sync_clock SET value=MAX(value+1,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
    INSERT OR REPLACE INTO sync_deleted VALUES(OLD.collection,OLD.id,(SELECT value FROM sync_clock)); END;
    CREATE TRIGGER IF NOT EXISTS records_sync_undelete AFTER INSERT ON records BEGIN
    DELETE FROM sync_deleted WHERE collection=NEW.collection AND id=NEW.id; END;''')
    # 旧记录进入首次全量下载；不改教材或学习 JSON。
    conn.execute("UPDATE sync_clock SET value=MAX(value,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))")
    for table in ('records','blobs'):
        conn.execute(f'UPDATE {table} SET updated_at=(SELECT value FROM sync_clock),write_at=(SELECT value FROM sync_clock) WHERE updated_at=0')
    conn.commit()
def protected(key, value, old):
    return key in PROTECTED or key=='status' and (old=='graded' or isinstance(value,str) and value in ('graded','mastered','reviewing'))

def contains_grade(value):
    return isinstance(value,dict) and any(k in PROTECTED or k=='status' and v=='graded' or contains_grade(v) for k,v in value.items())

def merge(current,incoming,newer,progress=False,path='',auto_grade=False):
    """逐字段合并；整段替换也不能抹掉教练评分。"""
    result=copy.deepcopy(current); conflicts=[]
    for key,value in incoming.items():
        if key=='id':continue
        field=path+key;old=current.get(key)
        if (protected(key,value,old) or key=='status' and old in ('graded','mastered','reviewing')) and not (auto_grade and key=='status'):
            if value!=old:conflicts.append(field+':coach_preserved')
            continue
        if progress and key=='sentence_flags':
            if not isinstance(value,dict) or any(not isinstance(n,str) or not n or len(n)>100 or n in ('__proto__','constructor','prototype') or v not in ('confused',None) for n,v in value.items()):invalid('句子标记只能为confused或取消值null。')
            flags=copy.deepcopy(old) if isinstance(old,dict) else {}
            for n,v in value.items():
                if newer:
                    if v is None:flags.pop(n,None)
                    else:flags[n]=v
                elif v!=flags.get(n):conflicts.append(field+'.'+n+':server_newer')
            result[key]=flags
        elif isinstance(value,dict):
            child,found=merge(old if isinstance(old,dict) else {},value,newer,progress,field+'.',auto_grade);result[key]=child;conflicts+=found
        elif contains_grade(old):
            if value!=old:conflicts.append(field+':coach_preserved')
        elif progress and (type(value) is bool or type(old) is bool):
            result[key]=(old is True) or (value is True)
            if old is True and value is not True:conflicts.append(field+':boolean_or')
        elif newer:result[key]=copy.deepcopy(value)
        elif value!=old:conflicts.append(field+':server_newer')
    return result,conflicts

def teaching_keys(conn):
    keys=set()
    def visit(value,root):
        if isinstance(value,dict):
            for k,v in value.items():
                if k in ('audio','audio_full','audioKey','audio_blob_key','blobKey') and isinstance(v,str):
                    keys.add(v);keys.add(root+'/'+v)
                visit(v,root)
        elif isinstance(value,list):
            for v in value:visit(v,root)
    for raw, in conn.execute("SELECT data FROM records WHERE collection IN ('inputs','sentences','dictation_tasks')"):
        row=json.loads(raw);visit(row,row['id'])
        if row.get('id'):keys.add(row['id']+'/full.mp3')
    return keys

def blob_keys(conn):
    keys=set()
    for collection,raw in conn.execute("SELECT collection,data FROM records WHERE collection IN ('shadowing','dictation','progress')"):
        row=json.loads(raw)
        if collection=='progress':
            if row.get('kind')=='level_test':
                keys.update(a['blobKey'] for a in row.get('answers',{}).get('speaking',[]) if isinstance(a,dict) and isinstance(a.get('blobKey'),str))
            continue
        if collection=='shadowing':keys.add(row['id'])
        keys.update(row[k] for k in ('audioKey','blobKey','audio_blob_key') if isinstance(row.get(k),str))
    return keys-teaching_keys(conn)

def pull(db,since):
    since=timestamp(since)
    with db.lock,db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        cursor=conn.execute('SELECT value FROM sync_clock').fetchone()[0]
        records=[{'collection':c,'id':id,'data':json.loads(raw),'updated_at':at} for c,id,raw,at in conn.execute('SELECT collection,id,data,updated_at FROM records WHERE updated_at>?',(since,)) if c in LEARNING]
        keys=blob_keys(conn)
        blobs=[{'key':k,'mime':mime,'size':size,'meta':json.loads(meta),'updated_at':at} for k,mime,size,meta,at in conn.execute('SELECT key,mime,size,meta,updated_at FROM blobs WHERE updated_at>?',(since,)) if k in keys]
        deleted=[{'collection':c,'id':id,'updated_at':at} for c,id,at in conn.execute('SELECT collection,id,updated_at FROM sync_deleted WHERE updated_at>?',(since,)) if c in LEARNING]
        return {'cursor':cursor,'records':records,'blobs':blobs,'deleted':deleted}

def push(db,payload):
    if not isinstance(payload,dict) or not isinstance(payload.get('changes'),list) or len(payload['changes'])>500:invalid('请提供不超过500条changes。')
    device=payload.get('device_id')
    if not isinstance(device,str) or not 1<=len(device)<=128:invalid('device_id无效。')
    results=[];conflicts=[]
    with db.lock,db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for change in payload['changes']:
            if not isinstance(change,dict):invalid('变更格式错误。')
            c=change.get('collection');id=change.get('id');cid=change.get('change_id');data=change.get('data');at=timestamp(change.get('updated_at'))
            if not isinstance(c,str) or c not in LEARNING:invalid('教材不参与设备同步。')
            if not isinstance(id,str) or not id or not isinstance(cid,str) or not 1<=len(cid)<=128 or not isinstance(data,dict) or data.get('id')!=id:invalid('变更编号或数据无效。')
            receipt=conn.execute('SELECT result FROM sync_receipts WHERE device_id=? AND change_id=?',(device,cid)).fetchone()
            if receipt:results.append(json.loads(receipt[0]));continue
            old=conn.execute('SELECT data,write_at FROM records WHERE collection=? AND id=?',(c,id)).fetchone()
            tomb=conn.execute('SELECT updated_at FROM sync_deleted WHERE collection=? AND id=?',(c,id)).fetchone()
            if tomb and at<=tomb[0]:
                result={'change_id':cid,'collection':c,'id':id,'data':None,'conflicts':['record:deleted_on_server']}
            else:
                current=json.loads(old[0]) if old else {'id':id}
                from features21 import reconcile_vocab,validate_attempt
                regular={k:v for k,v in data.items() if not (c=='vocab' and k=='review_articles')}
                merged,found=merge(current,regular,not old or at>old[1],c=='progress',auto_grade=c=='dictation')
                if c=='vocab':merged=reconcile_vocab(conn,current,merged,data)
                if c=='progress':
                    if current.get('kind')=='level_test' and merged.get('kind')!='level_test':invalid('不能把测试记录改为日常学习。')
                    validate_attempt(conn,current,merged)
                if not old or merged!=current:
                    conn.execute('INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data',(c,id,json.dumps(merged,ensure_ascii=False)))
                conn.execute('UPDATE records SET write_at=? WHERE collection=? AND id=?',(max(at,old[1] if old else 0),c,id))
                updated=conn.execute('SELECT updated_at FROM records WHERE collection=? AND id=?',(c,id)).fetchone()[0]
                result={'change_id':cid,'collection':c,'id':id,'data':merged,'updated_at':updated,'conflicts':found}
            if result['conflicts']:
                entry={'collection':c,'id':id,'fields':result['conflicts']};conflicts.append(entry)
                conn.execute('INSERT INTO sync_log(at,device_id,collection,record_id,fields) VALUES(?,?,?,?,?)',(int(time.time()*1000),device,c,id,json.dumps(result['conflicts'])))
            conn.execute('INSERT INTO sync_receipts VALUES(?,?,?)',(device,cid,json.dumps(result)))
            results.append(result)
    return {'applied':results,'conflicts':conflicts}

def log(db):
    with db.connect() as conn:
        return [{'id':id,'at':at,'device_id':device,'collection':c,'record_id':rid,'fields':json.loads(fields)} for id,at,device,c,rid,fields in conn.execute('SELECT * FROM sync_log ORDER BY id DESC LIMIT 100')]

def save_device_blob(db,key,content,meta,at,device):
    at=timestamp(at)
    if not isinstance(device,str) or not device or len(device)>128:invalid('device_id无效。')
    with db.lock,db.connect() as conn:
        if key not in blob_keys(conn):invalid('仅允许同步学习记录引用的录音。请先上传跟读/听写记录。')
        old=conn.execute('SELECT write_at,filename FROM blobs WHERE key=?',(key,)).fetchone()
        if old and at<=old[0]:
            existing=(db.blobs/old[1]).read_bytes()
            if at==old[0] and hashlib.sha256(existing).digest()==hashlib.sha256(content).digest():
                return {'key':key,'size':len(content),'conflicts':[]}
            conn.execute('INSERT INTO sync_log(at,device_id,collection,record_id,fields) VALUES(?,?,?,?,?)',(int(time.time()*1000),device,'blobs',key,'["audio:server_newer"]'))
            return {'key':key,'conflicts':['audio:server_newer']}
        result=db.save_blob(key,content,meta)
        conn.execute('UPDATE blobs SET write_at=? WHERE key=?',(at,key))
        return {**result,'conflicts':[]}
