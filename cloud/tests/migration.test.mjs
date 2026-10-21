import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,users,push,change} from './database.mjs';
import {migrationSql,validateSnapshot,digest} from '../tools/migration-data.mjs';
const source=()=>({records:[{collection:'inputs',id:'input01',data:{id:'input01',title:"Original '$wb_migration$'; untouched",body:['Try a word.']},updated_at:10,write_at:11},{collection:'progress',id:'input01',data:{id:'input01',reading_checked:true,comprehension:{answers:[{question_id:'old',text:'Original answer'}],correct:1,total:1,note:'Historical grade'}},updated_at:11,write_at:12}],blobs:[]});
test('MG01 原教材/答案/教练评分原样迁入；服务端写入时间；重复迁移不覆盖',async()=>{
 const d=await database();try{
  const s=source();await d.db.exec(migrationSql(s,users.b,users.coach));
  const rows=(await d.db.query('select collection,id,data,updated_at from public.wb_records where owner_id=$1 order by collection,id',[users.b])).rows;
  assert.deepEqual(rows.map(r=>r.data),s.records.map(r=>r.data));assert.ok(rows.every(r=>Number(r.updated_at)>1000));
  await d.db.exec(migrationSql(s,users.b,users.coach));assert.equal((await d.db.query('select count(*)::int n from public.wb_records where owner_id=$1',[users.b])).rows[0].n,2);
  const result=await push(d,users.b,[change('input01',{comprehension:null})]);assert.ok(result.conflicts.length);
 }finally{await d.close();}
});
test('MG02 目标已有不同内容或额外记录，整批中止且原数据保持',async()=>{
 const d=await database();try{
  await push(d,users.b,[change('input01',{reading_checked:false})]);
  await assert.rejects(d.db.exec(migrationSql(source(),users.b,users.coach)),/MIGRATION_RECORD_CONFLICT/);await d.db.exec('rollback');
  assert.equal((await d.db.query("select count(*)::int n from public.wb_records where owner_id=$1 and collection='inputs'",[users.b])).rows[0].n,0);
  await push(d,users.a,[change('extra',{text:'Keep me'})]);
  await assert.rejects(d.db.exec(migrationSql(source(),users.a,users.coach)),/MIGRATION_TARGET_NOT_EMPTY/);await d.db.exec('rollback');
  assert.equal((await d.db.query('select data from public.wb_records where owner_id=$1',[users.a])).rows[0].data.text,'Keep me');
 }finally{await d.close();}
});
test('MG03 缺音频对象/格式不符拒绝入库，全部记录回滚；对象存在后可迁移',async()=>{
 const d=await database();try{
  const s=source(),key='input01/full.mp3',bytes=Buffer.from('audio fixture'),hash=digest(bytes);
  s.blobs.push({key,filename:digest(key)+'.blob',mime:'audio/mpeg',size:bytes.length,meta:{mime:'audio/mpeg'},updated_at:12,write_at:12,path:users.b+'/content/'+Buffer.from(key).toString('hex')+'/'+hash+'-'+crypto.randomUUID(),digest:hash});
  await assert.rejects(d.db.exec(migrationSql(s,users.b,users.coach)),/MIGRATION_AUDIO_NOT_UPLOADED/);await d.db.exec('rollback');
  assert.equal((await d.db.query('select count(*)::int n from public.wb_records where owner_id=$1',[users.b])).rows[0].n,0);
  await d.db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['workbench-audio',s.blobs[0].path,{size:bytes.length,mimetype:'audio/mpeg'}]);
  await d.db.exec(migrationSql(s,users.b,users.coach));assert.equal((await d.db.query('select digest from public.wb_blobs where owner_id=$1',[users.b])).rows[0].digest,hash);
 }finally{await d.close();}
});
test('MG04 拒绝来源重复ID、路径穿越及非法目标身份，不拼接未校验SQL',()=>{
 const s=source();s.records.push(s.records[0]);assert.throws(()=>validateSnapshot(s),/duplicate/);
 assert.throws(()=>migrationSql(source(),"x';drop table public.wb_records;--",users.coach),/identity/);
 const audio={...source(),blobs:[{key:'file',filename:'../../settings.json',mime:'audio/mpeg',size:1,meta:{},updated_at:0,write_at:0}]};assert.throws(()=>validateSnapshot(audio),/audio/);
});
