-- Engineering-only real Supabase PostgreSQL/RLS test. NO Auth sessions or Storage bytes.
-- Temporary auth.users identifiers are uncredentialed fixtures, rolled back with all rows.
-- The deliberate exception rolls back the entire inner block, including every fixture.
-- Do not run against the local formal learning database.
begin;
do $test$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 t bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 cases jsonb:='[]'; out jsonb; first_result jsonb; payload jsonb; item jsonb; row_data jsonb;
 caught boolean; n integer; refs jsonb:='{}'; packs jsonb:='[]'; report jsonb;
begin
 begin
  if exists(select 1 from public.wb_records) or exists(select 1 from auth.users) then
   raise exception 'This test requires the empty isolated verification project';
  end if;
  insert into auth.users(id,email) values
   (a,'db-only-a@workbench-verification.invalid'),
   (b,'db-only-b@workbench-verification.invalid'),
   (c,'db-only-coach@workbench-verification.invalid');
  insert into public.wb_coaches values(c,a);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub',c::text,true);
  out:=public.wb_import(a,'{"inputs":[{"id":"input01","title":"ENGINEERING FIXTURE ONLY","body":["Try a word."]}]}');
  if (out->>'imported')::int<>1 then raise exception 'DB01 import did not persist'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  caught:=false;
  begin perform public.wb_import(a,'{"inputs":[]}'); exception when others then if sqlerrm='WB_COACH_ONLY' then caught:=true;else raise;end if;end;
  if not caught then raise exception 'DB01 learner gained content write';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB01','case','独立教练注入；学习者不能写教材','result','PASS'));

  payload:=jsonb_build_object('device_id','engineering-mac','changes',jsonb_build_array(jsonb_build_object('collection','progress','id','daily','change_id','first','updated_at',t,'data',jsonb_build_object('id','daily','reading_checked',true,'text','new','sentence_flags',jsonb_build_object('1','confused'),'comprehension',jsonb_build_object('status','submitted','total',1,'answers',jsonb_build_array(jsonb_build_object('question_id','fixture','option_id','a')))))));
  first_result:=public.wb_push(a,payload);
  if public.wb_push(a,payload) is distinct from first_result then raise exception 'DB02 receipt not idempotent';end if;
  out:=public.wb_pull(a,0);
  if not exists(select 1 from jsonb_array_elements(out->'records') r where r->>'id'='daily' and r#>'{data,reading_checked}'='true'::jsonb) then raise exception 'DB02 pull lost record';end if;
  if exists(select 1 from jsonb_array_elements(out->'records') r where r->>'collection'='inputs') then raise exception 'DB02 content leaked into learning sync';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB02','case','上传/下载、幂等重试、教材不混入学习同步','result','PASS'));

  out:=public.wb_push(a,jsonb_build_object('device_id','engineering-phone','changes',jsonb_build_array(jsonb_build_object('collection','progress','id','daily','change_id','older','updated_at',t-1,'data',jsonb_build_object('id','daily','reading_checked',false,'text','old')))));
  select data into row_data from public.wb_records where owner_id=a and collection='progress' and id='daily';
  if row_data->'reading_checked'<>'true'::jsonb or row_data->>'text'<>'new' or jsonb_array_length(out->'conflicts')=0 then raise exception 'DB03 merge failed';end if;
  out:=public.wb_push(a,jsonb_build_object('device_id','engineering-phone','changes',jsonb_build_array(jsonb_build_object('collection','progress','id','daily','change_id','unflag','updated_at',t+1,'data',jsonb_build_object('id','daily','sentence_flags',jsonb_build_object('1',null))))));
  select data into row_data from public.wb_records where owner_id=a and collection='progress' and id='daily';
  if row_data->'sentence_flags' ? '1' then raise exception 'DB03 confused cancellation failed';end if;
  if not exists(select 1 from public.wb_sync_log where owner_id=a and record_id='daily') then raise exception 'DB03 missing conflict log';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB03','case','布尔OR、其他字段LWW、没懂取消、冲突日志','result','PASS'));

  perform set_config('request.jwt.claim.sub',c::text,true);
  out:=public.wb_grade(a,'[{"collection":"progress","id":"daily","grade":{"comprehension":{"correct":1,"total":1,"note":"Engineering fixture evidence"},"i1_final":"hit"}}]');
  perform set_config('request.jwt.claim.sub',a::text,true);
  out:=public.wb_push(a,jsonb_build_object('device_id','engineering-phone','changes',jsonb_build_array(jsonb_build_object('collection','progress','id','daily','change_id','erase-grade','updated_at',t+2000,'data',jsonb_build_object('id','daily','comprehension',null,'i1_final','easy')))));
  select data into row_data from public.wb_records where owner_id=a and collection='progress' and id='daily';
  if row_data#>>'{comprehension,correct}'<>'1' or row_data->>'i1_final'<>'hit' or jsonb_array_length(out->'conflicts')=0 then raise exception 'DB04 protected grade overwritten';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB04','case','教练评分保护，整段null不能删除评分','result','PASS'));

  perform set_config('request.jwt.claim.sub',b::text,true);
  select count(*) into n from public.wb_records where owner_id=a;
  if n<>0 then raise exception 'DB05 cross-account RLS leak';end if;
  caught:=false;
  begin perform public.wb_pull(a,0);exception when others then if sqlerrm='WB_FORBIDDEN' then caught:=true;else raise;end if;end;
  if not caught then raise exception 'DB05 owner spoof accepted';end if;
  caught:=false;
  begin insert into public.wb_coaches values(b,a);exception when insufficient_privilege then caught:=true;end;
  if not caught then raise exception 'DB05 self-assigned coach';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB05','case','跨账号RLS隔离、owner冒用和教练自授予被拒绝','result','PASS'));

  perform set_config('request.jwt.claim.sub',c::text,true);
  caught:=false;
  begin perform public.wb_import(a,'{"inputs":[{"id":"input01","body":["overwrite"]}]}');exception when others then if sqlerrm='WB_CONTENT_IMMUTABLE' then caught:=true;else raise;end if;end;
  if not caught then raise exception 'DB06 input01 overwritten';end if;
  for n in 1..12 loop
   packs:=packs||jsonb_build_array(jsonb_build_object('id','review-'||n,'title','Fixture '||n,'body',jsonb_build_array('Try a word.')));
   refs:=refs||jsonb_build_object('review-'||n,'{}'::jsonb);
  end loop;
  perform public.wb_import(a,jsonb_build_object('inputs',packs));
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.wb_push(a,jsonb_build_object('device_id','engineering-mac','changes',jsonb_build_array(jsonb_build_object('collection','vocab','id','vtry','change_id','reviews','updated_at',t,'data',jsonb_build_object('id','vtry','word','try','status','new','manual_known',false,'review_articles',refs)))));
  select data into row_data from public.wb_records where owner_id=a and collection='vocab' and id='vtry';
  if (row_data->>'review_count')::int<>12 or row_data->'familiar'<>'true'::jsonb or row_data->>'status'<>'new' then raise exception 'DB06 familiarity incorrect';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB06','case','原input01不可覆盖；真实文章来源按篇计数，12篇熟识','result','PASS'));

  caught:=false;
  begin perform public.wb_pull(null,0);exception when others then if sqlerrm='WB_FORBIDDEN' then caught:=true;else raise;end if;end;
  if not caught then raise exception 'DB07 null owner accepted';end if;
  perform set_config('request.jwt.claim.sub','',true);
  caught:=false;
  begin perform public.wb_ping(a);exception when others then if sqlerrm='WB_FORBIDDEN' then caught:=true;else raise;end if;end;
  if not caught then raise exception 'DB07 empty identity accepted';end if;
  set local role anon;
  caught:=false;
  begin perform public.wb_pull(a,0);exception when insufficient_privilege then caught:=true;end;
  if not caught then raise exception 'DB07 anon RPC accepted';end if;
  reset role;
  if exists(select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'wb_%' and p.prosecdef) then raise exception 'DB07 public definer exposed';end if;
  cases:=cases||jsonb_build_array(jsonb_build_object('id','DB07','case','空身份、匿名和空owner被拒绝；公开RPC无提权函数','result','PASS'));
  report:=jsonb_build_object('at',clock_timestamp(),'engine',version(),'classification','真实Supabase PostgreSQL；SQL上下文模拟身份；非Auth会话/非Storage字节/非真机','cases',cases,'fixture_rollback',true,'production_data_migrated',false);
  raise sqlstate 'WBTST' using message=report::text;
 exception when sqlstate 'WBTST' then
  -- This handler runs after every fixture and all row changes were rolled back.
  perform set_config('wb.live_report',sqlerrm,true);
 end;
end $test$;
select current_setting('wb.live_report')::jsonb as report,
 (select count(*) from auth.users) as auth_users_after_rollback,
 (select count(*) from public.wb_records) as records_after_rollback;
rollback;
