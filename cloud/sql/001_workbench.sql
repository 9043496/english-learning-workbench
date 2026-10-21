-- Free-cloud verification schema. Run in a NEW Supabase Free project only.
-- Authentication/users/storage schemas are supplied by Supabase, never by this migration.
begin;
create table public.wb_records (
 owner_id uuid not null references auth.users(id), collection text not null,
 id text not null check(length(id) between 1 and 200), data jsonb not null,
 updated_at bigint not null default 0, write_at bigint not null default 0,
 primary key(owner_id,collection,id),
 check(collection in ('inputs','sentences','dictation_tasks','progress','vocab','shadowing','dictation')),
 check(jsonb_typeof(data)='object' and data->>'id'=id)
);
create table public.wb_clocks(owner_id uuid primary key references auth.users(id), value bigint not null);
create table public.wb_receipts(owner_id uuid not null, device_id text not null, change_id text not null, result jsonb not null, primary key(owner_id,device_id,change_id));
create table public.wb_sync_log(id bigint generated always as identity primary key, owner_id uuid not null, at bigint not null, device_id text not null, collection text not null, record_id text not null, fields jsonb not null);
create table public.wb_blobs(owner_id uuid not null references auth.users(id), key text not null, path text not null unique, size bigint not null check(size between 1 and 25000000), mime text not null check(mime like 'audio/%'), meta jsonb not null, digest text not null, updated_at bigint not null, write_at bigint not null, primary key(owner_id,key));
-- Only an administrator can assign coaches. There is no client write policy.
create table public.wb_coaches(coach_id uuid not null references auth.users(id), learner_id uuid not null references auth.users(id), primary key(coach_id,learner_id), check(coach_id<>learner_id));
create index wb_records_changed on public.wb_records(owner_id,updated_at);
create index wb_blobs_changed on public.wb_blobs(owner_id,updated_at);
create index wb_coaches_learner on public.wb_coaches(learner_id);
create index wb_sync_log_owner_at on public.wb_sync_log(owner_id,at);
create schema if not exists wb_private;
revoke all on schema wb_private from public,anon,authenticated;

create function wb_private.is_coach(p_owner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.wb_coaches where coach_id=(select auth.uid()) and learner_id=p_owner)
$$;
create function wb_private.require_owner(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_owner is null or auth.uid() is null or (auth.uid()<>p_owner and not wb_private.is_coach(p_owner)) then raise exception 'WB_FORBIDDEN'; end if;
end $$;
create function wb_private.require_coach(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin if auth.uid() is null or not wb_private.is_coach(p_owner) then raise exception 'WB_COACH_ONLY'; end if; end $$;
create function wb_private.lock_owner(p_owner uuid) returns void language sql volatile set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,0))
$$;
create function wb_private.tick(p_owner uuid) returns bigint language plpgsql volatile set search_path='' as $$
declare t bigint;
begin
 insert into public.wb_clocks values(p_owner, floor(extract(epoch from clock_timestamp())*1000)::bigint)
 on conflict(owner_id) do update set value=greatest(public.wb_clocks.value+1,excluded.value) returning value into t;
 return t;
end $$;
create function wb_private.timestamp_ok(t bigint) returns boolean language sql volatile set search_path='' as $$
 select t is not null and t>=0 and t<=floor(extract(epoch from clock_timestamp())*1000)::bigint+300000
$$;
create function wb_private.protected(k text) returns boolean language sql immutable set search_path='' as $$
 select k=any(array['assessment','review_count','familiar','familiarity_source','score','fluency','pronunciation','completeness','i1_final','i1_overridden','i1_override_note','graded_at','correct','feedback','note','quiz_history','quizzes','discussion_completed','discussion_note'])
$$;
create function wb_private.has_grade(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare item record;
begin
 if jsonb_typeof(v)<>'object' then return false; end if;
 for item in select * from jsonb_each(v) loop
  if wb_private.protected(item.key) or (item.key='status' and item.value='"graded"'::jsonb) or wb_private.has_grade(item.value) then return true; end if;
 end loop;return false;
end $$;
create function wb_private.merge_data(cur jsonb, incoming jsonb, newer boolean, progress boolean, prefix text default '') returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb:=cur; conflicts jsonb:='[]'; item record; old jsonb; child jsonb; field text; flag record; flags jsonb;
begin
 for item in select * from jsonb_each(incoming) loop
  if item.key='id' then continue; end if;
  if item.key in ('__proto__','constructor','prototype') then raise exception 'WB_INVALID_FIELD'; end if;
  old:=cur->item.key; field:=prefix||item.key;
  if wb_private.protected(item.key) or (item.key='status' and (old #>> '{}') in ('graded','mastered','reviewing')) or (item.key='status' and (item.value #>> '{}') in ('graded','mastered','reviewing')) then
   if item.value is distinct from old then conflicts:=conflicts||jsonb_build_array(field||':coach_preserved'); end if;
  elsif progress and item.key='sentence_flags' then
   if jsonb_typeof(item.value)<>'object' then raise exception 'WB_INVALID_FLAGS'; end if;
   flags:=case when jsonb_typeof(old)='object' then old else '{}'::jsonb end;
   for flag in select * from jsonb_each(item.value) loop
    if length(flag.key) not between 1 and 100 or flag.key in ('__proto__','constructor','prototype') or flag.value not in ('null'::jsonb,'"confused"'::jsonb) then raise exception 'WB_INVALID_FLAGS'; end if;
    if newer then
     if flag.value='null'::jsonb then flags:=flags-flag.key; else flags:=flags||jsonb_build_object(flag.key,flag.value); end if;
    elsif flag.value is distinct from flags->flag.key then conflicts:=conflicts||jsonb_build_array(field||'.'||flag.key||':server_newer'); end if;
   end loop;
   result:=result||jsonb_build_object(item.key,flags);
  elsif jsonb_typeof(item.value)='object' then
   child:=wb_private.merge_data(case when jsonb_typeof(old)='object' then old else '{}'::jsonb end,item.value,newer,progress,field||'.');
   result:=result||jsonb_build_object(item.key,child->'data'); conflicts:=conflicts||(child->'conflicts');
  elsif wb_private.has_grade(old) then
   if item.value is distinct from old then conflicts:=conflicts||jsonb_build_array(field||':coach_preserved'); end if;
  elsif progress and (jsonb_typeof(old)='boolean' or jsonb_typeof(item.value)='boolean') then
   result:=result||jsonb_build_object(item.key,coalesce(old='true'::jsonb,false) or item.value='true'::jsonb);
   if old='true'::jsonb and item.value<>'true'::jsonb then conflicts:=conflicts||jsonb_build_array(field||':boolean_or'); end if;
  elsif newer then result:=result||jsonb_build_object(item.key,item.value);
  elsif item.value is distinct from old then conflicts:=conflicts||jsonb_build_array(field||':server_newer');
  end if;
 end loop;
 return jsonb_build_object('data',result,'conflicts',conflicts);
end $$;

create function wb_private.body(pack jsonb) returns text language sql immutable set search_path='' as $$
 select case when jsonb_typeof(pack->'body')='array' then
 (select string_agg(case when jsonb_typeof(x)='string' then x#>>'{}' else x->>'text' end,' ') from jsonb_array_elements(pack->'body') x)
 else coalesce(pack->>'body','') end
$$;
create function wb_private.tokens(s text) returns text language sql immutable set search_path='' as $$
 select coalesce(string_agg(replace(replace(m[1],'''',''),'’',''),' '),'') from regexp_matches(lower(s),'([[:alnum:]]+([''’][[:alnum:]]+)*)','g') m
$$;
create function wb_private.reconcile_vocab(p_owner uuid,cur jsonb,merged jsonb,incoming jsonb) returns jsonb language plpgsql set search_path='' as $$
declare history jsonb:=coalesce(cur->'review_articles','{}'); supplied jsonb:=coalesce(incoming->'review_articles','{}'); article text; pack jsonb; term text; n integer; manual boolean;
begin
 if jsonb_typeof(history)<>'object' then history:='{}'; end if;
 if jsonb_typeof(supplied)<>'object' or (select count(*) from jsonb_object_keys(supplied))>1000 then raise exception 'WB_INVALID_REVIEW'; end if;
 if cur ? 'word' and cur->'word' is distinct from merged->'word' then raise exception 'WB_WORD_IDENTITY'; end if;
 term:=wb_private.tokens(coalesce(merged->>'word',''));
 for article in select jsonb_object_keys(supplied) loop
  if history ? article then continue; end if;
  select data into pack from public.wb_records where owner_id=p_owner and collection='inputs' and id=article;
  if pack is null or pack->>'type'='level_test' or term='' or position(' '||term||' ' in ' '||wb_private.tokens(wb_private.body(pack))||' ')=0 then raise exception 'WB_INVALID_REVIEW_SOURCE'; end if;
  history:=history||jsonb_build_object(article,jsonb_build_object('inputId',article,'title',pack->>'title','first_seen_at',clock_timestamp()));
 end loop;
 if merged ? 'manual_known' and jsonb_typeof(merged->'manual_known')<>'boolean' then raise exception 'WB_INVALID_KNOWN'; end if;
 manual:=coalesce((merged->>'manual_known')::boolean,false);n:=(select count(*) from jsonb_object_keys(history));
 return merged||jsonb_build_object('review_articles',history,'review_count',n,'familiar',manual or n>=12,'familiarity_source',case when manual then 'manual' when n>=12 then 'article_count' end);
end $$;

create function wb_private.speech_tasks(pack jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(task),'[]') from (
 select p->'task'||jsonb_build_object('part',2) task from jsonb_array_elements(pack#>'{sections,speaking,parts}') p where p->>'part'='2'
 union all select q||jsonb_build_object('part',(p->>'part')::int) from jsonb_array_elements(pack#>'{sections,speaking,parts}') p cross join lateral jsonb_array_elements(coalesce(p->'questions','[]')) q where p->>'part' in ('1','3')
 ) t
$$;
create function wb_private.validate_attempt(p_owner uuid,cur jsonb,r jsonb) returns jsonb language plpgsql set search_path='' as $$
declare pack jsonb; a jsonb:=coalesce(r->'answers','{}'); kind text; valueset jsonb; q jsonb; task jsonb; item jsonb; seen text[]; complete boolean:=r->>'status' in ('submitted','graded'); tasks jsonb;
begin
 if cur->>'kind'='level_test' and r->>'kind' is distinct from 'level_test' then raise exception 'WB_TEST_IDENTITY'; end if;
 if r->>'kind' is distinct from 'level_test' and r->>'type' is distinct from 'level_test' then return r; end if;
 if r->>'kind' is distinct from 'level_test' or r->>'type' is distinct from 'level_test' then raise exception 'WB_TEST_IDENTITY'; end if;
 select data into pack from public.wb_records where owner_id=p_owner and collection='inputs' and id=r->>'inputId';
 if pack is null or pack->>'type' is distinct from 'level_test' or jsonb_typeof(a)<>'object' then raise exception 'WB_INVALID_TEST'; end if;
 if cur->>'status' in ('submitted','graded') and (a is distinct from cur->'answers' or r->'inputId' is distinct from cur->'inputId') then raise exception 'WB_ORIGINAL_ANSWERS'; end if;
 foreach kind in array array['listening','reading'] loop
  valueset:=coalesce(a->kind,'[]');seen:=array[]::text[];
  if jsonb_typeof(valueset)<>'array' then raise exception 'WB_INVALID_CHOICES'; end if;
  for item in select * from jsonb_array_elements(valueset) loop
   select x into q from jsonb_array_elements(pack#>array['sections',kind,'questions']) x where x->>'id'=item->>'question_id';
   if q is null or item->>'question_id'=any(seen) or not exists(select 1 from jsonb_array_elements(q->'options') o where o->>'id'=item->>'option_id') then raise exception 'WB_INVALID_CHOICES'; end if;
   seen:=array_append(seen,item->>'question_id');
  end loop;
  if complete and cardinality(seen)<>jsonb_array_length(pack#>array['sections',kind,'questions']) then raise exception 'WB_INCOMPLETE_TEST'; end if;
 end loop;
 valueset:=coalesce(a->'speaking','[]');seen:=array[]::text[];tasks:=wb_private.speech_tasks(pack);
 if jsonb_typeof(valueset)<>'array' then raise exception 'WB_INVALID_SPEAKING'; end if;
 for item in select * from jsonb_array_elements(valueset) loop
  select x into task from jsonb_array_elements(tasks) x where x->>'id'=item->>'question_id';
  if task is null or item->'part' is distinct from task->'part' or item->>'question_id'=any(seen) or coalesce(item->>'blobKey','') not like 'level-tests/%' or jsonb_typeof(item->'durationSec') is distinct from 'number' or (item->>'durationSec')::numeric<=0 then raise exception 'WB_INVALID_SPEAKING'; end if;
  seen:=array_append(seen,item->>'question_id');
 end loop;
 if complete and (cardinality(seen)<>jsonb_array_length(tasks) or length(trim(coalesce(a#>>'{writing,text}','')))=0) then raise exception 'WB_INCOMPLETE_TEST'; end if;
 return r||'{"completed":false,"i1_suggested":null}'::jsonb;
end $$;

create function wb_private.wb_push(p_owner uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare item jsonb; c text; rid text; cid text; at bigint; old public.wb_records; merged jsonb; result jsonb; results jsonb:='[]'; conflicts jsonb:='[]'; device text:=p_payload->>'device_id'; stamp bigint;
begin
 perform wb_private.require_owner(p_owner);perform wb_private.lock_owner(p_owner);
 if jsonb_typeof(p_payload->'changes') is distinct from 'array' or jsonb_array_length(p_payload->'changes')>100 or length(device) not between 1 and 128 or device is null then raise exception 'WB_INVALID_BATCH'; end if;
 for item in select * from jsonb_array_elements(p_payload->'changes') loop
  c:=item->>'collection';rid:=item->>'id';cid:=item->>'change_id';
  if c is null or c not in ('progress','vocab','shadowing','dictation') or length(rid) not between 1 and 200 or rid is null or length(cid) not between 1 and 128 or cid is null or jsonb_typeof(item->'data') is distinct from 'object' or (item#>>'{data,id}') is distinct from rid or jsonb_typeof(item->'updated_at') is distinct from 'number' then raise exception 'WB_INVALID_CHANGE'; end if;
  at:=(item->>'updated_at')::bigint;if not wb_private.timestamp_ok(at) or octet_length((item->'data')::text)>2000000 then raise exception 'WB_INVALID_TIMESTAMP_OR_SIZE'; end if;
  select r.result into result from public.wb_receipts r where owner_id=p_owner and device_id=device and change_id=cid;
  if found then results:=results||jsonb_build_array(result);continue; end if;
  select * into old from public.wb_records where owner_id=p_owner and collection=c and id=rid;
  merged:=wb_private.merge_data(coalesce(old.data,jsonb_build_object('id',rid)),case when c='vocab' then (item->'data')-'review_articles' else item->'data' end,old.id is null or at>old.write_at,c='progress');
  if c='vocab' then merged:=merged||jsonb_build_object('data',wb_private.reconcile_vocab(p_owner,coalesce(old.data,'{}'),merged->'data',item->'data')); end if;
  if c='progress' then merged:=merged||jsonb_build_object('data',wb_private.validate_attempt(p_owner,coalesce(old.data,'{}'),merged->'data')); end if;
  stamp:=coalesce(old.updated_at,0);
  if old.id is null or old.data is distinct from merged->'data' then
   stamp:=wb_private.tick(p_owner);
   insert into public.wb_records values(p_owner,c,rid,merged->'data',stamp,at) on conflict(owner_id,collection,id) do update set data=excluded.data,updated_at=excluded.updated_at,write_at=greatest(public.wb_records.write_at,excluded.write_at);
  end if;
  update public.wb_records set write_at=greatest(write_at,at) where owner_id=p_owner and collection=c and id=rid;
  result:=jsonb_build_object('change_id',cid,'collection',c,'id',rid,'data',merged->'data','updated_at',stamp,'conflicts',merged->'conflicts');
  if jsonb_array_length(merged->'conflicts')>0 then
   insert into public.wb_sync_log(owner_id,at,device_id,collection,record_id,fields) values(p_owner,wb_private.tick(p_owner),device,c,rid,merged->'conflicts');
   conflicts:=conflicts||jsonb_build_array(jsonb_build_object('collection',c,'id',rid,'fields',merged->'conflicts'));
  end if;
  insert into public.wb_receipts values(p_owner,device,cid,result);results:=results||jsonb_build_array(result);
 end loop;
 return jsonb_build_object('applied',results,'conflicts',conflicts);
end $$;

create function wb_private.wb_pull(p_owner uuid,p_since bigint default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform wb_private.require_owner(p_owner);perform wb_private.lock_owner(p_owner);
 if p_since<0 then raise exception 'WB_INVALID_TIMESTAMP'; end if;
 -- One aggregated RPC row: PostgREST's default 1000-row limit cannot truncate this pull.
 select jsonb_build_object('cursor',coalesce((select value from public.wb_clocks where owner_id=p_owner),0),
 'records',coalesce((select jsonb_agg(jsonb_build_object('collection',collection,'id',id,'data',data,'updated_at',updated_at) order by updated_at) from public.wb_records where owner_id=p_owner and collection in ('progress','vocab','shadowing','dictation') and updated_at>p_since),'[]'),
 'blobs',coalesce((select jsonb_agg(jsonb_build_object('key',key,'mime',mime,'size',size,'meta',meta,'updated_at',updated_at) order by updated_at) from public.wb_blobs where owner_id=p_owner and updated_at>p_since and path like p_owner::text||'/learning/%'),'[]'),
 'deleted','[]'::jsonb) into result;
 return result;
end $$;

create function wb_private.blob_referenced(p_owner uuid,p_key text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.wb_records r where owner_id=p_owner and (
 (collection in ('shadowing','dictation') and (data->>'blobKey'=p_key or data->>'audioKey'=p_key or data->>'audio_blob_key'=p_key or (collection='shadowing' and id=p_key))) or
 (collection='progress' and data->>'kind'='level_test' and exists(select 1 from jsonb_array_elements(coalesce(data#>'{answers,speaking}','[]')) a where a->>'blobKey'=p_key))))
$$;
create function wb_private.wb_finish_blob(p_owner uuid,p_key text,p_path text,p_size bigint,p_mime text,p_meta jsonb,p_digest text,p_at bigint,p_device text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.wb_blobs; stamp bigint; obj storage.objects;
begin
 perform wb_private.require_owner(p_owner);perform wb_private.lock_owner(p_owner);
 if not coalesce(length(p_key) between 1 and 200 and p_mime like 'audio/%' and p_size between 1 and 25000000 and wb_private.timestamp_ok(p_at) and length(p_device) between 1 and 128 and p_path like p_owner::text||'/learning/'||encode(convert_to(p_key,'UTF8'),'hex')||'/%' and p_digest ~ '^[a-f0-9]{64}$' and jsonb_typeof(p_meta)='object',false) then raise exception 'WB_INVALID_BLOB'; end if;
 if not wb_private.blob_referenced(p_owner,p_key) or wb_private.teaching_key(p_owner,p_key) or exists(select 1 from public.wb_blobs where owner_id=p_owner and key=p_key and path like p_owner::text||'/content/%') then raise exception 'WB_BLOB_NOT_LEARNING'; end if;
 select * into obj from storage.objects where bucket_id='workbench-audio' and name=p_path;
 if obj.id is null or (obj.metadata->>'size')::bigint is distinct from p_size or obj.metadata->>'mimetype' is distinct from p_mime then raise exception 'WB_BLOB_NOT_UPLOADED'; end if;
 select * into old from public.wb_blobs where owner_id=p_owner and key=p_key;
 if old.key is not null and p_at<=old.write_at then
  if p_at=old.write_at and p_digest=old.digest then return jsonb_build_object('key',p_key,'size',old.size,'conflicts','[]'::jsonb,'garbage_path',p_path); end if;
  insert into public.wb_sync_log(owner_id,at,device_id,collection,record_id,fields) values(p_owner,wb_private.tick(p_owner),p_device,'blobs',p_key,'["audio:server_newer"]');
  return jsonb_build_object('key',p_key,'conflicts','["audio:server_newer"]'::jsonb,'garbage_path',p_path);
 end if;
 if (select coalesce(sum(size),0) from public.wb_blobs where owner_id=p_owner)-coalesce(old.size,0)+p_size>800000000 then raise exception 'WB_QUOTA'; end if;
 stamp:=wb_private.tick(p_owner);
 insert into public.wb_blobs values(p_owner,p_key,p_path,p_size,p_mime,p_meta,p_digest,stamp,p_at) on conflict(owner_id,key) do update set path=excluded.path,size=excluded.size,mime=excluded.mime,meta=excluded.meta,digest=excluded.digest,updated_at=excluded.updated_at,write_at=excluded.write_at;
 return jsonb_build_object('key',p_key,'size',p_size,'mime',p_mime,'conflicts','[]'::jsonb,'garbage_path',old.path);
end $$;

-- Read access is RLS-scoped; no learner can write directly to records, receipts or blob indexes.
alter table public.wb_records enable row level security;
alter table public.wb_blobs enable row level security;
alter table public.wb_clocks enable row level security;
alter table public.wb_receipts enable row level security;
alter table public.wb_sync_log enable row level security;
alter table public.wb_coaches enable row level security;
grant usage on schema wb_private to authenticated;
grant execute on function wb_private.is_coach(uuid) to authenticated;
create policy wb_records_read on public.wb_records for select to authenticated using(owner_id=(select auth.uid()) or wb_private.is_coach(owner_id));
create policy wb_blobs_read on public.wb_blobs for select to authenticated using(owner_id=(select auth.uid()) or wb_private.is_coach(owner_id));
create policy wb_log_read on public.wb_sync_log for select to authenticated using(owner_id=(select auth.uid()) or wb_private.is_coach(owner_id));
revoke all on public.wb_records,public.wb_blobs,public.wb_clocks,public.wb_receipts,public.wb_sync_log,public.wb_coaches from anon,authenticated;
grant select on public.wb_records,public.wb_blobs,public.wb_sync_log to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('workbench-audio','workbench-audio',false,25000000,array['audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/wav','audio/x-wav','audio/aac']);
create policy wb_audio_read on storage.objects for select to authenticated using(bucket_id='workbench-audio' and ((storage.foldername(name))[1]=(select auth.uid())::text or wb_private.is_coach(((storage.foldername(name))[1])::uuid)));
create policy wb_audio_insert on storage.objects for insert to authenticated with check(bucket_id='workbench-audio' and (
 ((storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='learning') or
 (wb_private.is_coach(((storage.foldername(name))[1])::uuid) and (storage.foldername(name))[2]='content')));
create function wb_private.unreferenced(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (split_part(p_path,'/',1)=auth.uid()::text or exists(select 1 from public.wb_coaches where coach_id=auth.uid() and learner_id::text=split_part(p_path,'/',1))) and not exists(select 1 from public.wb_blobs where path=p_path)
$$;
grant execute on function wb_private.unreferenced(text) to authenticated;
create policy wb_audio_delete_orphan on storage.objects for delete to authenticated using(bucket_id='workbench-audio' and (storage.foldername(name))[1]=(select auth.uid())::text and (storage.foldername(name))[2]='learning' and wb_private.unreferenced(name));
-- Public RPCs preserve the caller; private implementations independently check identity and owner/coach rights.
create function public.wb_push(p_owner uuid,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_push(p_owner,p_payload)
$$;
create function public.wb_pull(p_owner uuid,p_since bigint default 0) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_pull(p_owner,p_since)
$$;
create function public.wb_finish_blob(p_owner uuid,p_key text,p_path text,p_size bigint,p_mime text,p_meta jsonb,p_digest text,p_at bigint,p_device text) returns jsonb language sql security invoker set search_path='' as $$
 select wb_private.wb_finish_blob(p_owner,p_key,p_path,p_size,p_mime,p_meta,p_digest,p_at,p_device)
$$;
-- PostgreSQL grants EXECUTE to PUBLIC by default: explicitly close every helper/RPC.
revoke execute on all functions in schema wb_private from public,anon,authenticated;
grant execute on function wb_private.is_coach(uuid),wb_private.unreferenced(text) to authenticated;
grant execute on function wb_private.wb_push(uuid,jsonb),wb_private.wb_pull(uuid,bigint),wb_private.wb_finish_blob(uuid,text,text,bigint,text,jsonb,text,bigint,text) to authenticated;

revoke execute on function public.wb_push(uuid,jsonb),public.wb_pull(uuid,bigint),public.wb_finish_blob(uuid,text,text,bigint,text,jsonb,text,bigint,text) from public,anon;
grant execute on function public.wb_push(uuid,jsonb),public.wb_pull(uuid,bigint),public.wb_finish_blob(uuid,text,text,bigint,text,jsonb,text,bigint,text) to authenticated;
commit;
