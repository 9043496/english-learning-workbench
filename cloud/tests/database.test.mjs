import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {database,users,change,push,testPack} from './database.mjs';
let d;
const A=users.a,B=users.b,C=users.coach;
const inject=bundle=>d.rpc(C,'wb_import',{p_owner:A,p_bundle:bundle});
const pull=since=>d.rpc(A,'wb_pull',{p_owner:A,p_since:since||0});
const row=async(c,id)=>(await d.as(A,db=>db.query('select data from public.wb_records where collection=$1 and id=$2',[c,id]))).rows[0]?.data;
const grade=updates=>d.rpc(C,'wb_grade',{p_owner:A,p_updates:updates});
before(async()=>{d=await database();await inject({inputs:[{id:'input01',title:'ISOLATED fixture',body:['Try a word. Keep the change.']},testPack()]});});
after(async()=>d?.close());
test('PG01 两设备同一账号读写同一云数据；其他账号与匿名用户不能读取或写入',async()=>{
 await push(d,A,[change('shared',{reading_checked:true,device:'Mac'})]);
 assert.equal((await pull()).records.find(r=>r.id==='shared').data.device,'Mac');
 await push(d,B,[change('shared',{device:'other account'})]);
 assert.equal((await d.as(B,db=>db.query('select * from public.wb_records where owner_id=$1',[A]))).rows.length,0);
 await assert.rejects(d.rpc(B,'wb_push',{p_owner:A,p_payload:{device_id:'bad',changes:[change('shared',{device:'stolen'})]}}),/WB_FORBIDDEN/);
 await assert.rejects(d.as('',db=>db.query('select public.wb_pull($1,0)',[A]),'anon'),/permission denied/);
 assert.equal((await row('progress','shared')).device,'Mac');
});
test('PG02 进度布尔OR、其他字段LWW、句子没懂可取消、冲突留日志',async()=>{
 const t=Date.now()+10000;
 await push(d,A,[change('merge',{reading_checked:true,text:'latest',sentence_flags:{'1':'confused','2':'confused'}},'progress',t)]);
 const result=await push(d,A,[change('merge',{reading_checked:false,text:'stale',sentence_flags:{'1':null}},'progress',t-1)],'iPhone');
 assert.equal(result.conflicts.length,1);let r=await row('progress','merge');assert.equal(r.reading_checked,true);assert.equal(r.text,'latest');assert.equal(r.sentence_flags['1'],'confused');
 await push(d,A,[change('merge',{sentence_flags:{'1':null}},'progress',t+1)]);r=await row('progress','merge');assert.deepEqual(r.sentence_flags,{'2':'confused'});
 await push(d,A,[change('false-first',{reading_checked:false})]);assert.equal((await row('progress','false-first')).reading_checked,false);
 assert.ok((await d.as(A,db=>db.query('select * from public.wb_sync_log where record_id=$1',['merge']))).rows.length);
});
test('PG03 设备不能伪造评分/掌握/测评分；整段null或数组替换也不能抹掉教练评分',async()=>{
 await push(d,A,[change('graded',{comprehension:{status:'submitted',total:1,answers:[{question_id:'q',option_id:'a'}]}})]);
 await grade([{collection:'progress',id:'graded',grade:{comprehension:{correct:1,total:1,note:'Evidence fixture'},i1_final:'hit'}}]);
 for(const replacement of [null,[],{status:'submitted',correct:0,total:1}]){
  const result=await push(d,A,[change('graded',{comprehension:replacement,i1_final:'easy',assessment:{level:'invented'}},'progress',Date.now()+10000)]);
  assert.ok(result.conflicts.length);assert.equal((await row('progress','graded')).comprehension.correct,1);assert.equal((await row('progress','graded')).i1_final,'hit');assert.equal((await row('progress','graded')).assessment,undefined);
 }
 await push(d,A,[change('invented',{status:'graded',score:{fluency:3},note:'fake'})]);assert.equal((await row('progress','invented')).score,undefined);
 await assert.rejects(d.rpc(A,'wb_grade',{p_owner:A,p_updates:[{collection:'progress',id:'graded',grade:{i1_final:'hard'}}]}),/WB_COACH_ONLY/);
});
test('PG04 教材只允许独立教练注入，原input01和相同ID不同内容不能覆盖；整包原子回滚',async()=>{
 await assert.rejects(d.rpc(A,'wb_import',{p_owner:A,p_bundle:{inputs:[{id:'bad'}]}}),/WB_COACH_ONLY/);
 await assert.rejects(inject({inputs:[{id:'should-rollback',body:['Fixture.']},{id:'input01',body:['Replacement.']}]}),/WB_CONTENT_IMMUTABLE/);
 assert.equal(await row('inputs','should-rollback'),undefined);assert.equal((await row('inputs','input01')).title,'ISOLATED fixture');
 await assert.rejects(push(d,A,[change('input01',{title:'wrong'},'inputs')]),/WB_INVALID_CHANGE/);
 await assert.rejects(d.as(A,db=>db.query("update public.wb_records set data=data||'{\"title\":\"bypass\"}'")),/permission denied/);
 assert.equal((await inject({inputs:[{id:'input01',title:'ISOLATED fixture',body:['Try a word. Keep the change.']}]})).imported,0);
});
test('PG05 批量上传幂等，同一change_id重试不重复；无效/超前时间使整批回滚',async()=>{
 const c=change('receipt',{answer:'first'}),payload={device_id:'receipt-device',changes:[c]};
 const first=await d.rpc(A,'wb_push',{p_owner:A,p_payload:payload});
 assert.deepEqual(await d.rpc(A,'wb_push',{p_owner:A,p_payload:payload}),first);
 await assert.rejects(push(d,A,[change('atomic',{ok:true}),change('invalid',{ok:true},'progress',Date.now()+600000)]),/WB_INVALID_TIMESTAMP/);
 assert.equal(await row('progress','atomic'),undefined);
 await assert.rejects(push(d,A,Array.from({length:101},(_,i)=>change('batch'+i,{}))),/WB_INVALID_BATCH/);
});
test('PG06 旧词来源必须为实际文章，按篇去重，12篇熟识独立于教练掌握状态',async()=>{
 const articles=Array.from({length:12},(_,i)=>({id:'review-'+i,title:'Fixture article '+i,body:['Try a word.']}));
 await inject({inputs:articles});
 const refs=Object.fromEntries(articles.map(p=>[p.id,{title:'untrusted title'}]));
 await push(d,A,[change('vtry',{word:'try',status:'new',manual_known:false,review_articles:refs,review_count:100,familiar:true},'vocab')]);
 let r=await row('vocab','vtry');assert.equal(r.review_count,12);assert.equal(r.familiar,true);assert.equal(r.status,'new');assert.equal(r.review_articles['review-0'].title,'Fixture article 0');
 await push(d,A,[change('vtry',{review_articles:refs,manual_known:false},'vocab',Date.now()+10000)]);assert.equal((await row('vocab','vtry')).review_count,12);
 await assert.rejects(push(d,A,[change('not-present',{word:'neverappears',review_articles:{'review-0':{}}},'vocab')]),/WB_INVALID_REVIEW_SOURCE/);
 await assert.rejects(push(d,A,[change('monthly-review',{word:'fixture',review_articles:{'monthly-fixture':{}}},'vocab')]),/WB_INVALID_REVIEW_SOURCE/);
 await grade([{collection:'vocab',id:'vtry',grade:{status:'mastered'}}]);await push(d,A,[change('vtry',{manual_known:true,status:'new'},'vocab',Date.now()+20000)]);r=await row('vocab','vtry');assert.equal(r.status,'mastered');assert.equal(r.manual_known,true);
});
test('PG07 月测听读只接受有效四选一，口语Part1/2/3，未完成不允许提交',async()=>{
 const invalid=testPack();invalid.id='bad-month';invalid.sections.listening.questions[0].options.pop();await assert.rejects(inject({inputs:[invalid]}),/WB_INVALID_QUESTIONS/);
 await assert.rejects(push(d,A,[change('test-invalid',{kind:'level_test',type:'level_test',inputId:'monthly-fixture',status:'submitted',answers:{}})]),/WB_INCOMPLETE_TEST/);
 await assert.rejects(push(d,A,[change('test-wrong-choice',{kind:'level_test',type:'level_test',inputId:'monthly-fixture',status:'draft',answers:{listening:[{question_id:'listen-1',option_id:'wrong'}]}})]),/WB_INVALID_CHOICES/);
 await assert.rejects(push(d,A,[change('test-wrong-pack',{kind:'level_test',type:'level_test',inputId:'input01',status:'draft'})]),/WB_INVALID_TEST/);
});
test('PG08 完整月测独立保存原答案和四项结果；缺录音不允许批改，设备不能覆盖已提交答案',async()=>{
 const answers={listening:[{question_id:'listen-1',option_id:'a'}],reading:[{question_id:'read-1',option_id:'b'}],writing:{text:'Fixture writing response.'},speaking:[1,2,3].map(part=>({part,question_id:'speak-'+part,blobKey:'level-tests/monthly-fixture/'+part+'.webm',durationSec:10}))};
 await push(d,A,[change('level-attempt',{kind:'level_test',type:'level_test',inputId:'monthly-fixture',status:'submitted',completed:true,answers})]);
 let r=await row('progress','level-attempt');assert.equal(r.completed,false);assert.equal(r.i1_suggested,null);
 const assessment={scores:{listening:5,reading:6,speaking:5,writing:5},overall_comment:'Fixture evidence',level:'Fixture level',next_month_advice:'Fixture advice'};
 await assert.rejects(grade([{collection:'progress',id:'level-attempt',grade:{assessment}}]),/WB_MISSING_SPEECH_BLOB/);
 for(const a of answers.speaking){
  const object=A+'/learning/'+Buffer.from(a.blobKey).toString('hex')+'/fixture';
  await d.db.query("insert into storage.objects(bucket_id,name,metadata) values('workbench-audio',$1,$2)",[object,{size:12,mimetype:'audio/webm'}]);
  await d.rpc(A,'wb_finish_blob',{p_owner:A,p_key:a.blobKey,p_path:object,p_size:12,p_mime:'audio/webm',p_meta:{mime:'audio/webm'},p_digest:'a'.repeat(64),p_at:Date.now(),p_device:'phone'});
 }
 await grade([{collection:'progress',id:'level-attempt',grade:{assessment}}]);r=await row('progress','level-attempt');assert.deepEqual(r.answers,answers);assert.equal(r.assessment.scores.reading,6);assert.equal(r.completed,false);
 const edited=structuredClone(answers);edited.writing.text='overwrite';
 await assert.rejects(push(d,A,[change('level-attempt',{answers:edited},'progress',Date.now()+20000)]),/WB_ORIGINAL_ANSWERS/);
 await assert.rejects(grade([{collection:'progress',id:'level-attempt',grade:{assessment:{...assessment,scores:{...assessment.scores,reading:10}}}}]),/WB_INVALID_ASSESSMENT/);
});
test('PG09 录音须先有学习记录引用；真实格式元数据校验、LWW、重复提交与教材音频保护',async()=>{
 await assert.rejects(d.rpc(A,'wb_blob_preflight',{p_owner:A,p_key:'unreferenced',p_content:false,p_size:12}),/WB_BLOB_NOT_LEARNING/);
 await push(d,A,[change('take-1',{blobKey:'shadowing/take-1.webm'},'shadowing')]);
 const key='shadowing/take-1.webm',path=A+'/learning/'+Buffer.from(key).toString('hex')+'/fixture';
 await d.db.query("insert into storage.objects(bucket_id,name,metadata) values('workbench-audio',$1,$2)",[path,{size:12,mimetype:'audio/webm'}]);
 const args={p_owner:A,p_key:key,p_path:path,p_size:12,p_mime:'audio/webm',p_meta:{mime:'audio/webm'},p_digest:'a'.repeat(64),p_at:Date.now()+10000,p_device:'Mac'};
 assert.equal((await d.rpc(A,'wb_finish_blob',args)).mime,'audio/webm');
 assert.equal((await d.rpc(A,'wb_finish_blob',args)).conflicts.length,0);
 assert.deepEqual((await d.rpc(A,'wb_finish_blob',{...args,p_digest:'b'.repeat(64),p_at:args.p_at-1})).conflicts,['audio:server_newer']);
 await assert.rejects(d.rpc(A,'wb_finish_blob',{...args,p_size:13}),/WB_BLOB_NOT_UPLOADED/);
 await assert.rejects(d.rpc(A,'wb_finish_blob',{...args,p_device:null}),/WB_INVALID_BLOB/);
 await push(d,A,[change('attack-audio',{blobKey:'input01/full.mp3'},'shadowing')]);
 await assert.rejects(d.rpc(A,'wb_blob_preflight',{p_owner:A,p_key:'input01/full.mp3',p_content:false,p_size:12}),/WB_BLOB_NOT_LEARNING/);
 const result=await pull();assert.ok(result.blobs.some(b=>b.key===key));assert.ok(!result.records.some(r=>r.collection==='inputs'));
});
test('PG10 私有音频存储RLS：跨账号不可读写、教材仅教练可上传、原对象不能原地覆盖',async()=>{
 const make=(owner,kind)=>({bucket_id:'workbench-audio',name:owner+'/'+kind+'/test/'+crypto.randomUUID(),metadata:{size:12,mimetype:'audio/webm'}});
 const own=make(A,'learning');
 await d.as(A,db=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',Object.values(own)));
 assert.equal((await d.as(B,db=>db.query('select * from storage.objects where name=$1',[own.name]))).rows.length,0);
 await assert.rejects(d.as(B,db=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',Object.values(make(A,'learning')))),/row-level security/);
 await assert.rejects(d.as(A,db=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',Object.values(make(A,'content')))),/row-level security/);
 const result=await d.as(A,db=>db.query("update storage.objects set metadata='{}' where name=$1 returning *",[own.name]));assert.equal(result.rows.length,0);
 const teaching=make(A,'content');await d.as(C,db=>db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',Object.values(teaching)));
});
test('PG11 超过1000条变更不静默截断，增量游标重试不漏数据，教材不混入学习同步',async()=>{
 await d.db.query("insert into public.wb_records select $1::uuid,'progress','bulk-'||g,jsonb_build_object('id','bulk-'||g),wb_private.tick($1::uuid),0 from generate_series(1,1100) g",[A]);
 const first=await pull();assert.ok(first.records.length>1100);assert.ok(!first.records.some(r=>r.collection==='inputs'));
 const empty=await pull(first.cursor);assert.equal(empty.records.length,0);assert.equal(empty.blobs.length,0);
 await push(d,A,[change('after-cursor',{text:'after'})]);const second=await pull(first.cursor);assert.deepEqual(second.records.map(r=>r.id),['after-cursor']);assert.ok(second.cursor>first.cursor);
});
test('PG12 数据库私有助手与底表不可绕过RPC；客户端不能给自己分配教练权限',async()=>{
 await assert.rejects(d.as(A,db=>db.query('select wb_private.tick($1)',[A])),/permission denied/);
 await assert.rejects(d.as(A,db=>db.query('insert into public.wb_coaches values($1,$2)',[A,B])),/permission denied/);
 await assert.rejects(d.rpc(B,'wb_import',{p_owner:A,p_bundle:{inputs:[]}}),/WB_COACH_ONLY/);
 await assert.rejects(push(d,A,[change('invalid-proto',JSON.parse('{"sentence_flags":{"__proto__":"confused"}}'))]),/WB_INVALID_FLAGS/);
 const bad=JSON.parse('{"sentence_flags":{"constructor":"confused"}}');
 await assert.rejects(push(d,A,[change('invalid-flags',bad)]),/WB_INVALID_FLAGS/);
});
test('PG13 空身份/空owner和未提交题目不能越过权限与评分前置条件',async()=>{
 await assert.rejects(d.rpc(A,'wb_pull',{p_owner:null,p_since:0}),/WB_FORBIDDEN/);
 await assert.rejects(d.rpc('','wb_ping',{p_owner:A}),/WB_FORBIDDEN/);
 await push(d,A,[change('unsubmitted',{reading_checked:true})]);
 await assert.rejects(grade([{collection:'progress',id:'unsubmitted',grade:{comprehension:{correct:1,total:1}}}]),/WB_INVALID_GRADE/);
 await push(d,A,[change('draft-month',{kind:'level_test',type:'level_test',inputId:'monthly-fixture',answers:{}})]);
 await assert.rejects(grade([{collection:'progress',id:'draft-month',grade:{assessment:{}}}]),/WB_INVALID_GRADE/);
});
test('PG14 公开RPC全部为invoker，提权实现只在私有schema且仍校验身份与授权',async()=>{
 const f=await d.db.query("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'wb_%'");
 assert.equal(f.rows.length,8);assert.ok(f.rows.every(r=>r.prosecdef===false));
 await assert.rejects(d.as(B,db=>db.query('select wb_private.wb_pull($1,0)',[A])),/WB_FORBIDDEN/);
 await assert.rejects(d.as('',db=>db.query('select wb_private.wb_ping($1)',[A])),/WB_FORBIDDEN/);
 await assert.rejects(d.as('',db=>db.query('select wb_private.wb_ping($1)',[A]),'anon'),/permission denied/);
 assert.equal((await d.as(B,db=>db.query('select wb_private.unreferenced($1) as ok',[A+'/learning/orphan']))).rows[0].ok,false);
 assert.equal((await d.as(C,db=>db.query('select wb_private.unreferenced($1) as ok',[A+'/content/orphan']))).rows[0].ok,true);
});
